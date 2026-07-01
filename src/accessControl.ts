import { createHash, timingSafeEqual } from "node:crypto";

export const MCP_ACCESS_KEY_QUERY_PARAM = "access_key";
export const MCP_ACCESS_KEY_HEADER = "x-mcp-access-key";

export type AccessCheckResult =
  | {
      ok: true;
    }
  | {
      ok: false;
      statusCode: number;
      code: string;
      message: string;
    };

export function checkMcpAccessKey(providedAccessKey: string | undefined | null): AccessCheckResult {
  const requiredAccessKey = process.env.MCP_ACCESS_KEY;

  if (!requiredAccessKey) {
    if (process.env.VERCEL || process.env.NODE_ENV === "production") {
      return {
        ok: false,
        statusCode: 500,
        code: "missing_mcp_access_key",
        message: "Set MCP_ACCESS_KEY in the Vercel project environment before exposing this MCP endpoint."
      };
    }

    return { ok: true };
  }

  if (!providedAccessKey || !constantTimeEqual(providedAccessKey, requiredAccessKey)) {
    return {
      ok: false,
      statusCode: 401,
      code: "unauthorized",
      message: "Missing or invalid MCP access key."
    };
  }

  return { ok: true };
}

function constantTimeEqual(left: string, right: string) {
  const leftHash = createHash("sha256").update(left).digest();
  const rightHash = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
}
