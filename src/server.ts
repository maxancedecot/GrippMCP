import { IncomingMessage, ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { checkMcpAccessKey, MCP_ACCESS_KEY_HEADER, MCP_ACCESS_KEY_QUERY_PARAM } from "./accessControl.js";
import { createGrippMcpServer } from "./mcpServer.js";

type VercelLikeRequest = IncomingMessage & {
  body?: unknown;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, x-gripp-api-token, x-mcp-access-key, mcp-session-id, mcp-protocol-version, last-event-id",
  "Access-Control-Expose-Headers": "mcp-session-id"
};

export default async function handler(req: VercelLikeRequest, res: ServerResponse) {
  setCorsHeaders(res);

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  const path = getPath(req);
  if (req.method === "GET" && path !== "/api/mcp") {
    sendJson(res, 200, {
      name: "gripp-mcp",
      status: "ok",
      mcpEndpoint: "/api/mcp"
    });
    return;
  }

  const accessCheck = checkMcpAccessKey(getRequestAccessKey(req));
  if (!accessCheck.ok) {
    sendJson(res, accessCheck.statusCode, {
      error: {
        code: accessCheck.code,
        message: accessCheck.message
      }
    });
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

function getPath(req: IncomingMessage) {
  const host = req.headers.host ?? "localhost";
  return new URL(req.url ?? "/", `https://${host}`).pathname;
}

function getRequestAccessKey(req: IncomingMessage) {
  const url = getUrl(req);
  return url.searchParams.get(MCP_ACCESS_KEY_QUERY_PARAM) ?? firstHeader(req.headers[MCP_ACCESS_KEY_HEADER]);
}

function getRequestToken(req: IncomingMessage) {
  return (
    firstHeader(req.headers["x-gripp-api-token"]) ??
    bearerToken(firstHeader(req.headers.authorization)) ??
    process.env.GRIPP_API_TOKEN
  );
}

function getUrl(req: IncomingMessage) {
  const host = req.headers.host ?? "localhost";
  return new URL(req.url ?? "/", `https://${host}`);
}

function firstHeader(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function bearerToken(value: string | undefined) {
  const match = value?.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim();
}

function setCorsHeaders(res: ServerResponse) {
  for (const [name, value] of Object.entries(corsHeaders)) {
    res.setHeader(name, value);
  }
}

function sendJson(res: ServerResponse, statusCode: number, payload: unknown) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}
