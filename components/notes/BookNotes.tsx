"use client";

import { useEffect, useState } from "react";
import NoteEditor from "@/components/notes/NoteEditor";
import BookWords from "@/components/books/BookWords";
import EmptyState from "@/components/EmptyState";
import { createClient } from "@/lib/supabase/client";
import { relativeDayLabel } from "@/lib/dates";
import { explainNotesError, noteTitle } from "@/lib/notes";

interface BookNote {
  id: string;
  title: string;
  updated_at: string;
}

const primary = "min-h-12 w-full rounded-xl bg-accent px-4 text-base font-semibold text-white dark:text-neutral-950";

export default function BookNotes({
  bookId,
  showWords = false,
  startOnWords = false,
  onBack,
}: {
  bookId: string;
  showWords?: boolean;
  startOnWords?: boolean;
  onBack: () => void;
}) {
  const [notes, setNotes] = useState<BookNote[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [view, setView] = useState<"notes" | "words">(startOnWords ? "words" : "notes");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      try {
        const loaded = await loadBookNotes(bookId);
        if (cancelled) return;
        setNotes(loaded);
        setError(null);
      } catch (loadError) {
        if (!cancelled) setError(explainNotesError(loadError instanceof Error ? loadError.message : "Could not load notes."));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [bookId]);

  async function reload() {
    setNotes(await loadBookNotes(bookId));
  }

  async function createNote() {
    setBusy(true);
    setError(null);
    const { data, error: insertError } = await createClient()
      .from("notes")
      .insert({ book_id: bookId, title: "", body: "" })
      .select("id")
      .single();
    setBusy(false);
    if (insertError || !data) {
      setError(explainNotesError(insertError?.message ?? "Could not start the note."));
      return;
    }
    setOpenId(data.id);
  }

  if (openId) {
    return (
      <NoteEditor
        key={openId}
        noteId={openId}
        onBack={() => {
          setOpenId(null);
          void reload().catch((reason: Error) => setError(explainNotesError(reason.message)));
        }}
        onDeleted={() => {
          setOpenId(null);
          void reload().catch((reason: Error) => setError(explainNotesError(reason.message)));
        }}
      />
    );
  }

  return (
    <div>
      <button type="button" onClick={onBack} className="mb-4 min-h-12 text-base font-medium text-accent">
        Back to books
      </button>
      {showWords ? (
        <div className="mb-4 grid grid-cols-2 gap-2 rounded-2xl bg-card p-1">
          <button
            type="button"
            onClick={() => setView("words")}
            className={`min-h-11 rounded-xl text-sm font-semibold ${view === "words" ? "bg-accent text-white dark:text-neutral-950" : ""}`}
          >
            Words
          </button>
          <button
            type="button"
            onClick={() => setView("notes")}
            className={`min-h-11 rounded-xl text-sm font-semibold ${view === "notes" ? "bg-accent text-white dark:text-neutral-950" : ""}`}
          >
            Notes
          </button>
        </div>
      ) : null}
      {showWords && view === "words" ? <BookWords bookId={bookId} /> : null}
      {!showWords || view === "notes" ? (
        <>
          <button type="button" disabled={busy} onClick={() => void createNote()} className={`mb-4 ${primary}`}>
            New note
          </button>
          {error ? <p className="mb-4 text-sm text-red-600 dark:text-red-400">{error}</p> : null}
          {loading ? <div className="h-16 animate-pulse rounded-2xl bg-card" /> : null}
          {!loading && notes.length === 0 ? (
            <EmptyState title="No notes on this book yet" hint="Write what you want to remember. The coach can find it later." />
          ) : null}
          <div className="space-y-3">
            {notes.map((note) => (
              <button key={note.id} type="button" onClick={() => setOpenId(note.id)} className="block w-full rounded-2xl bg-card p-4 text-left">
                <span className="block font-semibold">{noteTitle(note.title)}</span>
                <span className="mt-1 block text-sm text-muted">{relativeDayLabel(note.updated_at.slice(0, 10))}</span>
              </button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

async function loadBookNotes(bookId: string): Promise<BookNote[]> {
  const { data, error } = await createClient()
    .from("notes")
    .select("id, title, updated_at")
    .eq("book_id", bookId)
    .order("updated_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as BookNote[];
}
