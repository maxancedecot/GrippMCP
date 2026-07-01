import { GET as integrationCallbackGet } from "../../ghl/oauth/callback/route.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  return integrationCallbackGet(request);
}
