import { GET as ghlStartGet } from "../../../ghl/oauth/start/route.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return ghlStartGet(request);
}
