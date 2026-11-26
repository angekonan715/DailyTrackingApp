"use client";

import { useEffect, useState } from "react";

const primary =
  "min-h-12 w-full rounded-xl bg-accent px-4 text-base font-semibold text-white disabled:opacity-60 dark:text-neutral-950";

interface InsightBody {
  tips?: string[] | null;
  cached?: boolean;
  monthCents?: number;
  code?: string;
  error?: string;
}

function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export default function WeeklyInsight({ today }: { today: string }) {
  const [tips, setTips] = useState<string[] | null>(null);
  const [cached, setCached] = useState(false);
  const [monthCents, setMonthCents] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    if (!today) return;
    let cancelled = false;
    async function run() {
      try {
        const response = await fetch(`/api/weekly-insight?today=${today}`, { cache: "no-store" });
        const body = (await response.json()) as InsightBody;
        if (cancelled) return;
        setMonthCents(Number(body.monthCents ?? 0));
        if (!response.ok) {
          setError(body.error ?? "Could not load the coach.");
          return;
        }
        setTips(body.tips ?? null);
        setCached(Boolean(body.cached));
        setNotice(body.code === "missing_key" ? (body.error ?? null) : null);
        setError(body.code === "missing_key" ? null : (body.error ?? null));
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
      setMonthCents(Number(body.monthCents ?? monthCents));
      if (body.code === "missing_key") {
        setNotice(body.error ?? null);
        return;
      }
      if (!response.ok || !body.tips) {
        setError(body.error ?? "The coach did not answer.");
        return;
      }
      setTips(body.tips);
      setCached(Boolean(body.cached));
      setNotice(null);
    } catch {
      setError("The coach did not answer. Try again in a minute.");
    } finally {
      setAsking(false);
    }
  }

  return (
    <section className="rounded-2xl bg-card p-4">
      <h2 className="font-semibold">Weekly insight</h2>
      <p className="mt-1 text-sm text-muted">{money(monthCents)} of $5 used this month</p>
      {loading ? <div className="mt-3 h-16 animate-pulse rounded-xl bg-background" /> : null}
      {notice ? <p className="mt-3 text-sm text-muted">{notice}</p> : null}
      {error ? <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p> : null}
      {tips ? (
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm">
          {tips.map((tip) => (
            <li key={tip}>{tip}</li>
          ))}
        </ol>
      ) : null}
      {tips && cached ? <p className="mt-3 text-sm text-muted">Saved for this week. New tips arrive next week.</p> : null}
      {!loading && !tips && !notice ? (
        <button type="button" onClick={() => void ask()} disabled={asking} className={`mt-3 ${primary}`}>
          {asking ? "Thinking…" : "Weekly insight"}
        </button>
      ) : null}
    </section>
  );
}
