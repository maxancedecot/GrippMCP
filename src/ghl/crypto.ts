import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;

export function encryptSecret(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return ["v1", iv.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join(".");
}

export function decryptSecret(ciphertext: string): string {
  const key = getEncryptionKey();
  const [version, ivValue, tagValue, encryptedValue] = ciphertext.split(".");
  if (version !== "v1" || !ivValue || !tagValue || !encryptedValue) {
    throw new Error("Unsupported encrypted secret format.");
  }

  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivValue, "base64url"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, "base64url")),
    decipher.final()
  ]);

  return decrypted.toString("utf8");
}

function getEncryptionKey() {
  const raw = process.env.GHL_TOKEN_ENCRYPTION_KEY;
  if (!raw) {
    if (process.env.VERCEL || process.env.NODE_ENV === "production") {
      throw new Error("Set GHL_TOKEN_ENCRYPTION_KEY to a 32-byte hex secret before storing GoHighLevel tokens.");
    }

    return Buffer.alloc(32, 7);
  }

  const key = /^[a-f0-9]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("GHL_TOKEN_ENCRYPTION_KEY must decode to 32 bytes. Use `openssl rand -hex 32`.");
  }

  return key;
}
