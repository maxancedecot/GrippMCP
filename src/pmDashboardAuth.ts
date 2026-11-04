import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const PM_SESSION_COOKIE = "pm_dashboard_session";
export const PM_SESSION_SECONDS = 8 * 60 * 60;

function equalSecrets(left: string, right: string): boolean {
  return timingSafeEqual(createHash("sha256").update(left).digest(), createHash("sha256").update(right).digest());
}

export function verifyPmPassword(candidate: unknown, password: string | undefined): boolean {
  return Boolean(password) && typeof candidate === "string" && candidate.length <= 1024 && equalSecrets(candidate, password!);
}

function signature(payload: string, password: string): string {
  return createHmac("sha256", password).update(`pm-dashboard-session:${payload}`).digest("base64url");
}

export function createPmSession(password: string, now = Date.now()): string {
  if (!password) throw new Error("PM dashboard password is not configured");
  const payload = `v1.${Math.floor(now / 1000) + PM_SESSION_SECONDS}.${randomBytes(24).toString("base64url")}`;
  return `${payload}.${signature(payload, password)}`;
}

export function verifyPmSession(token: string | undefined, password: string | undefined, now = Date.now()): boolean {
  if (!token || !password || token.length > 200) return false;
  const match = /^(v1\.(\d{10,11})\.[A-Za-z0-9_-]{32})\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (!match || Number(match[2]) <= Math.floor(now / 1000)) return false;
  return equalSecrets(match[3], signature(match[1], password));
}

export function pmReturnPath(value: unknown): "/pm" | "/pm/lite" {
  return value === "/pm/lite" ? "/pm/lite" : "/pm";
}
