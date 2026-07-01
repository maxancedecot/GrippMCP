import {
  DELETE as ghlDelete,
  GET as ghlGet,
  OPTIONS as ghlOptions,
  POST as ghlPost
} from "../../ghl/mcp/route.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export function OPTIONS() {
  return ghlOptions();
}

export async function GET(request: Request) {
  return ghlGet(request);
}

export async function POST(request: Request) {
  return ghlPost(request);
}

export async function DELETE(request: Request) {
  return ghlDelete(request);
}
