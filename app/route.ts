export function GET() {
  return Response.json({
    name: "gripp-mcp",
    status: "ok",
    mcpEndpoint: "/api/mcp",
    goHighLevel: {
      oauthStart: "/api/connect/start",
      oauthCallback: "/api/connect/callback",
      mcpEndpoint: "/api/connect/mcp"
    }
  });
}
