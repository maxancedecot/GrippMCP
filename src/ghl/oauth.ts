import { getGhlTokenRecord, saveGhlTokenRecord } from "./tokenStore.js";
import { GhlTokenRecord, GhlTokenResponse } from "./types.js";

const TOKEN_URL = "https://services.leadconnectorhq.com/oauth/token";
const LOCATION_TOKEN_URLS = [
  "https://services.leadconnectorhq.com/oauth/location-token",
  "https://services.leadconnectorhq.com/oauth/locationToken"
];
const REFRESH_SKEW_MS = 5 * 60 * 1000;

export function getGhlRedirectUri(requestUrl?: string) {
  if (process.env.GHL_REDIRECT_URI) {
    return process.env.GHL_REDIRECT_URI;
  }

  if (requestUrl) {
    const url = new URL(requestUrl);
    return `${url.origin}/api/connect/callback`;
  }

  throw new Error("Set GHL_REDIRECT_URI to your GoHighLevel OAuth callback URL.");
}

export function getGhlInstallUrl(requestUrl?: string) {
  const rawUrl = process.env.GHL_INSTALL_URL;
  if (!rawUrl) {
    throw new Error("Set GHL_INSTALL_URL to the installation URL from your HighLevel Marketplace app.");
  }

  const url = new URL(rawUrl);
  const redirectUri = process.env.GHL_REDIRECT_URI ?? (requestUrl ? getGhlRedirectUri(requestUrl) : undefined);
  if (redirectUri) {
    url.searchParams.set("redirect_uri", redirectUri);
  }

  return url.toString();
}

export function getGhlAppId() {
  if (process.env.GHL_APP_ID) {
    return process.env.GHL_APP_ID;
  }

  const rawUrl = process.env.GHL_INSTALL_URL;
  if (rawUrl) {
    const url = new URL(rawUrl);
    const appId = url.searchParams.get("appId") ?? url.searchParams.get("app_id") ?? url.searchParams.get("version_id");
    if (appId) {
      return appId;
    }
  }

  throw new Error("Set GHL_APP_ID to your HighLevel Marketplace app/version ID.");
}

export async function exchangeGhlAuthorizationCode(code: string, requestUrl?: string): Promise<GhlTokenRecord> {
  const body = buildTokenExchangeBody(code, requestUrl);
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
    throw new Error(`GoHighLevel token exchange failed: ${formatGhlError(response, payload)}`);
  }

  const record = tokenResponseToRecord(payload);
  await saveGhlTokenRecord(record);
  return record;
}

export function buildTokenExchangeBody(code: string, requestUrl?: string) {
  return new URLSearchParams({
    client_id: requiredEnv("GHL_CLIENT_ID"),
    client_secret: requiredEnv("GHL_CLIENT_SECRET"),
    grant_type: "authorization_code",
    code,
    user_type: process.env.GHL_OAUTH_USER_TYPE ?? "Location",
    redirect_uri: getGhlRedirectUri(requestUrl)
  });
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

export async function createGhlLocationToken(companyInstallId: string, locationId: string): Promise<GhlTokenRecord> {
  const agencyRecord = await getFreshGhlTokenRecord(companyInstallId);
  if (agencyRecord.userType !== "Company" || !agencyRecord.companyId) {
    throw new Error("A Company/Agency OAuth installation is required to create a Location token.");
  }

  const body = new URLSearchParams({
    companyId: agencyRecord.companyId,
    locationId
  });

  const payload = await postLocationToken(agencyRecord.accessToken, body);
  const record = tokenResponseToRecord({
    ...payload,
    companyId: payload.companyId ?? agencyRecord.companyId,
    locationId
  });
  await saveGhlTokenRecord(record);
  return record;
}

async function postLocationToken(accessToken: string, body: URLSearchParams): Promise<GhlTokenResponse & { message?: string; error?: string }> {
  let lastError: Error | null = null;

  for (const url of LOCATION_TOKEN_URLS) {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "Version": "2021-07-28"
      },
      body
    });
    const payload = (await response.json()) as GhlTokenResponse & { message?: string; error?: string };

    if (response.ok) {
      return payload;
    }

    lastError = new Error(`GoHighLevel location token exchange failed: ${formatGhlError(response, payload)}`);
    if (response.status !== 404) {
      break;
    }
  }

  throw lastError ?? new Error("GoHighLevel location token exchange failed.");
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
    throw new Error(`GoHighLevel token refresh failed: ${formatGhlError(response, payload)}`);
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

function formatGhlError(response: Response, payload: { message?: string; error?: string; error_description?: string }) {
  return payload.message ?? payload.error_description ?? payload.error ?? response.statusText;
}
