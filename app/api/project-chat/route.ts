import {
  checkProjectChatAccess, createProjectChatMcp, ProjectChatError,
  projectChatConfigured, projectChatGrippToken, projectChatRequestSchema, runProjectChat
} from "../../../src/projectChat.js";
import type { ProjectChatEvent } from "../../../src/projectChatTypes.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MAX_BODY_BYTES = 200000;
// Per-instance protection in addition to the shared chat password and bounded agent loop.
let activeRequests = 0;
let windowStart = 0;
let windowRequests = 0;

function errorResponse(message: string, status: number) {
  return Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) {
    return errorResponse("Dit verzoek moet vanuit de projectmanagementpagina komen.", 403);
  }
  if (!projectChatConfigured()) return errorResponse("De projectassistent is nog niet ingesteld.", 503);
  if (!checkProjectChatAccess(request.headers.get("x-project-chat-key"))) {
    return errorResponse("Vul het juiste chatwachtwoord in.", 401);
  }
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return errorResponse("Ongeldig verzoek.", 415);
  }
  let payload: unknown;
  try {
    const reader = request.body?.getReader();
    if (!reader) return errorResponse("Je vraag ontbreekt.", 400);
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BODY_BYTES) {
          await reader.cancel();
          return errorResponse("Het gesprek is te lang. Start een nieuw gesprek.", 413);
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return errorResponse("Het verzoek kon niet worden gelezen.", 400);
  }
  const parsed = projectChatRequestSchema.safeParse(payload);
  if (!parsed.success) return errorResponse("Ongeldig of te lang gesprek. Verkort je vraag of start een nieuw gesprek.", 400);
  if (Date.now() - windowStart >= 60000) {
    windowStart = Date.now();
    windowRequests = 0;
  }
  if (activeRequests >= 3 || windowRequests >= 20) return errorResponse("Er lopen te veel vragen tegelijk. Probeer het zo opnieuw.", 429);
  activeRequests++;
  windowRequests++;

  const cancellation = new AbortController();
  const signal = AbortSignal.any([request.signal, cancellation.signal, AbortSignal.timeout(105000)]);
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      let mcp: Awaited<ReturnType<typeof createProjectChatMcp>> | undefined;
      const emit = (event: ProjectChatEvent) => {
        if (!cancellation.signal.aborted && !request.signal.aborted) controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };
      try {
        mcp = await createProjectChatMcp({
          token: projectChatGrippToken(), timeoutMs: 12000, maxRetries: 0,
          fetchImpl: (input, init) => fetch(input, {
            ...init, signal: init?.signal ? AbortSignal.any([init.signal, signal]) : signal
          })
        }, signal);
        await runProjectChat({
          messages: parsed.data.messages,
          apiKey: process.env.ANTHROPIC_API_KEY!.trim(),
          model: process.env.ANTHROPIC_MODEL?.trim() || "claude-sonnet-5",
          mcp, signal, emit
        });
      } catch (error) {
        emit({ type: "error", message: signal.aborted
          ? "Deze vraag duurde te lang. Probeer een kortere vraag of één project tegelijk."
          : error instanceof ProjectChatError ? error.message : "De verbinding met de projectassistent is mislukt. Probeer het opnieuw." });
      } finally {
        await mcp?.close();
        activeRequests--;
        if (!cancellation.signal.aborted && !request.signal.aborted) controller.close();
      }
    },
    cancel() { cancellation.abort(); }
  });
  return new Response(body, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no"
    }
  });
}
