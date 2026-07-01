import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
  checkGhlMcpAccessKey,
  MCP_ACCESS_KEY_HEADER,
  MCP_ACCESS_KEY_QUERY_PARAM
} from "../../../../src/accessControl.js";
import { createGhlMcpServer } from "../../../../src/ghl/mcpServer.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const INSTALL_ID_QUERY_PARAM = "install_id";
const INSTALL_ID_HEADER = "x-ghl-install-id";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, x-mcp-access-key, x-ghl-install-id, mcp-session-id, mcp-protocol-version, last-event-id",
  "Access-Control-Expose-Headers": "mcp-session-id"
};

export function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders
  });
}

export async function GET(request: Request) {
  return handleMcpRequest(request);
}

export async function POST(request: Request) {
  return handleMcpRequest(request);
}

export async function DELETE(request: Request) {
  return handleMcpRequest(request);
}

async function handleMcpRequest(request: Request) {
  const accessCheck = checkGhlMcpAccessKey(getRequestAccessKey(request));
  if (!accessCheck.ok) {
    return errorResponse(accessCheck.statusCode, accessCheck.code, accessCheck.message);
  }

  const installId = getInstallId(request);
  const server = createGhlMcpServer({ installId: installId ?? undefined });
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true
  });

  try {
    await server.connect(transport);
    const response = await transport.handleRequest(request);
    return withCors(response);
  } catch (error) {
    console.error("GoHighLevel MCP request failed", error);
    return errorResponse(
      500,
      "ghl_mcp_request_failed",
      error instanceof Error ? error.message : "Unknown GoHighLevel MCP request failure"
    );
  } finally {
    await server.close().catch(() => undefined);
  }
}

function getRequestAccessKey(request: Request) {
  const url = new URL(request.url);
  return url.searchParams.get(MCP_ACCESS_KEY_QUERY_PARAM) ?? request.headers.get(MCP_ACCESS_KEY_HEADER);
}

function getInstallId(request: Request) {
  const url = new URL(request.url);
  return url.searchParams.get(INSTALL_ID_QUERY_PARAM) ?? request.headers.get(INSTALL_ID_HEADER);
}

function errorResponse(status: number, code: string, message: string) {
  return Response.json(
    {
      error: {
        code,
        message
      }
    },
    {
      status,
      headers: corsHeaders
    }
  );
}

function withCors(response: Response) {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(corsHeaders)) {
    headers.set(name, value);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}
