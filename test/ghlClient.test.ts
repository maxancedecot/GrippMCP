import test from "node:test";
import assert from "node:assert/strict";
import { GrippMcpError } from "../src/errors.js";
import { validateGhlCall } from "../src/ghl/client.js";

test("validateGhlCall allows relative GET requests without confirmation", () => {
  assert.doesNotThrow(() =>
    validateGhlCall({
      method: "GET",
      path: "/contacts/abc123"
    })
  );
});

test("validateGhlCall rejects absolute or protocol-relative paths", () => {
  assert.throws(
    () =>
      validateGhlCall({
        method: "GET",
        path: "https://example.com/contacts"
      }),
    GrippMcpError
  );

  assert.throws(
    () =>
      validateGhlCall({
        method: "GET",
        path: "//example.com/contacts"
      }),
    GrippMcpError
  );
});

test("validateGhlCall requires confirmation for writes", () => {
  assert.throws(
    () =>
      validateGhlCall({
        method: "POST",
        path: "/contacts/",
        body: { firstName: "Ada" }
      }),
    GrippMcpError
  );

  assert.doesNotThrow(() =>
    validateGhlCall({
      method: "POST",
      path: "/contacts/",
      body: { firstName: "Ada" },
      confirm: true
    })
  );
});

test("validateGhlCall allows explicitly read-only POST wrappers", () => {
  assert.doesNotThrow(() =>
    validateGhlCall({
      method: "POST",
      path: "/contacts/search",
      body: { locationId: "loc_123" },
      readOnly: true
    })
  );
});
