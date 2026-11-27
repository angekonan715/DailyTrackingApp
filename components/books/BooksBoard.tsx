"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import type { Book, BookStatus, ReadingSession } from "@/types";
import PageHeader from "@/components/PageHeader";
import EmptyState from "@/components/EmptyState";
import SetupNotice from "@/components/SetupNotice";
import { createClient } from "@/lib/supabase/client";
import GoalBoard from "@/components/goals/GoalBoard";
import BookNotes from "@/components/notes/BookNotes";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { formatLongDate, parseDayKey, toDayKey } from "@/lib/dates";
import {
  BOOK_STATUSES,
  bookStatusLabel,
  estimatedFinishDay,
  finishedThisYear,
  nextBookState,
  normalizeBook,
  normalizeSession,
  pagesLeft,
  percentComplete,
  readingPace,
} from "@/lib/books";

const field =
  "w-full rounded-xl bg-background px-4 py-3 text-base outline-none focus:ring-2 focus:ring-accent";
const primary =
  "min-h-12 rounded-xl bg-accent px-4 text-base font-semibold text-white disabled:opacity-60 dark:text-neutral-950";

function subscribe() {
  return () => {};
}

function friendlyError(message: string): string {
  if (/relation|schema cache|does not exist/i.test(message)) {
    return "The books tables are missing. In Supabase, open the SQL Editor and run supabase/migrations/0001_init.sql.";
  }
  if (/jwt|not authenticated|invalid claim/i.test(message)) {
    return "Your session expired. Sign in again.";
  }
  return message;
}

const COVER_BUCKET = "book-covers";

function storagePathFromUrl(url: string | null): string | null {
  if (!url) return null;
  const marker = `/object/public/${COVER_BUCKET}/`;
  const index = url.indexOf(marker);
  if (index < 0) return null;
  return decodeURIComponent(url.slice(index + marker.length).split("?")[0]);
}

async function shrinkCover(file: File): Promise<Blob> {
  if (!file.type.startsWith("image/")) throw new Error("Choose a photo.");
  if (file.size > 15_000_000) throw new Error("That photo is too large. Choose one under 15 MB.");
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("Could not read that photo. Choose a JPEG or PNG.");
  }
  const longest = Math.max(bitmap.width, bitmap.height);
  const scale = Math.min(1, 800 / longest);
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    throw new Error("Could not read that photo.");
  }
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
  if (!blob) throw new Error("Could not read that photo.");
  return blob;
}

async function uploadCover(userId: string, bookId: string, file: File): Promise<string> {
  const blob = await shrinkCover(file);
  const path = `${userId}/${bookId}.jpg`;
  const supabase = createClient();
  const { error } = await supabase.storage.from(COVER_BUCKET).upload(path, blob, {
    upsert: true,
    contentType: "image/jpeg",
  });
  if (error) {
    if (/bucket|not found|row-level|policy|permission/i.test(error.message)) {
      throw new Error(
        "Cover storage is missing. In Supabase, open the SQL Editor, paste supabase/migrations/0004_book_covers.sql, and run it.",
      );
    }
    throw new Error(error.message);
  }
  const { data } = supabase.storage.from(COVER_BUCKET).getPublicUrl(path);
  return `${data.publicUrl}?v=${Date.now()}`;
}

interface BookDraft {
  title: string;
  author: string;
  totalPages: string;
  currentPage: string;
  status: BookStatus;
  coverUrl: string;
  coverFile: File | null;
  clearCover: boolean;
}

function emptyDraft(): BookDraft {
  return { title: "", author: "", totalPages: "", currentPage: "0", status: "want", coverUrl: "", coverFile: null, clearCover: false };
}

function draftFromBook(book: Book): BookDraft {
  return {
    title: book.title,
    author: book.author ?? "",
    totalPages: String(book.total_pages),
    currentPage: String(book.current_page),
    status: book.status,
    coverUrl: book.cover_url ?? "",
    coverFile: null,
    clearCover: false,
  };
}

function payloadFromDraft(draft: BookDraft, today: string, existing?: Book) {
  const title = draft.title.trim().slice(0, 200);
  if (!title) throw new Error("Add a title.");
  const total = Number(draft.totalPages);
  if (!Number.isInteger(total) || total <= 0) throw new Error("Total pages must be a whole number above 0.");
  const typedPage = Number(draft.currentPage);
  if (!Number.isInteger(typedPage) || typedPage < 0) {
    throw new Error("Current page must be a whole number, or 0.");
  }
  const author = draft.author.trim().slice(0, 200);
  const base: Book = existing ?? {
    id: "",
    user_id: "",
    title,
    author: author || null,
    total_pages: total,
    current_page: 0,
    status: draft.status,
    cover_url: null,
    finished_at: null,
    created_at: "",
  };
  const next = nextBookState(
    { ...base, total_pages: total, status: draft.status },
    { status: draft.status, currentPage: draft.status === "finished" ? total : typedPage, totalPages: total },
    today,
  );
  const row = {
    title,
    author: author || null,
    ...next,
  };
  if (draft.clearCover) return { ...row, cover_url: null };
  return row;
}

async function fetchLibrary(): Promise<{ books: Book[]; sessions: ReadingSession[] }> {
  const supabase = createClient();
  const [booksResult, sessionsResult] = await Promise.all([
    supabase
      .from("books")
      .select("id, user_id, title, author, total_pages, current_page, status, cover_url, finished_at, created_at")
      .order("created_at", { ascending: false }),
    supabase
      .from("reading_sessions")
      .select("id, user_id, book_id, day, pages_read")
      .order("day", { ascending: false })
      .limit(2000),
  ]);
  if (booksResult.error) throw booksResult.error;
  if (sessionsResult.error) throw sessionsResult.error;
  return {
    books: ((booksResult.data ?? []) as Book[]).map(normalizeBook),
    sessions: ((sessionsResult.data ?? []) as ReadingSession[]).map(normalizeSession),
  };
}

export default function BooksBoard() {
  if (!isSupabaseConfigured()) {
    return (
      <>
        <PageHeader title="Books" />
        <SetupNotice />
      </>
    );
  }
  return <BooksScreen />;
}

function BooksScreen() {
  const todayKey = useSyncExternalStore(subscribe, toDayKey, () => "");
  const [books, setBooks] = useState<Book[]>([]);
  const [sessions, setSessions] = useState<ReadingSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [notesBook, setNotesBook] = useState<Book | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      try {
        const library = await fetchLibrary();
        if (cancelled) return;
        setBooks(library.books);
        setSessions(library.sessions);
        setError(null);
      } catch (loadError) {
        if (cancelled) return;
        const message =
          loadError && typeof loadError === "object" && "message" in loadError
            ? String(loadError.message)
            : "Could not load books.";
        setError(friendlyError(message));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  async function refresh() {
    try {
      const library = await fetchLibrary();
      setBooks(library.books);
      setSessions(library.sessions);
      setError(null);
    } catch (loadError) {
      const message = loadError && typeof loadError === "object" && "message" in loadError
        ? String(loadError.message)
        : "Could not load books.";
      setError(friendlyError(message));
    }
  }

  async function saveDraft(draft: BookDraft, existing?: Book) {
    if (!todayKey) return;
    const payload = payloadFromDraft(draft, todayKey, existing);
    const supabase = createClient();
    const wrote = existing
      ? await supabase.from("books").update(payload).eq("id", existing.id).select("id").single()
      : await supabase.from("books").insert(payload).select("id").single();
    if (wrote.error || !wrote.data) {
      throw new Error(friendlyError(wrote.error?.message ?? "Could not save the book."));
    }
    const bookId = wrote.data.id;

    if (draft.coverFile) {
      try {
        const { data: userData, error: userError } = await supabase.auth.getUser();
        if (userError || !userData.user) throw new Error("Your session expired. Sign in again.");
        const coverUrl = await uploadCover(userData.user.id, bookId, draft.coverFile);
        const { error: coverError } = await supabase.from("books").update({ cover_url: coverUrl }).eq("id", bookId);
        if (coverError) throw new Error(friendlyError(coverError.message));
      } catch (coverProblem) {
        if (!existing) await supabase.from("books").delete().eq("id", bookId);
        throw coverProblem;
      }
    } else if (draft.clearCover && existing?.cover_url) {
      const path = storagePathFromUrl(existing.cover_url);
      if (path) await supabase.storage.from(COVER_BUCKET).remove([path]);
    }

    setAdding(false);
    setEditingId(null);
    await refresh();
  }

  async function updatePage(book: Book, page: number) {
    if (!todayKey) return;
    const next = nextBookState(book, { currentPage: page }, todayKey);
    const { error: updateError } = await createClient().from("books").update(next).eq("id", book.id);
    if (updateError) throw new Error(friendlyError(updateError.message));
    await refresh();
  }

  async function logSession(book: Book, day: string, pages: number) {
    if (!todayKey) return;
    if (book.status === "finished" || pagesLeft(book) <= 0) {
      throw new Error("This book is already finished.");
    }
    const pagesToLog = Math.min(pages, pagesLeft(book));
    const next = nextBookState(book, { currentPage: book.current_page + pagesToLog }, day);
    const supabase = createClient();
    const { data: session, error: insertError } = await supabase
      .from("reading_sessions")
      .insert({ book_id: book.id, day, pages_read: pagesToLog })
      .select("id")
      .single();
    if (insertError) throw new Error(friendlyError(insertError.message));
    const { error: updateError } = await supabase.from("books").update(next).eq("id", book.id);
    if (updateError) {
      await supabase.from("reading_sessions").delete().eq("id", session.id);
      throw new Error(friendlyError(updateError.message));
    }
    await refresh();
  }

  async function removeBook(book: Book) {
    const { error: deleteError } = await createClient().from("books").delete().eq("id", book.id);
    if (deleteError) {
      setError(friendlyError(deleteError.message));
      return;
    }
    setConfirmingId(null);
    setEditingId(null);
    await refresh();
  }

  const yearFinished = finishedThisYear(books, todayKey.slice(0, 4));
  const reading = books.filter((book) => book.status === "reading");
  const want = books.filter((book) => book.status === "want");
  const earlier = books.filter(
    (book) => book.status === "finished" && !yearFinished.some((item) => item.id === book.id),
  );

  if (notesBook) {
    return (
      <>
        <PageHeader title={notesBook.title} subtitle={notesBook.status === "reading" ? "While you read" : "Notes on this book"} />
        <BookNotes
          bookId={notesBook.id}
          showWords={notesBook.status !== "want"}
          startOnWords={notesBook.status === "reading"}
          onBack={() => setNotesBook(null)}
        />
      </>
    );
  }

  return (
    <>
      <PageHeader title="Books" subtitle={`${yearFinished.length} finished this year`} />
      <GoalBoard metrics={["books"]} charts />

      {adding ? (
        <BookForm
          today={todayKey}
          onCancel={() => setAdding(false)}
          onSubmit={(draft) => saveDraft(draft)}
        />
      ) : (
        <button type="button" onClick={() => setAdding(true)} className={`mb-5 w-full ${primary}`}>
          Add a book
        </button>
      )}

      {error ? (
        <div role="alert" className="mb-4 rounded-2xl bg-card px-4 py-3 text-sm">
          <p className="text-red-600 dark:text-red-400">{error}</p>
          <button type="button" onClick={() => void refresh()} className="mt-2 min-h-11 font-medium text-accent">
            Try again
          </button>
        </div>
      ) : null}

      {loading ? (
        <div className="space-y-3">
          <div className="h-24 animate-pulse rounded-2xl bg-card" />
          <div className="h-24 animate-pulse rounded-2xl bg-card" />
        </div>
      ) : books.length === 0 ? (
        <EmptyState title="No books yet" hint="Add one you are reading, or one you want to start." />
      ) : (
        <div className="space-y-6">
          <BookGroup title="Reading" books={reading} empty="Nothing in progress.">
            {(book) => (
              <ReadingCard
                key={`${book.id}-${book.current_page}-${todayKey}`}
                book={book}
                sessions={sessions.filter((session) => session.book_id === book.id)}
                today={todayKey}
                editing={editingId === book.id}
                confirming={confirmingId === book.id}
                onEdit={() => {
                  setEditingId(book.id);
                  setConfirmingId(null);
                }}
                onCancelEdit={() => setEditingId(null)}
                onAskDelete={() => setConfirmingId(book.id)}
                onCancelDelete={() => setConfirmingId(null)}
                onDelete={() => removeBook(book)}
                onSave={(draft) => saveDraft(draft, book)}
                onUpdatePage={(page) => updatePage(book, page)}
                onLog={(day, pages) => logSession(book, day, pages)}
                onNotes={() => setNotesBook(book)}
              />
            )}
          </BookGroup>
          <BookGroup title="Want to read" books={want} empty="Your list is empty.">
            {(book) => (
              <SimpleCard
                book={book}
                today={todayKey}
                editing={editingId === book.id}
                confirming={confirmingId === book.id}
                onEdit={() => setEditingId(book.id)}
                onCancelEdit={() => setEditingId(null)}
                onAskDelete={() => setConfirmingId(book.id)}
                onCancelDelete={() => setConfirmingId(null)}
                onDelete={() => removeBook(book)}
                onSave={(draft) => saveDraft(draft, book)}
                startReading={() =>
                  saveDraft(
                    { ...draftFromBook(book), status: "reading", currentPage: String(book.current_page) },
                    book,
                  )
                }
              />
            )}
          </BookGroup>
          <BookGroup title="Finished this year" books={yearFinished} empty="None yet this year.">
            {(book) => (
              <SimpleCard
                book={book}
                today={todayKey}
                editing={editingId === book.id}
                confirming={confirmingId === book.id}
                onEdit={() => setEditingId(book.id)}
                onCancelEdit={() => setEditingId(null)}
                onAskDelete={() => setConfirmingId(book.id)}
                onCancelDelete={() => setConfirmingId(null)}
                onDelete={() => removeBook(book)}
                onSave={(draft) => saveDraft(draft, book)}
                onNotes={() => setNotesBook(book)}
              />
            )}
          </BookGroup>
          {earlier.length > 0 ? (
            <BookGroup title="Finished earlier" books={earlier} empty="">
              {(book) => (
                <SimpleCard
                  book={book}
                  today={todayKey}
                  editing={editingId === book.id}
                  confirming={confirmingId === book.id}
                  onEdit={() => setEditingId(book.id)}
                  onCancelEdit={() => setEditingId(null)}
                  onAskDelete={() => setConfirmingId(book.id)}
                  onCancelDelete={() => setConfirmingId(null)}
                  onDelete={() => removeBook(book)}
                  onSave={(draft) => saveDraft(draft, book)}
                  onNotes={() => setNotesBook(book)}
                />
              )}
            </BookGroup>
          ) : null}
        </div>
      )}
    </>
  );
}

function BookGroup({
  title,
  books,
  empty,
  children,
}: {
  title: string;
  books: Book[];
  empty: string;
  children: (book: Book) => React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">{title}</h2>
      {books.length === 0 ? <p className="text-sm text-muted">{empty}</p> : books.map((book) => <div key={book.id}>{children(book)}</div>)}
    </section>
  );
}

function BookForm({
  initial,
  today,
  onCancel,
  onSubmit,
}: {
  initial?: BookDraft;
  today: string;
  onCancel: () => void;
  onSubmit: (draft: BookDraft) => Promise<void>;
}) {
  const [draft, setDraft] = useState<BookDraft>(initial ?? emptyDraft());
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const shownCover = previewUrl ?? (draft.clearCover ? null : draft.coverUrl || null);

  function set<K extends keyof BookDraft>(key: K, value: BookDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function chooseCover(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setFormError("Choose a photo.");
      return;
    }
    setFormError(null);
    setPreviewUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return URL.createObjectURL(file);
    });
    set("coverFile", file);
    set("clearCover", false);
  }

  return (
    <form
      className="mb-5 space-y-3 rounded-2xl bg-card p-4"
      onSubmit={(event) => {
        event.preventDefault();
        setSaving(true);
        setFormError(null);
        void onSubmit(draft)
          .catch((reason: Error) => setFormError(reason.message))
          .finally(() => setSaving(false));
      }}
    >
      <label className="block text-sm font-medium">
        Title
        <input className={`mt-1 ${field}`} value={draft.title} onChange={(event) => set("title", event.target.value)} required />
      </label>
      <label className="block text-sm font-medium">
        Author
        <input className={`mt-1 ${field}`} value={draft.author} onChange={(event) => set("author", event.target.value)} />
      </label>
      <label className="block text-sm font-medium">
        Total pages
        <input
          className={`mt-1 ${field}`}
          inputMode="numeric"
          value={draft.totalPages}
          onChange={(event) => set("totalPages", event.target.value)}
          required
        />
      </label>
      <div className="flex flex-wrap gap-2">
        {BOOK_STATUSES.map((status) => (
          <button
            key={status.value}
            type="button"
            onClick={() => set("status", status.value)}
            className={`min-h-11 rounded-full px-4 text-sm font-medium ${
              draft.status === status.value ? "bg-accent text-white dark:text-neutral-950" : "bg-background"
            }`}
          >
            {status.label}
          </button>
        ))}
      </div>
      {draft.status === "reading" ? (
        <label className="block text-sm font-medium">
          Current page
          <input
            className={`mt-1 ${field}`}
            inputMode="numeric"
            value={draft.currentPage}
            onChange={(event) => set("currentPage", event.target.value)}
          />
        </label>
      ) : null}
      <div className="space-y-2">
        {shownCover ? (
          <div
            aria-hidden
            className="h-24 w-16 rounded-md bg-background bg-cover bg-center"
            style={{ backgroundImage: `url(${JSON.stringify(shownCover)})` }}
          />
        ) : null}
        <div className="flex flex-wrap gap-2">
          <label className="flex min-h-12 cursor-pointer items-center justify-center rounded-xl bg-background px-4 text-sm font-medium">
            {shownCover ? "Change cover" : "Add a cover photo"}
            <input
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={(event) => {
                chooseCover(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
          </label>
          {shownCover ? (
            <button
              type="button"
              onClick={() => {
                setPreviewUrl((current) => {
                  if (current) URL.revokeObjectURL(current);
                  return null;
                });
                set("coverFile", null);
                set("clearCover", true);
              }}
              className="min-h-12 rounded-xl bg-background px-4 text-sm font-medium"
            >
              Remove cover
            </button>
          ) : null}
        </div>
      </div>
      {formError ? <p className="text-sm text-red-600 dark:text-red-400">{formError}</p> : null}
      <p className="sr-only">{today}</p>
      <div className="flex gap-2">
        <button type="submit" disabled={saving} className={`flex-1 ${primary}`}>
          {saving ? "Saving…" : "Save book"}
        </button>
        <button type="button" onClick={onCancel} className="min-h-12 rounded-xl bg-background px-4 text-sm font-medium">
          Cancel
        </button>
      </div>
    </form>
  );
}

function Cover({ book }: { book: Book }) {
  if (!book.cover_url) return null;
  return (
    <div
      aria-hidden
      className="h-16 w-11 shrink-0 rounded-md bg-background bg-cover bg-center"
      style={{ backgroundImage: `url(${JSON.stringify(book.cover_url)})` }}
    />
  );
}

function CardActions({
  editing,
  confirming,
  onEdit,
  onCancelEdit,
  onAskDelete,
  onCancelDelete,
  onDelete,
}: {
  editing: boolean;
  confirming: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  onDelete: () => Promise<void>;
}) {
  const [removing, setRemoving] = useState(false);
  if (confirming) {
    return (
      <div className="flex gap-3 text-sm">
        <button
          type="button"
          disabled={removing}
          onClick={() => {
            setRemoving(true);
            void onDelete().finally(() => setRemoving(false));
          }}
          className="min-h-11 font-medium text-red-600 dark:text-red-400"
        >
          {removing ? "Deleting…" : "Delete"}
        </button>
        <button type="button" onClick={onCancelDelete} className="min-h-11 text-muted">
          Cancel
        </button>
      </div>
    );
  }
  return (
    <div className="flex gap-3 text-sm">
      <button type="button" onClick={editing ? onCancelEdit : onEdit} className="min-h-11 font-medium text-accent">
        {editing ? "Close" : "Edit"}
      </button>
      <button type="button" onClick={onAskDelete} className="min-h-11 text-muted">
        Delete
      </button>
    </div>
  );
}

function ReadingCard({
  book,
  sessions,
  today,
  editing,
  confirming,
  onEdit,
  onCancelEdit,
  onAskDelete,
  onCancelDelete,
  onDelete,
  onSave,
  onUpdatePage,
  onLog,
  onNotes,
}: {
  book: Book;
  sessions: ReadingSession[];
  today: string;
  editing: boolean;
  confirming: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  onDelete: () => Promise<void>;
  onSave: (draft: BookDraft) => Promise<void>;
  onUpdatePage: (page: number) => Promise<void>;
  onLog: (day: string, pages: number) => Promise<void>;
  onNotes: () => void;
}) {
  const [page, setPage] = useState(String(book.current_page));
  const [logDay, setLogDay] = useState(today);
  const [logPages, setLogPages] = useState("");
  const [cardError, setCardError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pace = readingPace(sessions);
  const finish = today ? estimatedFinishDay(book, sessions, parseDayKey(today)) : null;
  const left = pagesLeft(book);
  const percent = percentComplete(book);
  const latest = sessions[0];

  return (
    <article className="space-y-3 rounded-2xl bg-card p-4">
      {editing ? (
        <BookForm initial={draftFromBook(book)} today={today} onCancel={onCancelEdit} onSubmit={onSave} />
      ) : (
        <>
          <div className="flex gap-3">
            <Cover book={book} />
            <button type="button" onClick={onNotes} className="min-w-0 flex-1 text-left">
              <h3 className="font-semibold">{book.title}</h3>
              {book.author ? <p className="text-sm text-muted">{book.author}</p> : null}
              <p className="mt-1 text-sm">
                {left} pages left · {percent}%
              </p>
            </button>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-background">
            <div className="h-full bg-accent" style={{ width: `${percent}%` }} />
          </div>
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const next = Number(page);
              if (!Number.isInteger(next) || next < 0 || next > book.total_pages) {
                setCardError(`Enter a page from 0 to ${book.total_pages}.`);
                return;
              }
              setBusy(true);
              setCardError(null);
              void onUpdatePage(next)
                .catch((reason: Error) => setCardError(reason.message))
                .finally(() => setBusy(false));
            }}
          >
            <label className="min-w-0 flex-1 text-sm font-medium">
              Current page
              <input className={`mt-1 ${field}`} inputMode="numeric" value={page} onChange={(event) => setPage(event.target.value)} />
            </label>
            <button type="submit" disabled={busy} className={`self-end ${primary}`}>
              Save
            </button>
          </form>
          <p className="text-sm text-muted">
            {pace
              ? `About ${Math.round(pace.pagesPerDay)} pages on days you read.`
              : "Log a reading session to estimate a finish date."}
            {finish ? ` Finish around ${formatLongDate(finish)} if you read every day.` : ""}
          </p>
          <form
            className="grid grid-cols-[1fr_6rem_auto] gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const pages = Number(logPages);
              if (!/^\d{4}-\d{2}-\d{2}$/.test(logDay)) {
                setCardError("Pick a date.");
                return;
              }
              if (!Number.isInteger(pages) || pages <= 0) {
                setCardError("Pages read must be a whole number above 0.");
                return;
              }
              setBusy(true);
              setCardError(null);
              void onLog(logDay, pages)
                .then(() => setLogPages(""))
                .catch((reason: Error) => setCardError(reason.message))
                .finally(() => setBusy(false));
            }}
          >
            <label className="text-sm font-medium">
              Session date
              <input className={`mt-1 ${field}`} type="date" value={logDay} onChange={(event) => setLogDay(event.target.value)} />
            </label>
            <label className="text-sm font-medium">
              Pages
              <input
                className={`mt-1 ${field}`}
                inputMode="numeric"
                value={logPages}
                onChange={(event) => setLogPages(event.target.value)}
              />
            </label>
            <button type="submit" disabled={busy} className={`self-end ${primary}`}>
              Log
            </button>
          </form>
          {latest ? (
            <p className="text-sm text-muted">
              Last logged {formatLongDate(latest.day)} · {latest.pages_read} pages. Logging also moves your bookmark forward.
            </p>
          ) : (
            <p className="text-sm text-muted">Logging pages also moves your bookmark forward.</p>
          )}
          {cardError ? <p className="text-sm text-red-600 dark:text-red-400">{cardError}</p> : null}
          <button type="button" onClick={onNotes} className="min-h-12 w-full rounded-xl bg-background text-sm font-semibold">
            Notes and words
          </button>
          <CardActions
            editing={editing}
            confirming={confirming}
            onEdit={onEdit}
            onCancelEdit={onCancelEdit}
            onAskDelete={onAskDelete}
            onCancelDelete={onCancelDelete}
            onDelete={onDelete}
          />
        </>
      )}
    </article>
  );
}

function SimpleCard({
  book,
  today,
  editing,
  confirming,
  onEdit,
  onCancelEdit,
  onAskDelete,
  onCancelDelete,
  onDelete,
  onSave,
  onNotes,
  startReading,
}: {
  book: Book;
  today: string;
  editing: boolean;
  confirming: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  onDelete: () => Promise<void>;
  onSave: (draft: BookDraft) => Promise<void>;
  onNotes?: () => void;
  startReading?: () => Promise<void>;
}) {
  const [cardError, setCardError] = useState<string | null>(null);
  return (
    <article className="space-y-3 rounded-2xl bg-card p-4">
      {editing ? (
        <BookForm initial={draftFromBook(book)} today={today} onCancel={onCancelEdit} onSubmit={onSave} />
      ) : (
        <>
          <div className="flex gap-3">
            <Cover book={book} />
            {onNotes ? (
              <button type="button" onClick={onNotes} className="min-w-0 flex-1 text-left">
                <h3 className="font-semibold">{book.title}</h3>
                {book.author ? <p className="text-sm text-muted">{book.author}</p> : null}
                <p className="mt-1 text-sm text-muted">
                  {bookStatusLabel(book.status)} · {book.total_pages} pages
                  {book.finished_at ? ` · finished ${formatLongDate(book.finished_at)}` : ""}
                </p>
              </button>
            ) : (
              <div className="min-w-0 flex-1">
                <h3 className="font-semibold">{book.title}</h3>
                {book.author ? <p className="text-sm text-muted">{book.author}</p> : null}
                <p className="mt-1 text-sm text-muted">
                  {bookStatusLabel(book.status)} · {book.total_pages} pages
                  {book.finished_at ? ` · finished ${formatLongDate(book.finished_at)}` : ""}
                </p>
              </div>
            )}
          </div>
          {cardError ? <p className="text-sm text-red-600 dark:text-red-400">{cardError}</p> : null}
          <div className="flex flex-wrap items-center gap-3">
            {onNotes ? (
              <button type="button" onClick={onNotes} className="min-h-11 text-sm font-medium text-accent">
                Notes
              </button>
            ) : null}
            {startReading ? (
              <button
                type="button"
                onClick={() => {
                  setCardError(null);
                  void startReading().catch((reason: Error) => setCardError(reason.message));
                }}
                className="min-h-11 text-sm font-medium text-accent"
              >
                Start reading
              </button>
            ) : null}
            <CardActions
              editing={editing}
              confirming={confirming}
              onEdit={onEdit}
              onCancelEdit={onCancelEdit}
              onAskDelete={onAskDelete}
              onCancelDelete={onCancelDelete}
              onDelete={onDelete}
            />
          </div>
        </>
      )}
    </article>
  );
}
