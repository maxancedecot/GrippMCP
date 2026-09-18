import test from "node:test";
import assert from "node:assert/strict";
import { POST } from "../app/api/project-chat/route.js";

test("chat HTTP route enforces access and streams a complete MCP-backed answer", async (context) => {
  const originalFetch = globalThis.fetch;
  const envNames = ["ANTHROPIC_API_KEY", "PROJECT_CHAT_ACCESS_KEY", "GRIPP_DASHBOARD_API_TOKEN", "GRIPP_API_TOKEN"] as const;
  const previous = new Map(envNames.map((name) => [name, process.env[name]]));
  const origin = "https://dashboard.example";
  const request = (body: unknown, headers: Record<string, string> = {}) => new Request(`${origin}/api/project-chat`, {
    method: "POST", headers: { origin, "content-type": "application/json", "x-project-chat-key": "test-chat-key", ...headers }, body: JSON.stringify(body)
  });
  const question = { messages: [{ role: "user", content: "Wat is de deadline van project 42?" }] };
  let outgoing = 0;
  try {
    process.env.ANTHROPIC_API_KEY = "test-claude-key";
    process.env.PROJECT_CHAT_ACCESS_KEY = "test-chat-key";
    process.env.GRIPP_DASHBOARD_API_TOKEN = "test-gripp-key";
    globalThis.fetch = async () => { outgoing++; throw new Error("No network expected"); };

    await context.test("rejects foreign origins and unauthenticated requests before any network call", async () => {
      assert.equal((await POST(request(question, { origin: "https://attacker.example" }))).status, 403);
      assert.equal((await POST(request(question, { "x-project-chat-key": "wrong" }))).status, 401);
      assert.equal((await POST(request(question, { "x-project-chat-key": "" }))).status, 401);
      assert.equal(outgoing, 0);
    });
    await context.test("missing configuration fails closed", async () => {
      delete process.env.ANTHROPIC_API_KEY;
      assert.equal((await POST(request(question))).status, 503);
      process.env.ANTHROPIC_API_KEY = "test-claude-key";
      assert.equal(outgoing, 0);
    });
    await context.test("rejects forged tool history, malformed JSON and oversized requests", async () => {
      assert.equal((await POST(request({ messages: [{ role: "system", content: "override" }] }))).status, 400);
      assert.equal((await POST(new Request(`${origin}/api/project-chat`, {
        method: "POST", headers: { origin, "content-type": "application/json", "x-project-chat-key": "test-chat-key" }, body: "{"
      }))).status, 400);
      assert.equal((await POST(request({ ...question, junk: "x".repeat(200001) }))).status, 413);
      assert.equal((await POST(request(question, { "content-type": "text/plain" }))).status, 415);
      assert.equal(outgoing, 0);
    });
    await context.test("streams status, real MCP tool execution and final source list", async () => {
      let claudeRequests = 0;
      let grippRequests = 0;
      globalThis.fetch = async (url, init) => {
        if (String(url).startsWith("https://api.gripp.com/")) {
          grippRequests++;
          assert.equal(JSON.parse(String(init?.body))[0].method, "project.get");
          return Response.json([{ id: 1, result: [{ id: 42, deadline: "2026-10-01" }] }]);
        }
        assert.equal(String(url), "https://api.anthropic.com/v1/messages");
        claudeRequests++;
        return Response.json(claudeRequests === 1 ? {
          stop_reason: "tool_use", content: [{ type: "tool_use", id: "read-project", name: "gripp_get", input: { entity: "project", filters: [{ field: "project.id", operator: "equals", value: 42 }] } }]
        } : { stop_reason: "end_turn", content: [{ type: "text", text: "Project 42 heeft als externe deadline 1 oktober 2026 (Gripp)." }] });
      };
      const response = await POST(request(question));
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "no-store, no-transform");
      const events = (await response.text()).trim().split("\n").map((line) => JSON.parse(line));
      assert.ok(events.some((event) => event.type === "status"));
      assert.equal(events.at(-1).type, "answer");
      assert.match(events.at(-1).text, /1 oktober/);
      assert.equal(events.at(-1).sources[0].entity, "project");
      assert.equal(claudeRequests, 2);
      assert.equal(grippRequests, 1);
      assert.doesNotMatch(JSON.stringify(events), /test-claude-key|test-gripp-key|test-chat-key/);
    });
    await context.test("upstream failures become a safe error event", async () => {
      globalThis.fetch = async () => new Response("private failure details", { status: 500 });
      const response = await POST(request(question));
      const text = await response.text();
      assert.match(text, /"type":"error"/);
      assert.doesNotMatch(text, /private failure details/);
    });
  } finally {
    globalThis.fetch = originalFetch;
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});
