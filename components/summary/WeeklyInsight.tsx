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

  useEffect(() => {
    if (!today) return;
    let cancelled = false;
    async function run() {
      try {
        const response = await fetch(`/api/weekly-insight?today=${today}`, { cache: "no-store" });
        const body = (await response.json()) as InsightBody;
        if (cancelled) return;
        applyInsight(body, response.ok);
        if (response.ok && !body.summary && body.code !== "missing_key" && body.code !== "needs_server") {
          await ask();
        }
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
    // ask is recreated each render and only used for the first load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  return (
    <section className="rounded-2xl bg-card p-4">
      <h2 className="font-semibold">This week</h2>
      <p className="mt-1 text-sm text-muted">
        {sharedSpend ? "Family coach · " : ""}
        {money(monthCents)} of $5 used this month
      </p>
      {loading || asking ? <div className="mt-3 h-16 animate-pulse rounded-xl bg-background" /> : null}
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
      {summary && cached ? <p className="mt-3 text-sm text-muted">Saved for this week.</p> : null}
      {!loading && !asking && !summary && !notice ? (
        <button type="button" onClick={() => void ask()} className={`mt-3 ${primary}`}>
          Write this week
        </button>
      ) : null}
    </section>
  );
}
