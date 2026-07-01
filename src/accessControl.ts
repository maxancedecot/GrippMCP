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
  return checkAccessKey(providedAccessKey, {
    envName: "MCP_ACCESS_KEY",
    missingCode: "missing_mcp_access_key",
    missingMessage: "Set MCP_ACCESS_KEY in the Vercel project environment before exposing this MCP endpoint.",
    invalidMessage: "Missing or invalid MCP access key."
  });
}

export function checkGhlMcpAccessKey(providedAccessKey: string | undefined | null): AccessCheckResult {
  return checkAccessKey(providedAccessKey, {
    envName: "GHL_MCP_ACCESS_KEY",
    missingCode: "missing_ghl_mcp_access_key",
    missingMessage: "Set GHL_MCP_ACCESS_KEY in the Vercel project environment before exposing this MCP endpoint.",
    invalidMessage: "Missing or invalid GoHighLevel MCP access key."
  });
}

function checkAccessKey(
  providedAccessKey: string | undefined | null,
  options: {
    envName: string;
    missingCode: string;
    missingMessage: string;
    invalidMessage: string;
  }
): AccessCheckResult {
  const requiredAccessKey = process.env[options.envName];
  if (!requiredAccessKey) {
    if (process.env.VERCEL || process.env.NODE_ENV === "production") {
      return {
        ok: false,
        statusCode: 500,
        code: options.missingCode,
        message: options.missingMessage
      };
    }

    return { ok: true };
  }

  if (!providedAccessKey || !constantTimeEqual(providedAccessKey, requiredAccessKey)) {
    return {
      ok: false,
      statusCode: 401,
      code: "unauthorized",
      message: options.invalidMessage
    };
  }

  return { ok: true };
}

function constantTimeEqual(left: string, right: string) {
  const leftHash = createHash("sha256").update(left).digest();
  const rightHash = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
}
