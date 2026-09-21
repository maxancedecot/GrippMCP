import assert from "node:assert/strict";
import test from "node:test";
import { isAccountManagerNavigation } from "../app/accountmanager/loading-overlay.js";

test("account manager loading overlay only starts for same-origin dashboard refreshes", () => {
  const origin = "https://dashboard.example";
  assert.equal(isAccountManagerNavigation("/accountmanager?manager=12", origin), true);
  assert.equal(isAccountManagerNavigation("https://dashboard.example/accountmanager/?start=2026-09-01", origin), true);
  assert.equal(isAccountManagerNavigation("/dashboard", origin), false);
  assert.equal(isAccountManagerNavigation("https://other.example/accountmanager", origin), false);
  assert.equal(isAccountManagerNavigation("not a valid absolute URL", origin), false);
});
