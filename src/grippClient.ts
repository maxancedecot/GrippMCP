import { GrippMcpError } from "./errors.js";
import { GrippBatchItemInput, GrippRpcRequest, GrippRpcResponse, JsonValue } from "./types.js";

const DEFAULT_API_URL = "https://api.gripp.com/public/api3.php";
const DEFAULT_TIMEOUT_MS = 30_000;
const READONLY_METHOD_PATTERN = /\.(get|getone|getCompanyByCOC|getContent|getViewonlineUrl|getWorkingHours)$/;

export type GrippClientOptions = {
  apiUrl?: string;
  token?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

export class GrippClient {
  private readonly apiUrl: string;
  private readonly token: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: GrippClientOptions = {}) {
    this.apiUrl = options.apiUrl ?? process.env.GRIPP_API_URL ?? DEFAULT_API_URL;
    this.token = options.token ?? process.env.GRIPP_API_TOKEN ?? "";
    this.timeoutMs = options.timeoutMs ?? Number(process.env.GRIPP_REQUEST_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
    this.fetchImpl = options.fetchImpl ?? fetch;

    if (!this.token) {
      throw new GrippMcpError("missing_token", "Set GRIPP_API_TOKEN before calling the Gripp API.");
    }

    if (!this.apiUrl.startsWith("https://api.gripp.com/")) {
      throw new GrippMcpError("invalid_api_url", "GRIPP_API_URL must point at the Gripp API host.", {
        apiUrl: this.apiUrl
      });
    }
  }

  async call(method: string, params: JsonValue[] = [], confirm = false): Promise<JsonValue> {
    const [response] = await this.batch([{ method, params, confirm }]);
    return response;
  }

  async batch(items: GrippBatchItemInput[]): Promise<JsonValue[]> {
    if (items.length === 0) {
      throw new GrippMcpError("invalid_batch", "Batch must include at least one request.");
    }

    const requests = items.map((item, index) => {
      validateMethodSafety(item.method, Boolean(item.confirm));
      return {
        method: item.method,
        params: item.params ?? [],
        id: index + 1
      };
    });

    const responses = await this.post(requests);
    const byId = new Map(responses.map((response) => [response.id, response]));

    return requests.map((request) => {
      const response = byId.get(request.id);
      const globalError = responses.find((candidate) => isErrorResponse(candidate));
      if (!response) {
        throw new GrippMcpError("missing_response", "Gripp did not return a response for a batch item.", {
          requestId: request.id,
          upstreamError: globalError ?? null,
          responses
        });
      }

      if (isErrorResponse(response)) {
        throw new GrippMcpError("upstream_error", "Gripp returned an error.", response);
      }

      if (response.result === undefined) {
        throw new GrippMcpError("invalid_upstream_shape", "Gripp returned a response without a result.", response);
      }

      return response.result;
    });
  }

  private async post(requests: GrippRpcRequest[]): Promise<GrippRpcResponse[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(this.apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${this.token}`
        },
        body: JSON.stringify(requests),
        signal: controller.signal
      });

      const text = await response.text();
      let data: unknown;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        throw new GrippMcpError("invalid_upstream_json", "Gripp returned a non-JSON response.", {
          status: response.status,
          body: text
        });
      }

      if (!response.ok) {
        throw new GrippMcpError("upstream_http_error", "Gripp request failed.", {
          status: response.status,
          statusText: response.statusText,
          body: data,
          rateLimit: getRateLimitHeaders(response)
        });
      }

      if (!Array.isArray(data)) {
        throw new GrippMcpError("invalid_upstream_shape", "Expected Gripp to return a JSON-RPC response array.", {
          body: data
        });
      }

      return data as GrippRpcResponse[];
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new GrippMcpError("timeout", "Gripp request timed out.", { timeoutMs: this.timeoutMs });
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function isErrorResponse(response: GrippRpcResponse): boolean {
  return (
    ("error_code" in response && response.error_code !== undefined && response.error_code !== null) ||
    ("error" in response && response.error !== undefined && response.error !== null)
  );
}

export function validateMethodSafety(method: string, confirm: boolean): void {
  if (!READONLY_METHOD_PATTERN.test(method) && !confirm) {
    throw new GrippMcpError(
      "confirmation_required",
      `Method '${method}' may modify Gripp data. Set confirm to true to execute it.`
    );
  }
}

function getRateLimitHeaders(response: Response) {
  return {
    limit: response.headers.get("x-ratelimit-limit"),
    remaining: response.headers.get("x-ratelimit-remaining")
  };
}
