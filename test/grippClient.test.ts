import test from "node:test";
import assert from "node:assert/strict";
import { GrippClient, validateMethodSafety } from "../src/grippClient.js";
import { GrippMcpError } from "../src/errors.js";

test("validateMethodSafety allows documented read methods without confirmation", () => {
  assert.doesNotThrow(() => validateMethodSafety("company.get", false));
  assert.doesNotThrow(() => validateMethodSafety("company.getone", false));
  assert.doesNotThrow(() => validateMethodSafety("company.getCompanyByCOC", false));
});

test("validateMethodSafety requires confirmation for write-like methods", () => {
  assert.throws(() => validateMethodSafety("tag.create", false), GrippMcpError);
  assert.doesNotThrow(() => validateMethodSafety("tag.create", true));
});

test("GrippClient posts JSON-RPC batch requests with bearer auth", async () => {
  const calls: unknown[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify([{ id: 1, result: [{ id: 123 }] }]), {
      status: 200,
      headers: {
        "content-type": "application/json"
      }
    });
  }) as typeof fetch;

  const client = new GrippClient({
    apiUrl: "https://api.gripp.com/public/api3.php",
    token: "test-token",
    fetchImpl
  });

  const result = await client.call("company.get", [[{ field: "company.id", operator: "equals", value: 123 }]]);

  assert.deepEqual(result, [{ id: 123 }]);
  assert.equal(calls.length, 1);

  const call = calls[0] as { url: string; init: RequestInit };
  assert.equal(call.url, "https://api.gripp.com/public/api3.php");
  assert.equal((call.init.headers as Record<string, string>).Authorization, "Bearer test-token");
  assert.deepEqual(JSON.parse(call.init.body as string), [
    {
      method: "company.get",
      params: [[{ field: "company.id", operator: "equals", value: 123 }]],
      id: 1
    }
  ]);
});
