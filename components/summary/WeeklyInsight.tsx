"use client";

import { useEffect, useState } from "react";

const primary =
  "min-h-12 w-full rounded-xl bg-accent px-4 text-base font-semibold text-white disabled:opacity-60 dark:text-neutral-950";

interface InsightBody {
  summary?: string | null;
  recommendations?: string[];
  tips?: string[] | null;
  cached?: boolean;
  monthCents?: number;
  sharedSpend?: boolean;
  code?: string;
  error?: string;
}

interface KeyBody {
  configured?: boolean;
  shared?: boolean;
  canManage?: boolean;
  server?: boolean;
  warning?: string | null;
  error?: string;
}

function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export default function WeeklyInsight({ today }: { today: string }) {
  const [summary, setSummary] = useState<string | null>(null);
  const [recommendations, setRecommendations] = useState<string[]>([]);
  const [tips, setTips] = useState<string[] | null>(null);
  const [cached, setCached] = useState(false);
  const [monthCents, setMonthCents] = useState(0);
  const [sharedSpend, setSharedSpend] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [asking, setAsking] = useState(false);
  const [key, setKey] = useState("");
  const [configured, setConfigured] = useState(false);
  const [canManage, setCanManage] = useState(false);
  const [serverKey, setServerKey] = useState(false);
  const [keyMessage, setKeyMessage] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      try {
        const response = await fetch("/api/openai-key", { cache: "no-store" });
        const body = (await response.json()) as KeyBody;
        if (cancelled) return;
        setConfigured(Boolean(body.configured));
        setCanManage(Boolean(body.canManage));
        setServerKey(Boolean(body.server));
        if (!response.ok && body.error) setKeyMessage(body.error);
      } catch {
        if (!cancelled) setKeyMessage("Could not check the OpenAI key.");
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!today) return;
    let cancelled = false;
    async function run() {
      try {
        const response = await fetch(`/api/weekly-insight?today=${today}`, { cache: "no-store" });
        const body = (await response.json()) as InsightBody;
        if (cancelled) return;
        applyInsight(body, response.ok);
      } catch {
        if (!cancelled) setError("Could not load the coach.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [today]);

  function applyInsight(body: InsightBody, ok: boolean) {
    setMonthCents(Number(body.monthCents ?? 0));
    setSharedSpend(Boolean(body.sharedSpend));
    if (body.code === "missing_key" || body.code === "needs_server") {
      setNotice(body.error ?? null);
      setError(null);
      return;
    }
    if (!ok) {
      setError(body.error ?? "Could not load the coach.");
      return;
    }
    setSummary(body.summary ?? null);
    setRecommendations(body.recommendations ?? []);
    setTips(body.tips ?? null);
    setCached(Boolean(body.cached));
    setNotice(null);
    setError(body.error ?? null);
  }

  async function ask() {
    setAsking(true);
    setError(null);
    try {
      const response = await fetch("/api/weekly-insight", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          today,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      });
      const body = (await response.json()) as InsightBody;
      applyInsight(body, response.ok && Boolean(body.summary));
      if (body.code === "missing_key" || body.code === "needs_server") return;
      if (!response.ok || !body.summary) setError(body.error ?? "The coach did not answer.");
    } catch {
      setError("The coach did not answer. Try again in a minute.");
    } finally {
      setAsking(false);
    }
  }

  async function saveKey(event: React.FormEvent) {
    event.preventDefault();
    setSavingKey(true);
    setKeyMessage(null);
    try {
      const response = await fetch("/api/openai-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key }),
      });
      const body = (await response.json()) as KeyBody;
      if (!response.ok) {
        setKeyMessage(body.error ?? "Could not save the key.");
        return;
      }
      setConfigured(Boolean(body.configured));
      setKey("");
      setNotice(null);
      setKeyMessage(body.warning || (body.configured ? "Family key saved. Everyone can use the coach." : "Key removed."));
    } catch {
      setKeyMessage("Could not save the key.");
    } finally {
      setSavingKey(false);
    }
  }

  async function removeKey() {
    setSavingKey(true);
    setKeyMessage(null);
    setKey("");
    try {
      const response = await fetch("/api/openai-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "" }),
      });
      const body = (await response.json()) as KeyBody;
      if (!response.ok) {
        setKeyMessage(body.error ?? "Could not remove the key.");
        return;
      }
      setConfigured(false);
      setKeyMessage("Key removed.");
    } catch {
      setKeyMessage("Could not remove the key.");
    } finally {
      setSavingKey(false);
    }
  }

  return (
    <section className="rounded-2xl bg-card p-4">
      <h2 className="font-semibold">Weekly insight</h2>
      <p className="mt-1 text-sm text-muted">
        {sharedSpend ? "Family coach · " : ""}
        {money(monthCents)} of $5 used this month
      </p>

      {serverKey ? (
        <p className="mt-3 text-sm text-muted">The family key is set on the server. Everyone can use the coach.</p>
      ) : canManage ? (
        <form onSubmit={saveKey} className="mt-3 space-y-2">
          <label htmlFor="openai-key" className="block text-sm font-medium">
            Family OpenAI key
          </label>
          <p className="text-sm text-muted">One key for the whole family. It stays hidden from everyone else.</p>
          <input
            id="openai-key"
            type="password"
            autoComplete="off"
            value={key}
            onChange={(event) => setKey(event.target.value)}
            placeholder={configured ? "A key is saved" : "sk-..."}
            className="w-full min-h-12 rounded-xl bg-background px-4 text-base outline-none focus:ring-2 focus:ring-accent"
          />
          <div className="flex gap-2">
            <button type="submit" disabled={savingKey || key.trim().length === 0} className={primary}>
              {savingKey ? "Saving…" : "Save key"}
            </button>
            {configured ? (
              <button
                type="button"
                disabled={savingKey}
                onClick={() => void removeKey()}
                className="min-h-12 shrink-0 rounded-xl bg-background px-4 text-sm font-medium"
              >
                Remove
              </button>
            ) : null}
          </div>
        </form>
      ) : (
        <p className="mt-3 text-sm text-muted">
          {configured
            ? "Everyone in the family can use this coach. The key stays hidden."
            : "The person who started the family adds the OpenAI key once. Then the quote, summary, and chat work for everyone."}
        </p>
      )}
      {keyMessage ? <p className="mt-2 text-sm text-muted">{keyMessage}</p> : null}

      {loading ? <div className="mt-3 h-16 animate-pulse rounded-xl bg-background" /> : null}
      {notice ? <p className="mt-3 text-sm text-muted">{notice}</p> : null}
      {error ? <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p> : null}
      {summary ? <p className="mt-3 text-sm leading-6">{summary}</p> : null}
      {recommendations.length > 0 ? (
        <>
          <h3 className="mt-4 text-sm font-semibold">From a coach</h3>
          <ul className="mt-2 list-disc space-y-2 pl-5 text-sm">
            {recommendations.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted">General coaching, not medical advice.</p>
        </>
      ) : null}
      {tips ? (
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm">
          {tips.map((tip) => (
            <li key={tip}>{tip}</li>
          ))}
        </ol>
      ) : null}
      {summary && cached ? <p className="mt-3 text-sm text-muted">Saved for this week. A new summary arrives next week.</p> : null}
      {!loading && !summary && !notice ? (
        <button type="button" onClick={() => void ask()} disabled={asking} className={`mt-3 ${primary}`}>
          {asking ? "Thinking…" : "Weekly insight"}
        </button>
      ) : null}
    </section>
  );
}
