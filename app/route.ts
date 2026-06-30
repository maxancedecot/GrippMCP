export function GET() {
  return Response.json({
    name: "gripp-mcp",
    status: "ok",
    mcpEndpoint: "/api/mcp"
  });
}
