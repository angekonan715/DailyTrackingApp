"use client";

import { useEffect, useState } from "react";

export default function DailyQuote({
  today,
  quiet = false,
  className = "",
}: {
  today: string;
  quiet?: boolean;
  className?: string;
}) {
  const [quote, setQuote] = useState<string | null>(null);
  const [author, setAuthor] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (!today) return;
    let cancelled = false;
    async function run() {
      try {
        const params = new URLSearchParams({
          today,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        });
        const loaded = await fetch(`/api/daily-quote?${params}`, { cache: "no-store" });
        const body = (await loaded.json()) as { quote?: string | null; author?: string | null; error?: string };
        if (cancelled) return;
        if (loaded.status === 503) {
          if (!quiet) setNote(body.error ?? null);
          return;
        }
        if (typeof body.quote === "string" && body.quote) {
          setQuote(body.quote);
          setAuthor(body.author ?? "Daily Hub");
          return;
        }
        const created = await fetch("/api/daily-quote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            today,
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          }),
        });
        const next = (await created.json()) as {
          quote?: string | null;
          author?: string | null;
          code?: string;
          error?: string;
        };
        if (cancelled) return;
        if (typeof next.quote === "string" && next.quote) {
          setQuote(next.quote);
          setAuthor(next.author ?? "Daily Hub");
          return;
        }
        if (quiet) return;
        if (next.code === "missing_key") setNote("A daily quote shows here after the family key is saved.");
        else setNote(next.error ?? null);
      } catch {
        if (!cancelled && !quiet) setNote("The daily quote did not load.");
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [today, quiet]);

  if (!quote) {
    return note ? <p className="text-sm text-muted">{note}</p> : null;
  }

  return (
    <section className={`rounded-2xl bg-card px-4 py-3 ${className}`.trim()}>
      <p className="text-sm leading-6">“{quote}”</p>
      <p className="mt-1 text-xs text-muted">{author}</p>
    </section>
  );
}
