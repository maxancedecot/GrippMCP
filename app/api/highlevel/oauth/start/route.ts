import { GET as ghlStartGet } from "../../../ghl/oauth/start/route.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return ghlStartGet();
}
