import test from "node:test";
import assert from "node:assert/strict";
import { decryptSecret, encryptSecret } from "../src/ghl/crypto.js";

const originalEnv = { ...process.env };

test.afterEach(() => {
  process.env = { ...originalEnv };
});

test("encryptSecret stores decryptable ciphertext without leaking plaintext", () => {
  process.env.GHL_TOKEN_ENCRYPTION_KEY = "1".repeat(64);
  const ciphertext = encryptSecret("secret-token");

  assert.notEqual(ciphertext, "secret-token");
  assert.equal(decryptSecret(ciphertext), "secret-token");
});

test("encryptSecret requires a 32-byte key when configured", () => {
  process.env.GHL_TOKEN_ENCRYPTION_KEY = "too-short";

  assert.throws(() => encryptSecret("secret-token"), /32 bytes/);
});
