import {
  getSiteAnalyticsSites,
  verifySiteAnalyticsToken
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
  const siteId = siteIdFromPayload(payload);
  const token = tokenFromRequest(request);

  if ((await getSiteAnalyticsSites()).length === 0) {
    return json({ error: "site_analytics_not_configured" }, 503);
  }

  if (!siteId || !(await verifySiteAnalyticsToken(siteId, token))) {
    return json({ error: "unauthorized_site" }, 401);
  }

  return json({
    ok: true,
    site_id: siteId,
    received_at: new Date().toISOString()
  });
}

async function safeJson(request: Request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function siteIdFromPayload(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return "";
  }

  const record = payload as Record<string, unknown>;
  const value = record.site_id ?? record.siteId;
  return typeof value === "string" ? value : "";
}

function tokenFromRequest(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  return bearer || request.headers.get("x-site-analytics-token")?.trim() || "";
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
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Site-Analytics-Token"
  };
}
