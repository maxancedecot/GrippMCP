import { ServerResponse } from "node:http";

export default function handler(_req: unknown, res: ServerResponse) {
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json");
  res.end(
    JSON.stringify({
      name: "gripp-mcp",
      status: "ok",
      mcpEndpoint: "/api/mcp"
    })
  );
}
