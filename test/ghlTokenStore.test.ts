import test from "node:test";
import assert from "node:assert/strict";
import { listGhlInstallations, saveGhlTokenRecord } from "../src/ghl/tokenStore.js";
import { GhlTokenRecord } from "../src/ghl/types.js";

const originalEnv = { ...process.env };

test.afterEach(() => {
  process.env = { ...originalEnv };
});

test("saveGhlTokenRecord indexes multiple installations for one MCP", async () => {
  delete process.env.VERCEL;
  process.env.NODE_ENV = "test";
  process.env.GHL_TOKEN_ENCRYPTION_KEY = "2".repeat(64);

  const now = Date.now();
  const first = tokenRecord(`loc_${now}_a`, now);
  const second = tokenRecord(`loc_${now}_b`, now + 1);

  await saveGhlTokenRecord(first);
  await saveGhlTokenRecord(second);

  const installations = await listGhlInstallations();
  const installIds = installations.map((installation) => installation.installId);

  assert.ok(installIds.includes(first.installId));
  assert.ok(installIds.includes(second.installId));
  assert.equal(installations.find((installation) => installation.installId === first.installId)?.locationId, first.locationId);
});

function tokenRecord(installId: string, now: number): GhlTokenRecord {
  return {
    installId,
    accessToken: `access-${installId}`,
    refreshToken: `refresh-${installId}`,
    tokenType: "Bearer",
    expiresAt: now + 86_400_000,
    scope: "contacts.readonly",
    userType: "Location",
    companyId: "company_123",
    locationId: installId,
    userId: "user_123",
    createdAt: now,
    updatedAt: now
  };
}
