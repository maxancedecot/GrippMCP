export function GET() {
  return Response.json({
    name: "gripp-mcp",
    status: "ok",
    mcpEndpoint: "/api/mcp",
    goHighLevel: {
      oauthStart: "/api/ghl/oauth/start",
      oauthCallback: "/api/ghl/oauth/callback",
      mcpEndpoint: "/api/ghl/mcp"
    }
  });
}
