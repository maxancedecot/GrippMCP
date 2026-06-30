import { IncomingMessage, ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createGrippMcpServer } from "../src/mcpServer.js";

type VercelLikeRequest = IncomingMessage & {
  body?: unknown;
};

export const config = {
  maxDuration: 60
};

export default async function handler(req: VercelLikeRequest, res: ServerResponse) {
  setCorsHeaders(res);

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (!["GET", "POST", "DELETE"].includes(req.method ?? "")) {
    sendJson(res, 405, {
      error: {
        code: "method_not_allowed",
        message: "Use GET, POST, or DELETE for the MCP endpoint."
      }
    });
    return;
  }

  const token = getRequestToken(req);
  const server = createGrippMcpServer({
    clientOptions: token ? { token } : undefined
  });
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("MCP request failed", error);
    if (!res.headersSent) {
      sendJson(res, 500, {
        error: {
          code: "mcp_request_failed",
          message: error instanceof Error ? error.message : "Unknown MCP request failure"
        }
      });
    } else {
      res.end();
    }
  } finally {
    await server.close().catch(() => undefined);
  }
}

function getRequestToken(req: IncomingMessage) {
  return (
    firstHeader(req.headers["x-gripp-api-token"]) ??
    bearerToken(firstHeader(req.headers.authorization)) ??
    process.env.GRIPP_API_TOKEN
  );
}

function firstHeader(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function bearerToken(value: string | undefined) {
  const match = value?.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim();
}

function setCorsHeaders(res: ServerResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, x-gripp-api-token, mcp-session-id, mcp-protocol-version, last-event-id"
  );
  res.setHeader("Access-Control-Expose-Headers", "mcp-session-id");
}

function sendJson(res: ServerResponse, statusCode: number, payload: unknown) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}
