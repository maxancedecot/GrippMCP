import { getGhlTokenRecord, saveGhlTokenRecord } from "./tokenStore.js";
import { GhlTokenRecord, GhlTokenResponse } from "./types.js";

const TOKEN_URL = "https://services.leadconnectorhq.com/oauth/token";
const REFRESH_SKEW_MS = 5 * 60 * 1000;

export function getGhlRedirectUri(requestUrl?: string) {
  if (process.env.GHL_REDIRECT_URI) {
    return process.env.GHL_REDIRECT_URI;
  }

  if (requestUrl) {
    const url = new URL(requestUrl);
    return `${url.origin}/api/highlevel/oauth/callback`;
  }

  throw new Error("Set GHL_REDIRECT_URI to your GoHighLevel OAuth callback URL.");
}

export function getGhlInstallUrl() {
  const url = process.env.GHL_INSTALL_URL;
  if (!url) {
    throw new Error("Set GHL_INSTALL_URL to the installation URL from your HighLevel Marketplace app.");
  }
  return url;
}

export async function exchangeGhlAuthorizationCode(code: string, requestUrl?: string): Promise<GhlTokenRecord> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      client_id: requiredEnv("GHL_CLIENT_ID"),
      client_secret: requiredEnv("GHL_CLIENT_SECRET"),
      grant_type: "authorization_code",
      code,
      user_type: process.env.GHL_OAUTH_USER_TYPE ?? "Location",
      redirect_uri: getGhlRedirectUri(requestUrl)
    })
  });

  const payload = (await response.json()) as GhlTokenResponse & { message?: string; error?: string };
  if (!response.ok) {
    throw new Error(`GoHighLevel token exchange failed: ${payload.message ?? payload.error ?? response.statusText}`);
  }

  const record = tokenResponseToRecord(payload);
  await saveGhlTokenRecord(record);
  return record;
}

export async function getFreshGhlTokenRecord(installId: string): Promise<GhlTokenRecord> {
  const record = await getGhlTokenRecord(installId);
  if (!record) {
    throw new Error(`No GoHighLevel OAuth installation found for install_id '${installId}'.`);
  }

  if (record.expiresAt > Date.now() + REFRESH_SKEW_MS) {
    return record;
  }

  const refreshed = await refreshGhlToken(record);
  await saveGhlTokenRecord(refreshed);
  return refreshed;
}

async function refreshGhlToken(record: GhlTokenRecord): Promise<GhlTokenRecord> {
  const body = new URLSearchParams({
    client_id: requiredEnv("GHL_CLIENT_ID"),
    client_secret: requiredEnv("GHL_CLIENT_SECRET"),
    grant_type: "refresh_token",
    refresh_token: record.refreshToken,
    user_type: record.userType ?? process.env.GHL_OAUTH_USER_TYPE ?? "Location",
    redirect_uri: process.env.GHL_REDIRECT_URI ?? ""
  });

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  });

  const payload = (await response.json()) as GhlTokenResponse & { message?: string; error?: string };
  if (!response.ok) {
    throw new Error(`GoHighLevel token refresh failed: ${payload.message ?? payload.error ?? response.statusText}`);
  }

  return {
    ...record,
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    tokenType: payload.token_type,
    expiresAt: Date.now() + payload.expires_in * 1000,
    scope: payload.scope ?? record.scope,
    refreshTokenId: payload.refreshTokenId ?? record.refreshTokenId,
    userType: payload.userType ?? record.userType,
    companyId: payload.companyId ?? record.companyId,
    locationId: payload.locationId ?? record.locationId,
    userId: payload.userId ?? record.userId,
    updatedAt: Date.now()
  };
}

function tokenResponseToRecord(payload: GhlTokenResponse): GhlTokenRecord {
  const installId = payload.locationId ?? payload.companyId ?? payload.userId;
  if (!installId) {
    throw new Error("GoHighLevel token response did not include locationId, companyId, or userId.");
  }

  const now = Date.now();
  return {
    installId,
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    tokenType: payload.token_type,
    expiresAt: now + payload.expires_in * 1000,
    scope: payload.scope,
    refreshTokenId: payload.refreshTokenId,
    userType: payload.userType,
    companyId: payload.companyId,
    locationId: payload.locationId,
    userId: payload.userId,
    createdAt: now,
    updatedAt: now
  };
}

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Set ${name} in the Vercel project environment.`);
  }
  return value;
}
