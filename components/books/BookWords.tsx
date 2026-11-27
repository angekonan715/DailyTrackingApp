"use client";

import { useEffect, useState } from "react";
import type { BookWord } from "@/types";
import EmptyState from "@/components/EmptyState";
import { createClient } from "@/lib/supabase/client";
import { toDayKey } from "@/lib/dates";

const primary =
  "min-h-12 rounded-xl bg-accent px-4 text-base font-semibold text-white disabled:opacity-60 dark:text-neutral-950";

function explain(message: string): string {
  if (/book_words|schema cache|does not exist|relation/i.test(message)) {
    return "Word notes are not set up yet. In Supabase, open the SQL Editor, paste the word notes script, and run it.";
  }
  return message;
}

export default function BookWords({ bookId }: { bookId: string }) {
  const [words, setWords] = useState<BookWord[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [polishingId, setPolishingId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      try {
        const loaded = await loadWords(bookId);
        if (cancelled) return;
        setWords(loaded);
        setError(null);
      } catch (loadError) {
        if (!cancelled) setError(explain(loadError instanceof Error ? loadError.message : "Could not load words."));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [bookId]);

  async function explainWord(event: React.FormEvent) {
    event.preventDefault();
    const word = draft.trim();
    if (word.length < 2 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/book-word", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookId, word, today: toDayKey() }),
      });
      const body = (await response.json()) as { word?: BookWord; error?: string; already?: boolean };
      if (!response.ok || !body.word) {
        setError(body.error ?? "The coach did not explain that word.");
        return;
      }
      setWords((current) => [body.word as BookWord, ...current.filter((item) => item.id !== body.word?.id)]);
      if (!body.already) setDraft("");
    } catch {
      setError("The coach did not explain that word. Try again in a minute.");
    } finally {
      setBusy(false);
    }
  }

  async function polish(id: string) {
    setPolishingId(id);
    setError(null);
    try {
      const response = await fetch("/api/book-word", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wordId: id, polish: true, today: toDayKey() }),
      });
      const body = (await response.json()) as { word?: BookWord; error?: string };
      if (!response.ok || !body.word) {
        setError(body.error ?? "Could not update that word.");
        return;
      }
      setWords((current) => current.map((item) => (item.id === id ? (body.word as BookWord) : item)));
    } catch {
      setError("Could not update that word. Try again in a minute.");
    } finally {
      setPolishingId(null);
    }
  }

  async function remove(id: string) {
    const { error: deleteError } = await createClient().from("book_words").delete().eq("id", id);
    if (deleteError) {
      setError(explain(deleteError.message));
      return;
    }
    setConfirmId(null);
    setWords((current) => current.filter((item) => item.id !== id));
  }

  return (
    <div>
      <form onSubmit={(event) => void explainWord(event)} className="mb-4 flex gap-2">
        <label className="sr-only" htmlFor="book-word">
          Word
        </label>
        <input
          id="book-word"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          maxLength={80}
          placeholder="A word from this book"
          className="min-h-12 min-w-0 flex-1 rounded-xl bg-card px-4 text-base outline-none focus:ring-2 focus:ring-accent"
        />
        <button type="submit" disabled={busy || draft.trim().length < 2} className={primary}>
          {busy ? "Explaining…" : "Explain"}
        </button>
      </form>
      {error ? <p className="mb-4 text-sm text-red-600 dark:text-red-400">{error}</p> : null}
      {loading ? <div className="h-28 animate-pulse rounded-3xl bg-card" /> : null}
      {!loading && words.length === 0 ? (
        <EmptyState title="No words yet" hint="Add a word from the page you are reading. The coach explains it in one short sentence and an example." />
      ) : null}
      <div className="space-y-3">
        {words.map((item) => (
          <article key={item.id} className="rounded-3xl bg-[#fffdf8] p-5 text-slate-900 shadow-[0_16px_40px_rgba(0,0,0,0.22)]">
            <h3 className="text-2xl font-semibold tracking-tight">{item.word}</h3>
            <p className="mt-3 text-base leading-7">{item.definition}</p>
            <p className="mt-3 text-base leading-7 text-slate-600">
              <span className="font-semibold text-slate-800">Example. </span>
              {item.example}
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                disabled={polishingId === item.id}
                onClick={() => void polish(item.id)}
                className="min-h-11 text-sm font-semibold text-sky-700"
              >
                {polishingId === item.id ? "Updating…" : "Make it clearer"}
              </button>
              {confirmId === item.id ? (
                <button type="button" onClick={() => void remove(item.id)} className="min-h-11 text-sm font-medium text-red-600">
                  Delete
                </button>
              ) : (
                <button type="button" onClick={() => setConfirmId(item.id)} className="min-h-11 text-sm text-slate-500">
                  Delete
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

async function loadWords(bookId: string): Promise<BookWord[]> {
  const { data, error } = await createClient()
    .from("book_words")
    .select("id, user_id, book_id, word, definition, example, created_at, updated_at")
    .eq("book_id", bookId)
    .order("updated_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as BookWord[];
}
