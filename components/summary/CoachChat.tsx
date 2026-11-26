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
    <section className="rounded-2xl bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-semibold">Coach chat</h2>
        {messages.length > 0 ? (
          <button type="button" onClick={() => void clearChat()} className="min-h-11 px-2 text-sm font-medium text-muted">
            Clear
          </button>
        ) : null}
      </div>
      <p className="mt-1 text-sm text-muted">Uses your own week, not anyone else’s. The family shares a $5 monthly limit.</p>
      <div className="mt-3 max-h-72 space-y-2 overflow-y-auto">
        {loading ? <div className="h-16 animate-pulse rounded-xl bg-background" /> : null}
        {!loading && messages.length === 0 ? (
          <p className="text-sm text-muted">Ask about your week, a workout, a book, or a habit.</p>
        ) : null}
        {messages.map((message) => (
          <p
            key={message.id}
            className={`rounded-2xl px-3 py-2 text-sm leading-6 ${
              message.role === "user" ? "ml-8 bg-accent text-white dark:text-neutral-950" : "mr-8 bg-background"
            }`}
          >
            {message.content}
          </p>
        ))}
        {sending ? <p className="text-sm text-muted">Thinking…</p> : null}
        <div ref={bottom} />
      </div>
      {error ? <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p> : null}
      <form onSubmit={send} className="mt-3 flex gap-2">
        <label htmlFor="coach-message" className="sr-only">
          Message
        </label>
        <input
          id="coach-message"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          maxLength={500}
          placeholder="Ask the coach"
          className="min-h-12 min-w-0 flex-1 rounded-xl bg-background px-4 text-base outline-none focus:ring-2 focus:ring-accent"
        />
        <button
          type="submit"
          disabled={sending || draft.trim().length === 0}
          className="min-h-12 shrink-0 rounded-xl bg-accent px-4 text-sm font-semibold text-white disabled:opacity-60 dark:text-neutral-950"
        >
          Send
        </button>
      </form>
    </section>
  );
}
