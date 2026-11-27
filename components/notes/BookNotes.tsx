"use client";

import { useEffect, useState } from "react";
import NoteEditor from "@/components/notes/NoteEditor";
import BookWords from "@/components/books/BookWords";
import { createClient } from "@/lib/supabase/client";
import { relativeDayLabel } from "@/lib/dates";
import { explainNotesError } from "@/lib/notes";
import { moveNoteToTrash, purgeExpiredTrash } from "@/lib/note-trash";
import { ensureLibrary, newWordFileTitle, readingNotesTitle, reviveBookFile, type BookFileRole } from "@/lib/book-files";

interface ShelfFile {
  id: string;
  title: string;
  updated_at: string;
  book_id: string | null;
}

export default function BookNotes({
  bookId,
  bookTitle,
  showWords = false,
  onBack,
}: {
  bookId: string;
  bookTitle: string;
  showWords?: boolean;
  onBack: () => void;
}) {
  const [reading, setReading] = useState<ShelfFile | null>(null);
  const [wordFile, setWordFile] = useState<ShelfFile | null>(null);
  const [extras, setExtras] = useState<ShelfFile[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      try {
        const loaded = await loadShelf(bookId, bookTitle);
        if (cancelled) return;
        setReading(loaded.reading);
        setWordFile(loaded.wordFile);
        setExtras(loaded.extras);
        setError(loaded.warning ? explainNotesError(loaded.warning) : null);
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
  }, [bookId, bookTitle]);

  async function reload() {
    const loaded = await loadShelf(bookId, bookTitle);
    setReading(loaded.reading);
    setWordFile(loaded.wordFile);
    setExtras(loaded.extras);
    if (loaded.warning) setError(explainNotesError(loaded.warning));
  }

  async function addFile(role: BookFileRole) {
    setBusy(true);
    setError(null);
    const revived = await reviveBookFile(createClient(), { id: bookId, title: bookTitle }, role);
    setBusy(false);
    if (revived.error || !revived.id) {
      setError(explainNotesError(revived.error ?? "Could not add that file."));
      return;
    }
    setOpenId(revived.id);
    await reload().catch((reason: Error) => setError(explainNotesError(reason.message)));
  }

  async function removeNote(id: string) {
    setBusy(true);
    const deleteError = await moveNoteToTrash(id);
    setBusy(false);
    if (deleteError) {
      setError(explainNotesError(deleteError));
      return;
    }
    setConfirmId(null);
    await reload().catch((reason: Error) => setError(explainNotesError(reason.message)));
  }

  if (openId) {
    return (
      <NoteEditor
        key={openId}
        noteId={openId}
        context={bookTitle}
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

  const readingTitle = readingNotesTitle(bookTitle);
  const wordTitle = newWordFileTitle(bookTitle);

  return (
    <div>
      <button type="button" onClick={onBack} className="mb-4 min-h-12 text-base font-medium text-accent">
        Back to books
      </button>
      {error ? <p className="mb-4 text-sm text-red-600 dark:text-red-400">{error}</p> : null}
      {loading ? <div className="h-16 animate-pulse rounded-2xl bg-card" /> : null}
      {!loading ? (
        <div className="mb-5 space-y-3">
          <FileRow
            title={readingTitle}
            hint="Notes from this book"
            file={reading}
            confirmId={confirmId}
            busy={busy}
            onOpen={setOpenId}
            onConfirm={setConfirmId}
            onDelete={(id) => void removeNote(id)}
            onAdd={() => void addFile("reading")}
          />
          <FileRow
            title={wordTitle}
            hint="Words learned from this book"
            file={wordFile}
            confirmId={confirmId}
            busy={busy}
            onOpen={setOpenId}
            onConfirm={setConfirmId}
            onDelete={(id) => void removeNote(id)}
            onAdd={() => void addFile("word")}
          />
          {extras.length > 0 ? (
            <section className="space-y-3 pt-2">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Also on this book</h2>
              {extras.map((note) => (
                <FileRow
                  key={note.id}
                  title={note.title || "Untitled"}
                  hint="Saved earlier"
                  file={note}
                  confirmId={confirmId}
                  busy={busy}
                  onOpen={setOpenId}
                  onConfirm={setConfirmId}
                  onDelete={(id) => void removeNote(id)}
                  onAdd={() => undefined}
                />
              ))}
            </section>
          ) : null}
        </div>
      ) : null}
      {showWords ? <BookWords bookId={bookId} bookTitle={bookTitle} /> : null}
    </div>
  );
}

function FileRow({
  title,
  hint,
  file,
  confirmId,
  busy,
  onOpen,
  onConfirm,
  onDelete,
  onAdd,
}: {
  title: string;
  hint: string;
  file: ShelfFile | null;
  confirmId: string | null;
  busy: boolean;
  onOpen: (id: string) => void;
  onConfirm: (id: string | null) => void;
  onDelete: (id: string) => void;
  onAdd: () => void;
}) {
  if (!file) {
    return (
      <article className="rounded-2xl bg-card p-4">
        <p className="font-semibold">{title}</p>
        <p className="mt-1 text-sm text-muted">{hint}</p>
        <button type="button" disabled={busy} onClick={onAdd} className="mt-2 min-h-12 font-medium text-accent">
          Add
        </button>
      </article>
    );
  }
  return (
    <article className="rounded-2xl bg-card p-4">
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => onOpen(file.id)} className="min-h-12 min-w-0 flex-1 text-left">
          <span className="block font-semibold">{title}</span>
          <span className="mt-1 block text-sm text-muted">
            {hint} · {relativeDayLabel(file.updated_at.slice(0, 10))}
          </span>
        </button>
        {confirmId === file.id ? (
          <button type="button" disabled={busy} onClick={() => onDelete(file.id)} className="min-h-12 px-2 text-sm font-medium text-red-600 dark:text-red-400">
            Trash
          </button>
        ) : (
          <button type="button" onClick={() => onConfirm(file.id)} className="min-h-12 px-2 text-sm text-muted">
            Delete
          </button>
        )}
      </div>
    </article>
  );
}

async function loadShelf(
  bookId: string,
  bookTitle: string,
): Promise<{ reading: ShelfFile | null; wordFile: ShelfFile | null; extras: ShelfFile[]; warning: string | null }> {
  const supabase = createClient();
  await purgeExpiredTrash();
  const warning = await ensureLibrary(supabase, [{ id: bookId, title: bookTitle }]);
  const readingTitle = readingNotesTitle(bookTitle);
  const wordTitle = newWordFileTitle(bookTitle);
  const [linked, named] = await Promise.all([
    supabase.from("notes").select("id, title, book_id, updated_at").eq("book_id", bookId).is("deleted_at", null),
    supabase.from("notes").select("id, title, book_id, updated_at").in("title", [readingTitle, wordTitle]).is("deleted_at", null),
  ]);
  if (linked.error) throw new Error(linked.error.message);
  if (named.error) throw new Error(named.error.message);
  const byId = new Map<string, ShelfFile>();
  for (const note of [...(linked.data ?? []), ...(named.data ?? [])] as ShelfFile[]) byId.set(note.id, note);
  const notes = [...byId.values()];
  const reading = notes.find((note) => note.title === readingTitle) ?? null;
  const wordFile = notes.find((note) => note.title === wordTitle && note.id !== reading?.id) ?? null;
  const extras = notes.filter((note) => note.book_id === bookId && note.id !== reading?.id && note.id !== wordFile?.id);
  return { reading, wordFile, extras, warning };
}
