import { readSnapshotRefreshStatus } from "../../../../src/backgroundSnapshot.js";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id") ?? "";
  const headers = { "Cache-Control": "no-store" };
  if (!/^[a-f0-9]{64}$/.test(id)) return Response.json({ error: "Ongeldige aanvraag." }, { status: 400, headers });
  try {
    return Response.json(await readSnapshotRefreshStatus(id), { headers });
  } catch {
    return Response.json({ error: "Bijwerkstatus tijdelijk niet beschikbaar." }, { status: 503, headers });
  }
}
