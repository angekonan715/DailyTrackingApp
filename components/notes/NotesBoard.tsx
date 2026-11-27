"use client";

import { useEffect, useState } from "react";
import type { NoteFolder } from "@/types";
import PageHeader from "@/components/PageHeader";
import EmptyState from "@/components/EmptyState";
import SetupNotice from "@/components/SetupNotice";
import NoteEditor from "@/components/notes/NoteEditor";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { relativeDayLabel } from "@/lib/dates";
import { explainNotesError, noteTitle } from "@/lib/notes";

interface NoteListItem {
  id: string;
  folder_id: string | null;
  book_id: string | null;
  title: string;
  updated_at: string;
}

const primary = "min-h-12 rounded-xl bg-accent px-4 text-base font-semibold text-white dark:text-neutral-950";

function folderPath(folders: NoteFolder[], id: string): string {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const names: string[] = [];
  let current: string | null = id;
  const seen = new Set<string>();
  while (current && !seen.has(current)) {
    seen.add(current);
    const folder = byId.get(current);
    if (!folder) break;
    names.unshift(folder.name);
    current = folder.parent_id;
  }
  return names.join(" / ");
}

export default function NotesBoard() {
  if (!isSupabaseConfigured()) {
    return (
      <>
        <PageHeader title="Notes" />
        <SetupNotice />
      </>
    );
  }
  return <NotesScreen />;
}

function NotesScreen() {
  const [folders, setFolders] = useState<NoteFolder[]>([]);
  const [notes, setNotes] = useState<NoteListItem[]>([]);
  const [books, setBooks] = useState<Map<string, string>>(new Map());
  const [folderId, setFolderId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [folderName, setFolderName] = useState("");
  const [makingFolder, setMakingFolder] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [rename, setRename] = useState("");
  const [confirmFolder, setConfirmFolder] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      try {
        const loaded = await loadDesk();
        if (cancelled) return;
        setFolders(loaded.folders);
        setNotes(loaded.notes);
        setBooks(loaded.books);
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
  }, []);

  async function reload() {
    const loaded = await loadDesk();
    setFolders(loaded.folders);
    setNotes(loaded.notes);
    setBooks(loaded.books);
  }

  async function createNote() {
    setBusy(true);
    setError(null);
    const { data, error: insertError } = await createClient()
      .from("notes")
      .insert({ folder_id: folderId, title: "", body: "" })
      .select("id")
      .single();
    setBusy(false);
    if (insertError || !data) {
      setError(explainNotesError(insertError?.message ?? "Could not start the note."));
      return;
    }
    setOpenId(data.id);
  }

  async function createFolder(event: React.FormEvent) {
    event.preventDefault();
    const name = folderName.trim().slice(0, 80);
    if (!name) return;
    setBusy(true);
    setError(null);
    const { error: insertError } = await createClient().from("note_folders").insert({ parent_id: folderId, name });
    setBusy(false);
    if (insertError) {
      setError(explainNotesError(insertError.message));
      return;
    }
    setFolderName("");
    setMakingFolder(false);
    await reload();
  }

  async function saveRename(id: string) {
    const name = rename.trim().slice(0, 80);
    if (!name) return;
    setBusy(true);
    const { error: updateError } = await createClient().from("note_folders").update({ name, updated_at: new Date().toISOString() }).eq("id", id);
    setBusy(false);
    if (updateError) {
      setError(explainNotesError(updateError.message));
      return;
    }
    setRenamingId(null);
    await reload();
  }

  async function removeFolder(id: string) {
    setBusy(true);
    const { error: deleteError } = await createClient().from("note_folders").delete().eq("id", id);
    setBusy(false);
    if (deleteError) {
      setError(explainNotesError(deleteError.message));
      return;
    }
    setConfirmFolder(null);
    if (folderId === id) setFolderId(null);
    await reload();
  }

  const here = folders.filter((folder) => folder.parent_id === folderId);
  const files = notes.filter((note) => !note.book_id && note.folder_id === folderId);
  const bookNotes = folderId ? [] : notes.filter((note) => note.book_id);
  const crumbs: { id: string | null; name: string }[] = [{ id: null, name: "Notes" }];
  if (folderId) {
    const trail = folderPath(folders, folderId).split(" / ").filter(Boolean);
    let parent: string | null = null;
    for (const name of trail) {
      const match = folders.find((folder) => folder.parent_id === parent && folder.name === name);
      if (!match) break;
      crumbs.push({ id: match.id, name: match.name });
      parent = match.id;
    }
  }
  const choices = folders
    .map((folder) => ({ id: folder.id, label: folderPath(folders, folder.id) }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const openNote = notes.find((note) => note.id === openId) ?? null;

  if (openId) {
    return (
      <>
        <PageHeader title="Notes" />
        <NoteEditor
          key={openId}
          noteId={openId}
          context={openNote?.book_id ? books.get(openNote.book_id) : undefined}
          folderId={openNote?.book_id ? undefined : (openNote?.folder_id ?? folderId)}
          folders={openNote?.book_id ? undefined : choices}
          onBack={() => {
            setOpenId(null);
            void reload();
          }}
          onDeleted={() => {
            setOpenId(null);
            void reload();
          }}
        />
      </>
    );
  }

  return (
    <>
      <PageHeader title="Notes" subtitle="Folders and pages, written like a note on a tablet." />
      <div className="mb-4 flex flex-wrap gap-2">
        {crumbs.map((crumb, index) => (
          <button
            key={crumb.id ?? "root"}
            type="button"
            onClick={() => setFolderId(crumb.id)}
            className={`min-h-11 text-sm font-medium ${index === crumbs.length - 1 ? "text-foreground" : "text-accent"}`}
          >
            {index > 0 ? " / " : ""}
            {crumb.name}
          </button>
        ))}
      </div>
      <div className="mb-4 flex gap-2">
        <button type="button" disabled={busy} onClick={() => void createNote()} className={`flex-1 ${primary}`}>
          New note
        </button>
        <button type="button" onClick={() => setMakingFolder((current) => !current)} className="min-h-12 rounded-xl bg-card px-4 text-sm font-semibold">
          New folder
        </button>
      </div>
      {makingFolder ? (
        <form onSubmit={(event) => void createFolder(event)} className="mb-4 flex gap-2">
          <label className="sr-only" htmlFor="folder-name">
            Folder name
          </label>
          <input
            id="folder-name"
            value={folderName}
            onChange={(event) => setFolderName(event.target.value)}
            maxLength={80}
            placeholder="Folder name"
            className="min-h-12 min-w-0 flex-1 rounded-xl bg-card px-4 text-base outline-none focus:ring-2 focus:ring-accent"
          />
          <button type="submit" disabled={busy || folderName.trim().length === 0} className={primary}>
            Add
          </button>
        </form>
      ) : null}
      {error ? (
        <div role="alert" className="mb-4 rounded-2xl bg-card px-4 py-3 text-sm">
          <p className="text-red-600 dark:text-red-400">{error}</p>
          <button type="button" onClick={() => void reload().catch((reason: Error) => setError(explainNotesError(reason.message)))} className="mt-2 min-h-11 font-medium text-accent">
            Try again
          </button>
        </div>
      ) : null}
      {loading ? (
        <div className="space-y-3">
          <div className="h-16 animate-pulse rounded-2xl bg-card" />
          <div className="h-16 animate-pulse rounded-2xl bg-card" />
        </div>
      ) : here.length === 0 && files.length === 0 && bookNotes.length === 0 ? (
        <EmptyState title="Nothing here yet" hint="Start a note, or make a folder and put notes inside it." />
      ) : (
        <div className="space-y-3">
          {here.map((folder) => (
            <article key={folder.id} className="rounded-2xl bg-card p-4">
              {renamingId === folder.id ? (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void saveRename(folder.id);
                  }}
                  className="flex gap-2"
                >
                  <label className="sr-only" htmlFor={`rename-${folder.id}`}>
                    Folder name
                  </label>
                  <input
                    id={`rename-${folder.id}`}
                    value={rename}
                    onChange={(event) => setRename(event.target.value)}
                    maxLength={80}
                    className="min-h-12 min-w-0 flex-1 rounded-xl bg-background px-4 text-base outline-none focus:ring-2 focus:ring-accent"
                  />
                  <button type="submit" className="min-h-12 font-medium text-accent">
                    Save
                  </button>
                </form>
              ) : (
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => setFolderId(folder.id)} className="min-h-12 min-w-0 flex-1 text-left font-semibold">
                    {folder.name}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setRenamingId(folder.id);
                      setRename(folder.name);
                      setConfirmFolder(null);
                    }}
                    className="min-h-12 px-2 text-sm font-medium text-accent"
                  >
                    Rename
                  </button>
                  {confirmFolder === folder.id ? (
                    <button type="button" disabled={busy} onClick={() => void removeFolder(folder.id)} className="min-h-12 px-2 text-sm font-medium text-red-600 dark:text-red-400">
                      Delete
                    </button>
                  ) : (
                    <button type="button" onClick={() => setConfirmFolder(folder.id)} className="min-h-12 px-2 text-sm text-muted">
                      Delete
                    </button>
                  )}
                </div>
              )}
            </article>
          ))}
          {files.map((note) => (
            <button
              key={note.id}
              type="button"
              onClick={() => setOpenId(note.id)}
              className="block w-full rounded-2xl bg-card p-4 text-left"
            >
              <span className="block font-semibold">{noteTitle(note.title)}</span>
              <span className="mt-1 block text-sm text-muted">{relativeDayLabel(note.updated_at.slice(0, 10))}</span>
            </button>
          ))}
          {bookNotes.length > 0 ? (
            <section className="space-y-3 pt-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">From books</h2>
              {bookNotes.map((note) => (
                <button
                  key={note.id}
                  type="button"
                  onClick={() => setOpenId(note.id)}
                  className="block w-full rounded-2xl bg-card p-4 text-left"
                >
                  <span className="block font-semibold">{noteTitle(note.title)}</span>
                  <span className="mt-1 block text-sm text-muted">
                    {books.get(note.book_id ?? "") ?? "Book"} · {relativeDayLabel(note.updated_at.slice(0, 10))}
                  </span>
                </button>
              ))}
            </section>
          ) : null}
        </div>
      )}
    </>
  );
}

async function loadDesk(): Promise<{ folders: NoteFolder[]; notes: NoteListItem[]; books: Map<string, string> }> {
  const supabase = createClient();
  const [folderResult, noteResult, bookResult] = await Promise.all([
    supabase.from("note_folders").select("id, user_id, parent_id, name, created_at, updated_at").order("name"),
    supabase.from("notes").select("id, folder_id, book_id, title, updated_at").order("updated_at", { ascending: false }),
    supabase.from("books").select("id, title"),
  ]);
  if (folderResult.error) throw new Error(folderResult.error.message);
  if (noteResult.error) throw new Error(noteResult.error.message);
  const bookNames = new Map<string, string>();
  for (const book of (bookResult.data ?? []) as { id: string; title: string }[]) bookNames.set(book.id, book.title);
  return {
    folders: (folderResult.data ?? []) as NoteFolder[],
    notes: (noteResult.data ?? []) as NoteListItem[],
    books: bookNames,
  };
}
