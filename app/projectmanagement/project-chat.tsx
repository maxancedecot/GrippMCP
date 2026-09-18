"use client";

import { useEffect, useRef, useState } from "react";
import { MessageCircle, Send, Square, ChevronDown, RotateCcw } from "lucide-react";
import {
  PROJECT_CHAT_MAX_MESSAGE_LENGTH, PROJECT_CHAT_MAX_MESSAGES,
  type ProjectChatEvent, type ProjectChatMessage, type ProjectChatSource
} from "../../src/projectChatTypes.js";

type DisplayMessage = ProjectChatMessage & { sources?: ProjectChatSource[] };
const suggestions = [
  "Welke projecten hebben deze week een deadline?",
  "Welke taken zijn te laat?",
  "Geef een overzicht van de lopende projecten."
];

export function ProjectChat({ configured }: { configured: boolean }) {
  const [expanded, setExpanded] = useState(true);
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [accessKey, setAccessKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [showAccess, setShowAccess] = useState(true);
  const requestRef = useRef<AbortController | null>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => () => requestRef.current?.abort(), []);
  useEffect(() => {
    const transcript = transcriptRef.current;
    if (transcript) transcript.scrollTop = transcript.scrollHeight;
  }, [messages, status]);

  async function sendMessage() {
    const question = draft.trim();
    if (!question || requestRef.current || !configured) return;
    if (!accessKey.trim()) {
      setError("Vul eerst het chatwachtwoord in.");
      setShowAccess(true);
      return;
    }
    // Retain complete user/assistant pairs; keep the latest ten exchanges.
    const history = messages.slice(-(PROJECT_CHAT_MAX_MESSAGES - 1)).map(({ role, content }) => ({ role, content }));
    const outgoing: ProjectChatMessage[] = [...history, { role: "user", content: question }];
    const abort = new AbortController();
    requestRef.current = abort;
    setBusy(true);
    setError("");
    setDraft("");
    setStatus("Verbinding maken met Claude…");
    setMessages((previous) => [...previous, { role: "user", content: question }]);
    let answered = false;
    try {
      const response = await fetch("/api/project-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-project-chat-key": accessKey.trim() },
        body: JSON.stringify({ messages: outgoing }),
        signal: abort.signal
      });
      if (!response.ok) {
        if (response.status === 401) setShowAccess(true);
        const result = await response.json().catch(() => ({}));
        throw new Error(typeof result.error === "string" ? result.error : "De vraag kon niet worden verstuurd.");
      }
      setShowAccess(false);
      const reader = response.body?.getReader();
      if (!reader) throw new Error("Geen antwoord ontvangen. Probeer het opnieuw.");
      const decoder = new TextDecoder();
      let buffer = "";
      function receive(line: string) {
        if (!line.trim()) return;
        const event = JSON.parse(line) as ProjectChatEvent;
        if (event.type === "status") setStatus(event.message);
        if (event.type === "error") throw new Error(event.message);
        if (event.type === "answer" && !answered) {
          answered = true;
          setMessages((previous) => [...previous, { role: "assistant", content: event.text, sources: event.sources }]);
        }
      }
      try {
        while (true) {
          const { done, value } = await reader.read();
          buffer += decoder.decode(value, { stream: !done });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          lines.forEach(receive);
          if (done) {
            receive(buffer);
            break;
          }
        }
      } finally {
        await reader.cancel().catch(() => undefined);
        reader.releaseLock();
      }
      if (!answered) throw new Error("De verbinding werd onderbroken. Probeer het opnieuw.");
    } catch (failure) {
      if (!answered) {
        setMessages((previous) => previous.slice(0, -1));
        setDraft(question);
      }
      setError(abort.signal.aborted ? "Vraag gestopt. Je kunt je vraag aanpassen en opnieuw versturen."
        : failure instanceof Error ? failure.message : "Er ging iets mis. Probeer het opnieuw.");
    } finally {
      requestRef.current = null;
      setBusy(false);
      setStatus("");
      inputRef.current?.focus();
    }
  }

  return (
    <section className="panel project-chat" aria-labelledby="project-chat-title">
      <div className="panel-heading project-chat__heading">
        <div className="project-chat__title">
          <MessageCircle size={23} aria-hidden="true" />
          <div><p className="eyebrow">Claude · Gripp</p><h2 id="project-chat-title">Projectassistent</h2></div>
        </div>
        <div className="project-chat__actions">
          {messages.length > 0 ? <button type="button" disabled={busy} onClick={() => { setMessages([]); setError(""); setDraft(""); }}>
            <RotateCcw size={15} aria-hidden="true" /> Nieuw gesprek
          </button> : null}
          <button type="button" aria-expanded={expanded} aria-controls="project-chat-content" onClick={() => setExpanded(!expanded)}>
            {expanded ? "Inklappen" : "Open chat"}<ChevronDown size={16} className={expanded ? "project-chat__chevron--open" : ""} aria-hidden="true" />
          </button>
        </div>
      </div>
      <div id="project-chat-content" hidden={!expanded}>
        {!configured ? <p className="project-chat__notice">De projectassistent is nog niet ingesteld. Zodra de beheerder Claude en de chattoegang activeert, kun je hier vragen stellen over Gripp.</p> : null}
        <div className="project-chat__transcript" ref={transcriptRef} role="log" aria-label="Gesprek met de projectassistent" aria-live="polite" aria-relevant="additions">
          {messages.length === 0 ? <div className="project-chat__welcome">
            <h3>Wat wil je weten over je projecten?</h3>
            <p>Vraag naar deadlines, openstaande taken, klanten of projectbedragen. Claude zoekt de gegevens op in Gripp.</p>
            <div className="project-chat__suggestions">{suggestions.map((question) => (
              <button type="button" key={question} disabled={!configured || busy} onClick={() => { setDraft(question); inputRef.current?.focus(); }}>{question}</button>
            ))}</div>
          </div> : messages.map((message, index) => (
            <article className={`project-chat__message project-chat__message--${message.role}`} key={index}>
              <strong>{message.role === "user" ? "Jij" : "Claude"}</strong>
              <div className="project-chat__text">{message.content}</div>
              {message.sources?.length ? <details className="project-chat__sources">
                <summary>Gripp geraadpleegd · {message.sources.length} opvragingen</summary>
                <ul>{message.sources.map((source, sourceIndex) => (
                  <li key={sourceIndex}>{sourceLabel(source)}{source.status === "error" ? " — mislukt" : ""}</li>
                ))}</ul>
              </details> : null}
            </article>
          ))}
        </div>
        <p className="project-chat__status" role="status">{busy ? status : ""}</p>
        <form className="project-chat__form" onSubmit={(event) => { event.preventDefault(); void sendMessage(); }}>
          {configured ? <details className="project-chat__access" open={showAccess} onToggle={(event) => setShowAccess(event.currentTarget.open)}>
            <summary>Chattoegang</summary>
            <label htmlFor="project-chat-key">Chatwachtwoord</label>
            <input id="project-chat-key" type="password" autoComplete="current-password" value={accessKey} disabled={busy} maxLength={256} onChange={(event) => setAccessKey(event.target.value)} placeholder="Wachtwoord van je beheerder" />
          </details> : null}
          <label className="sr-only" htmlFor="project-chat-question">Je vraag aan Claude</label>
          <textarea id="project-chat-question" ref={inputRef} rows={2} maxLength={PROJECT_CHAT_MAX_MESSAGE_LENGTH} value={draft} disabled={busy || !configured}
            placeholder="Stel een vraag over je projecten…" onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void sendMessage(); } }} />
          {error ? <p className="project-chat__error" role="alert">{error}</p> : null}
          <div className="project-chat__footer">
            <small>Alleen lezen · Enter om te versturen, Shift+Enter voor een nieuwe regel</small>
            {busy ? <button type="button" onClick={() => requestRef.current?.abort()}><Square size={15} aria-hidden="true" /> Stoppen</button>
              : <button className="project-chat__send" type="submit" disabled={!configured || !draft.trim()}><Send size={15} aria-hidden="true" /> Versturen</button>}
          </div>
        </form>
      </div>
    </section>
  );
}

function sourceLabel(source: ProjectChatSource) {
  const action = source.tool === "gripp_list_entities" ? "Beschikbare gegevens"
    : source.tool === "gripp_describe_entity" ? "Veldbeschrijving" : "Gegevens opgehaald";
  return `${action}${source.entity ? ` · ${source.entity}` : ""}`;
}
