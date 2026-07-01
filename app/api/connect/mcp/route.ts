import {
  DELETE as integrationDelete,
  GET as integrationGet,
  OPTIONS as integrationOptions,
  POST as integrationPost
} from "../../ghl/mcp/route.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export function OPTIONS() {
  return integrationOptions();
}

export async function GET(request: Request) {
  return integrationGet(request);
}

export async function POST(request: Request) {
  return integrationPost(request);
}

export async function DELETE(request: Request) {
  return integrationDelete(request);
}
