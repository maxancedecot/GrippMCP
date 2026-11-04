import test from "node:test";
import assert from "node:assert/strict";
import { createPmSession, PM_SESSION_SECONDS, pmReturnPath, verifyPmPassword, verifyPmSession } from "../src/pmDashboardAuth.js";

const password = "test-password-with-high-entropy";
const now = Date.UTC(2026, 10, 4);

test("PM password validation rejects missing configuration and incorrect inputs", () => {
  assert.equal(verifyPmPassword(password, password), true);
  for (const candidate of [undefined, null, "", "incorrect", { password }, "x".repeat(1025)]) {
    assert.equal(verifyPmPassword(candidate, password), false);
  }
  assert.equal(verifyPmPassword("", ""), false);
  assert.equal(verifyPmPassword(password, undefined), false);
  assert.throws(() => createPmSession(""));
});

test("PM sessions expire after eight hours and password rotation invalidates them", () => {
  const token = createPmSession(password, now);
  assert.equal(verifyPmSession(token, password, now), true);
  assert.equal(verifyPmSession(token, password, now + PM_SESSION_SECONDS * 1000 - 1), true);
  assert.equal(verifyPmSession(token, password, now + PM_SESSION_SECONDS * 1000), false);
  assert.equal(verifyPmSession(token, "changed-password", now), false);
  assert.equal(verifyPmSession(token, undefined, now), false);
  assert.notEqual(createPmSession(password, now), token);
});

test("PM sessions reject forged, malformed and modified tokens", () => {
  const token = createPmSession(password, now);
  const tampered = token.slice(0, -1) + (token.endsWith("A") ? "B" : "A");
  for (const candidate of [undefined, "", "invalid", "x".repeat(201), token.replace("v1.", "v2."), token.replace(/\.\d+\./, ".9999999999."), tampered]) {
    assert.equal(verifyPmSession(candidate, password, now), false);
  }
});

test("PM login redirects only to the two protected dashboards", () => {
  assert.equal(pmReturnPath("/pm/lite"), "/pm/lite");
  for (const candidate of ["/pm", undefined, "https://example.com", "//example.com", "/pm/login", "/pm/lite?next=evil", ["/pm/lite"]]) {
    assert.equal(pmReturnPath(candidate), "/pm");
  }
});
