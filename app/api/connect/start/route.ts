import { GET as integrationStartGet } from "../../ghl/oauth/start/route.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return integrationStartGet(request);
}
