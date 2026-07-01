export function GET() {
  return Response.json({
    name: "gripp-mcp",
    status: "ok",
    mcpEndpoint: "/api/mcp",
    goHighLevel: {
      oauthStart: "/api/highlevel/oauth/start",
      oauthCallback: "/api/highlevel/oauth/callback",
      mcpEndpoint: "/api/highlevel/mcp"
    }
  });
}
