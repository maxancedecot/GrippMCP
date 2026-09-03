import {
  deleteRegisteredSiteAnalyticsSite,
  registerSiteAnalyticsSite,
  verifySiteAnalyticsRegistrationToken
} from "../../../../src/siteAnalytics.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders()
  });
}

export async function POST(request: Request) {
  const payload = await safeJson(request);
  const registrationToken = tokenFromRequest(request, payload);
  if (!verifySiteAnalyticsRegistrationToken(registrationToken)) {
    return json({ error: "unauthorized_registration" }, 401);
  }

  try {
    const registration = await registerSiteAnalyticsSite(payload);
    return json({
      ok: true,
      site_id: registration.site.id,
      site_name: registration.site.name,
      site_url: registration.site.url,
      site_token: registration.siteToken,
      collect_url: new URL("/api/site-analytics/collect", request.url).toString()
    });
  } catch {
    return json({ error: "invalid_registration" }, 400);
  }
}

export async function DELETE(request: Request) {
  const payload = await safeJson(request);
  const siteId = siteIdFromRequest(request, payload);
  const token = siteTokenFromRequest(request, payload);
  if (!(await deleteRegisteredSiteAnalyticsSite(siteId, token))) {
    return json({ error: "unauthorized_site" }, 401);
  }

  return json({ ok: true });
}

async function safeJson(request: Request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function tokenFromRequest(request: Request, payload: unknown) {
  const authorization = request.headers.get("authorization") ?? "";
  const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  const header = request.headers.get("x-site-analytics-registration-token")?.trim();
  const record = payload && typeof payload === "object" && !Array.isArray(payload) ? (payload as Record<string, unknown>) : undefined;
  const body = typeof record?.registration_token === "string" ? record.registration_token.trim() : "";

  return bearer || header || body;
}

function siteTokenFromRequest(request: Request, payload: unknown) {
  const authorization = request.headers.get("authorization") ?? "";
  const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  const header = request.headers.get("x-site-analytics-token")?.trim();
  const record = payload && typeof payload === "object" && !Array.isArray(payload) ? (payload as Record<string, unknown>) : undefined;
  const body = typeof record?.site_token === "string" ? record.site_token.trim() : "";

  return bearer || header || body;
}

function siteIdFromRequest(request: Request, payload: unknown) {
  const url = new URL(request.url);
  const query = url.searchParams.get("site_id") ?? url.searchParams.get("siteId") ?? "";
  const record = payload && typeof payload === "object" && !Array.isArray(payload) ? (payload as Record<string, unknown>) : undefined;
  const body = record?.site_id ?? record?.siteId;

  return typeof body === "string" ? body : query;
}

function json(payload: unknown, status = 200) {
  return Response.json(payload, {
    status,
    headers: corsHeaders()
  });
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Site-Analytics-Registration-Token, X-Site-Analytics-Token"
  };
}
