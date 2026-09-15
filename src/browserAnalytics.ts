import { z } from "zod";
import { getSiteAnalyticsSites, recordSiteAnalyticsEvent, registerBrowserSiteAnalyticsSite } from "./siteAnalytics.js";

// Public project identifier, not a credential. This endpoint only accepts browser measurements.
export const BROWSER_ANALYTICS_PROJECT = "ledoux";
const identifier = z.string().min(1).max(200);
const eventSchema = z.object({
  project: z.literal(BROWSER_ANALYTICS_PROJECT),
  event_type: z.enum(["page_view", "engagement", "scroll"]),
  visitor_id: identifier,
  session_id: identifier,
  page_view_id: identifier,
  page_url: z.string().url().max(2000),
  page_title: z.string().max(180).optional(),
  referrer: z.string().max(2000).optional(),
  source: z.string().max(80).optional(),
  medium: z.string().max(80).optional(),
  active_time_ms_delta: z.number().finite().min(0).max(60_000).optional(),
  scroll_percent: z.number().finite().min(0).max(100).optional()
}).strict();

export function browserAnalyticsOptions(request: Request) {
  const origin = publicOrigin(request.headers.get("origin"));
  return new Response(null, { status: origin ? 204 : 403, headers: headers(origin) });
}

export async function collectBrowserAnalytics(request: Request) {
  const origin = publicOrigin(request.headers.get("origin"));
  if (!origin) return reply({ error: "invalid_origin" }, 403, null);
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw) > 8192) return reply({ error: "event_too_large" }, 413, origin);
    const parsed = eventSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return reply({ error: "invalid_event" }, 400, origin);
    const event = parsed.data;
    const page = new URL(event.page_url);
    // Neither a body-supplied site ID nor a public browser identifier can select another site's data.
    if (page.origin !== origin || page.username || page.password) return reply({ error: "origin_mismatch" }, 403, origin);
    if (/^\/(?:v2\/preview|wp-admin|wp-login\.php)(?:\/|$)/i.test(page.pathname)) {
      return reply({ error: "preview_or_admin_page" }, 400, origin);
    }
    const siteUrl = canonicalOrigin(origin);
    const sites = await getSiteAnalyticsSites();
    const existing = sites.filter((site) => {
      try {
        const url = new URL(site.url);
        const prefix = url.pathname.replace(/\/$/, "");
        return canonicalOrigin(url.origin) === siteUrl && (!prefix || page.pathname === prefix || page.pathname.startsWith(`${prefix}/`));
      } catch { return false; }
    }).sort((a, b) => b.url.length - a.url.length)[0];
    if (!existing && event.event_type !== "page_view") return reply({ error: "page_view_required" }, 409, origin);
    const site = existing ?? await registerBrowserSiteAnalyticsSite(siteUrl);
    await recordSiteAnalyticsEvent({
      site_id: site.id,
      event_type: event.event_type,
      visitor_id: event.visitor_id,
      session_id: event.session_id,
      page_view_id: event.page_view_id,
      page_url: measurementUrl(page),
      page_title: event.page_title,
      referrer: referrerOrigin(event.referrer),
      source: event.source,
      medium: event.medium,
      active_time_ms_delta: event.active_time_ms_delta,
      scroll_percent: event.scroll_percent
    });
    return reply({ ok: true }, 200, origin);
  } catch (error) {
    return reply({ error: error instanceof SyntaxError ? "invalid_event" : "measurement_unavailable" }, error instanceof SyntaxError ? 400 : 503, origin);
  }
}

function publicOrigin(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    if (raw !== url.origin || url.protocol !== "https:" || url.port || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(host)
      || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")
      || ["app.gohighlevel.com", "app.leadconnectorhq.com"].includes(host)) return null;
    return url.origin;
  } catch { return null; }
}

function canonicalOrigin(origin: string) {
  const url = new URL(origin);
  url.hostname = url.hostname.replace(/^www\./, "");
  return url.origin;
}

function measurementUrl(url: URL) {
  const clean = new URL(url.origin + url.pathname);
  // Preserve the existing per-project thank-you-page mapping, without contact details or click IDs.
  const project = url.searchParams.get("p_slug");
  if (project) clean.searchParams.set("p_slug", project.slice(0, 240));
  return clean.toString();
}

function referrerOrigin(value?: string) {
  try { return value ? new URL(value).origin : ""; } catch { return ""; }
}

function headers(origin: string | null): HeadersInit {
  return {
    "Cache-Control": "no-store", "Vary": "Origin",
    ...(origin ? { "Access-Control-Allow-Origin": origin } : {}),
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}

function reply(body: unknown, status: number, origin: string | null) {
  return Response.json(body, { status, headers: headers(origin) });
}
