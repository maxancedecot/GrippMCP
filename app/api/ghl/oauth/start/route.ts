import { getGhlInstallUrl } from "../../../../../src/ghl/oauth.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  try {
    return Response.redirect(getGhlInstallUrl(request.url), 302);
  } catch (error) {
    return Response.json(
      {
        error: {
          code: "ghl_oauth_start_failed",
          message: error instanceof Error ? error.message : "Could not start GoHighLevel OAuth."
        }
      },
      { status: 500 }
    );
  }
}
