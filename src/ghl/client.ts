import { GrippMcpError } from "../errors.js";
import { JsonValue } from "../types.js";
import { getFreshGhlTokenRecord } from "./oauth.js";
import { GhlApiCallInput, GhlApiMethod, GhlTokenRecord } from "./types.js";

const API_BASE_URL = "https://services.leadconnectorhq.com";
const DEFAULT_API_VERSION = "2021-07-28";
const WRITE_METHODS = new Set<GhlApiMethod>(["POST", "PUT", "PATCH", "DELETE"]);

export class GhlClient {
  constructor(private readonly installId: string) {}

  async call(input: GhlApiCallInput): Promise<JsonValue> {
    validateGhlCall(input);
    const record = await getFreshGhlTokenRecord(this.installId);
    const url = buildUrl(input.path, input.query);

    const response = await fetch(url, {
      method: input.method,
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "Authorization": `Bearer ${record.accessToken}`,
        "Version": input.apiVersion ?? DEFAULT_API_VERSION
      },
      body: input.body === undefined || input.method === "GET" ? undefined : JSON.stringify(input.body)
    });

    const text = await response.text();
    const payload = parseJson(text);
    if (!response.ok) {
      throw new GrippMcpError("ghl_upstream_error", "GoHighLevel request failed.", {
        status: response.status,
        statusText: response.statusText,
        body: payload
      });
    }

    return payload as JsonValue;
  }

  async status(): Promise<JsonValue> {
    const record = await getFreshGhlTokenRecord(this.installId);
    return sanitizeRecord(record);
  }
}

export function validateGhlCall(input: GhlApiCallInput): void {
  if (!/^(GET|POST|PUT|PATCH|DELETE)$/.test(input.method)) {
    throw new GrippMcpError("invalid_ghl_method", "Unsupported GoHighLevel API method.", { method: input.method });
  }

  if (!input.path.startsWith("/") || input.path.startsWith("//") || input.path.includes("://")) {
    throw new GrippMcpError("invalid_ghl_path", "GoHighLevel API path must be a relative path starting with '/'.", {
      path: input.path
    });
  }

  if (WRITE_METHODS.has(input.method) && !input.confirm && !input.readOnly) {
    throw new GrippMcpError(
      "confirmation_required",
      `GoHighLevel ${input.method} calls may modify data. Set confirm to true to execute.`
    );
  }
}

function buildUrl(path: string, query: GhlApiCallInput["query"]) {
  const url = new URL(path, API_BASE_URL);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  }
  return url;
}

function parseJson(text: string): unknown {
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function sanitizeRecord(record: GhlTokenRecord) {
  const value: Record<string, JsonValue> = {
    installId: record.installId,
    expiresAt: new Date(record.expiresAt).toISOString()
  };

  for (const [key, fieldValue] of Object.entries({
    scope: record.scope,
    userType: record.userType,
    companyId: record.companyId,
    locationId: record.locationId,
    userId: record.userId
  })) {
    if (fieldValue !== undefined) {
      value[key] = fieldValue;
    }
  }

  return value;
}
