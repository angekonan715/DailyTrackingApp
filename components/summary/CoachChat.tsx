"use client";

import { useEffect, useRef, useState } from "react";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

export default function CoachChat({ today }: { today: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const bottom = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      try {
        const response = await fetch("/api/coach-chat", { cache: "no-store" });
        const body = (await response.json()) as { messages?: ChatMessage[]; error?: string };
        if (cancelled) return;
        setMessages(body.messages ?? []);
        if (!response.ok && body.error) setError(body.error);
      } catch {
        if (!cancelled) setError("The chat did not load.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [messages, sending]);

  async function send(event: React.FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setError(null);
    setDraft("");
    const pending = { id: `local-${Date.now()}`, role: "user" as const, content: text };
    setMessages((current) => current.concat(pending));
    try {
      const response = await fetch("/api/coach-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          today,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          message: text,
        }),
      });
      const body = (await response.json()) as { reply?: string; error?: string; code?: string };
      const reply = body.reply?.trim() ?? "";
      if (body.code === "missing_key" || body.code === "needs_server" || !response.ok || !reply) {
        setError(body.error ?? "The coach did not answer.");
        return;
      }
      setMessages((current) => current.concat({ id: `local-reply-${Date.now()}`, role: "assistant", content: reply }));
    } catch {
      setError("The coach did not answer. Try again in a minute.");
    } finally {
      setSending(false);
    }
  }

  async function clearChat() {
    setError(null);
    const response = await fetch("/api/coach-chat", { method: "DELETE" });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? "Could not clear the chat.");
      return;
    }
    setMessages([]);
  }

  return (
    <section className="flex h-[min(32rem,72vh)] w-full flex-col overflow-hidden rounded-3xl border border-white/70 bg-white text-slate-900 shadow-[0_24px_70px_rgba(0,0,0,0.45)]">
      <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-white" aria-hidden>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path
              d="M5 6.5A2.5 2.5 0 0 1 7.5 4h9A2.5 2.5 0 0 1 19 6.5v7A2.5 2.5 0 0 1 16.5 16H9l-4 3.5V6.5Z"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        <h2 className="min-w-0 flex-1 text-base font-semibold">Coach</h2>
        {messages.length > 0 ? (
          <button type="button" onClick={() => void clearChat()} className="min-h-11 px-2 text-sm font-medium text-slate-500">
            Clear
          </button>
        ) : null}
      </header>
      <div className="flex-1 space-y-3 overflow-y-auto bg-[#e7eef8] px-3 py-4">
        {loading ? <div className="h-16 animate-pulse rounded-2xl bg-white/80" /> : null}
        {!loading && messages.length === 0 ? (
          <p className="mr-10 rounded-2xl rounded-bl-md bg-white px-3 py-2 text-sm leading-6 text-slate-800 shadow-sm">
            What can I help with today?
          </p>
        ) : null}
        {messages.map((message) => (
          <p
            key={message.id}
            className={`max-w-[85%] px-3 py-2 text-sm leading-6 shadow-sm ${
              message.role === "user"
                ? "ml-auto rounded-2xl rounded-br-md bg-accent text-white"
                : "mr-auto rounded-2xl rounded-bl-md bg-white text-slate-800"
            }`}
          >
            {message.content}
          </p>
        ))}
        {sending ? (
          <p className="mr-auto rounded-2xl rounded-bl-md bg-white px-3 py-2 text-sm text-slate-500 shadow-sm">Thinking…</p>
        ) : null}
        <div ref={bottom} />
      </div>
      {error ? <p className="bg-[#e7eef8] px-4 pb-2 text-sm text-red-600">{error}</p> : null}
      <form onSubmit={send} className="flex items-center gap-2 border-t border-slate-200 bg-white px-3 py-3">
        <label htmlFor="coach-message" className="sr-only">
          Message
        </label>
        <input
          id="coach-message"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          maxLength={500}
          placeholder="Message"
          className="min-h-12 min-w-0 flex-1 rounded-full bg-[#e7eef8] px-4 text-base text-slate-900 outline-none ring-1 ring-transparent placeholder:text-slate-400 focus:ring-accent"
        />
        <button
          type="submit"
          disabled={sending || draft.trim().length === 0}
          className="min-h-12 shrink-0 rounded-full bg-accent px-4 text-sm font-semibold text-white disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </section>
  );
}
