import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createGrippMcpServer } from "../../../src/mcpServer.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, x-gripp-api-token, mcp-session-id, mcp-protocol-version, last-event-id",
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
  const token = getRequestToken(request);
  const server = createGrippMcpServer({
    clientOptions: token ? { token } : undefined
  });
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true
  });

  try {
    await server.connect(transport);
    const response = await transport.handleRequest(request);
    return withCors(response);
  } catch (error) {
    console.error("MCP request failed", error);
    return Response.json(
      {
        error: {
          code: "mcp_request_failed",
          message: error instanceof Error ? error.message : "Unknown MCP request failure"
        }
      },
      {
        status: 500,
        headers: corsHeaders
      }
    );
  }
}

function getRequestToken(request: Request) {
  return (
    request.headers.get("x-gripp-api-token") ??
    bearerToken(request.headers.get("authorization") ?? undefined) ??
    process.env.GRIPP_API_TOKEN
  );
}

function bearerToken(value: string | undefined) {
  const match = value?.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim();
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
