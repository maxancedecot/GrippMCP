import { exchangeGhlAuthorizationCode } from "../../../../../src/ghl/oauth.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");

  if (!code) {
    return Response.json(
      {
        error: {
          code: "missing_oauth_code",
          message: "GoHighLevel did not include an OAuth authorization code."
        }
      },
      { status: 400 }
    );
  }

  try {
    const record = await exchangeGhlAuthorizationCode(code, request.url);
    return new Response(successHtml(url.origin, record), {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    return Response.json(
      {
        error: {
          code: "ghl_oauth_callback_failed",
          message: error instanceof Error ? error.message : "Could not complete GoHighLevel OAuth."
        }
      },
      { status: 500 }
    );
  }
}

function successHtml(
  origin: string,
  record: {
    installId: string;
    userType?: string;
    companyId?: string;
    locationId?: string;
    userId?: string;
    scope?: string;
    expiresAt: number;
  }
) {
  const mcpUrl = `${origin}/api/ghl/mcp?access_key=<GHL_MCP_ACCESS_KEY>&install_id=${encodeURIComponent(record.installId)}`;
  const rows = [
    ["Install ID", record.installId],
    ["User type", record.userType],
    ["Company ID", record.companyId],
    ["Location ID", record.locationId],
    ["User ID", record.userId],
    ["Expires at", new Date(record.expiresAt).toISOString()],
    ["Scopes", record.scope]
  ].filter(([, value]) => value);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>GoHighLevel MCP Connected</title>
    <style>
      :root { color-scheme: light dark; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      body { margin: 0; padding: 40px; line-height: 1.45; }
      main { max-width: 760px; margin: 0 auto; }
      code, pre { background: color-mix(in srgb, CanvasText 8%, transparent); border-radius: 6px; }
      code { padding: 2px 5px; }
      pre { overflow-x: auto; padding: 16px; }
      table { width: 100%; border-collapse: collapse; margin-top: 20px; }
      th, td { text-align: left; border-bottom: 1px solid color-mix(in srgb, CanvasText 15%, transparent); padding: 10px 0; vertical-align: top; }
      th { width: 150px; }
    </style>
  </head>
  <body>
    <main>
      <h1>GoHighLevel connected</h1>
      <p>The OAuth tokens were stored. Add this MCP URL in Claude after replacing <code>&lt;GHL_MCP_ACCESS_KEY&gt;</code> with your Vercel environment value:</p>
      <pre>${escapeHtml(mcpUrl)}</pre>
      <table>
        <tbody>
          ${rows.map(([label, value]) => `<tr><th>${escapeHtml(label ?? "")}</th><td>${escapeHtml(value ?? "")}</td></tr>`).join("")}
        </tbody>
      </table>
    </main>
  </body>
</html>`;
}

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
