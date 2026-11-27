import type { SupabaseClient } from "@supabase/supabase-js";

export const BOOK_NOTE_FOLDER = "Book Note";
export const NEW_WORD_FOLDER = "New Word";
const LEGACY_WORD_FOLDER = "Word notes";

export interface BookRef {
  id: string;
  title: string;
}

interface ShelfNote {
  id: string;
  title: string;
  folder_id: string | null;
  book_id: string | null;
  deleted_at: string | null;
  updated_at: string;
}

interface ShelfFolder {
  id: string;
  parent_id: string | null;
  name: string;
  deleted_at: string | null;
}

export type BookFileRole = "reading" | "word";

export function readingNotesTitle(bookTitle: string): string {
  const name = bookTitle.trim() || "Untitled book";
  return `${name} Reading Notes`.slice(0, 200);
}

export function newWordFileTitle(bookTitle: string): string {
  const name = bookTitle.trim() || "Untitled book";
  return `New Word from ${name}`.slice(0, 200);
}

export function bookFileTitle(bookTitle: string, role: BookFileRole): string {
  return role === "reading" ? readingNotesTitle(bookTitle) : newWordFileTitle(bookTitle);
}

function blocked(message: string): boolean {
  return /notes_one_home/i.test(message);
}

function newest(notes: ShelfNote[]): ShelfNote | null {
  return [...notes].sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0] ?? null;
}

async function rootFolder(supabase: SupabaseClient, folders: ShelfFolder[], name: string): Promise<{ id: string | null; error: string | null }> {
  const found = folders.find((folder) => !folder.deleted_at && folder.parent_id == null && folder.name === name);
  if (found) return { id: found.id, error: null };
  const created = await supabase.from("note_folders").insert({ name, parent_id: null }).select("id").single();
  if (created.error || typeof created.data?.id !== "string") {
    return { id: null, error: created.error?.message ?? "Could not make the folder." };
  }
  folders.push({ id: created.data.id, parent_id: null, name, deleted_at: null });
  return { id: created.data.id, error: null };
}

async function place(
  supabase: SupabaseClient,
  note: ShelfNote | null,
  folderId: string,
  bookId: string,
  title: string,
): Promise<{ id: string | null; error: string | null }> {
  const now = new Date().toISOString();
  if (note) {
    const sameHome = note.folder_id === folderId && note.title === title && !note.deleted_at;
    if (sameHome && note.book_id === bookId) return { id: note.id, error: null };
    const updated = await supabase
      .from("notes")
      .update({ folder_id: folderId, book_id: bookId, title, deleted_at: null, updated_at: now })
      .eq("id", note.id);
    if (!updated.error) {
      note.folder_id = folderId;
      note.book_id = bookId;
      note.title = title;
      note.deleted_at = null;
      return { id: note.id, error: null };
    }
    if (!blocked(updated.error.message)) return { id: null, error: updated.error.message };
    if (sameHome) return { id: note.id, error: null };
    const fallback = await supabase
      .from("notes")
      .update({ folder_id: folderId, book_id: null, title, deleted_at: null, updated_at: now })
      .eq("id", note.id);
    if (fallback.error) return { id: null, error: fallback.error.message };
    note.folder_id = folderId;
    note.book_id = null;
    note.title = title;
    note.deleted_at = null;
    return { id: note.id, error: null };
  }
  const created = await supabase
    .from("notes")
    .insert({ folder_id: folderId, book_id: bookId, title, body: "" })
    .select("id")
    .single();
  if (!created.error && typeof created.data?.id === "string") return { id: created.data.id, error: null };
  if (created.error && blocked(created.error.message)) {
    const again = await supabase.from("notes").insert({ folder_id: folderId, title, body: "" }).select("id").single();
    if (again.error || typeof again.data?.id !== "string") return { id: null, error: again.error?.message ?? "Could not create the note." };
    return { id: again.data.id, error: null };
  }
  return { id: null, error: created.error?.message ?? "Could not create the note." };
}

function pickReading(notes: ShelfNote[], book: BookRef, bookFolderId: string, wordFolderIds: Set<string>, claimed: Set<string>): ShelfNote | null {
  const title = readingNotesTitle(book.title);
  const free = notes.filter((note) => !claimed.has(note.id));
  const active = free.filter((note) => !note.deleted_at && !wordFolderIds.has(note.folder_id ?? ""));
  return (
    active.find((note) => note.book_id === book.id && note.folder_id === bookFolderId && note.title === title) ??
    active.find((note) => note.folder_id === bookFolderId && note.title === title) ??
    newest(active.filter((note) => note.book_id === book.id && note.folder_id === bookFolderId)) ??
    newest(active.filter((note) => note.book_id === book.id && note.folder_id == null)) ??
    null
  );
}

function pickWord(notes: ShelfNote[], book: BookRef, wordFolderIds: Set<string>, claimed: Set<string>): ShelfNote | null {
  const title = newWordFileTitle(book.title);
  const plain = book.title.trim();
  const free = notes.filter((note) => !claimed.has(note.id) && !note.deleted_at && wordFolderIds.has(note.folder_id ?? ""));
  return (
    free.find((note) => note.book_id === book.id && note.title === title) ??
    free.find((note) => note.title === title && (note.book_id == null || note.book_id === book.id)) ??
    free.find((note) => note.book_id === book.id) ??
    free.find((note) => plain.length > 0 && note.title === plain && (note.book_id == null || note.book_id === book.id)) ??
    null
  );
}

function trashedTitle(notes: ShelfNote[], book: BookRef, title: string, claimed: Set<string>): boolean {
  return notes.some(
    (note) =>
      !claimed.has(note.id) &&
      Boolean(note.deleted_at) &&
      note.title === title &&
      (note.book_id == null || note.book_id === book.id),
  );
}

async function loadShelf(supabase: SupabaseClient): Promise<{ folders: ShelfFolder[]; notes: ShelfNote[]; error: string | null }> {
  const [folderResult, noteResult] = await Promise.all([
    supabase.from("note_folders").select("id, parent_id, name, deleted_at"),
    supabase.from("notes").select("id, title, folder_id, book_id, deleted_at, updated_at"),
  ]);
  if (folderResult.error) return { folders: [], notes: [], error: folderResult.error.message };
  if (noteResult.error) return { folders: [], notes: [], error: noteResult.error.message };
  return {
    folders: (folderResult.data ?? []) as ShelfFolder[],
    notes: (noteResult.data ?? []) as ShelfNote[],
    error: null,
  };
}

export async function ensureLibrary(supabase: SupabaseClient, books: BookRef[]): Promise<string | null> {
  const shelf = await loadShelf(supabase);
  if (shelf.error) return shelf.error;
  const bookFolder = await rootFolder(supabase, shelf.folders, BOOK_NOTE_FOLDER);
  if (bookFolder.error || !bookFolder.id) return bookFolder.error;
  const wordFolder = await rootFolder(supabase, shelf.folders, NEW_WORD_FOLDER);
  if (wordFolder.error || !wordFolder.id) return wordFolder.error;
  const legacy = shelf.folders.find((folder) => !folder.deleted_at && folder.parent_id == null && folder.name === LEGACY_WORD_FOLDER);
  const wordFolderIds = new Set([wordFolder.id, legacy?.id].filter((id): id is string => Boolean(id)));
  const claimed = new Set<string>();

  for (const book of books) {
    const reading = pickReading(shelf.notes, book, bookFolder.id, wordFolderIds, claimed);
    if (reading) {
      claimed.add(reading.id);
      const placed = await place(supabase, reading, bookFolder.id, book.id, readingNotesTitle(book.title));
      if (placed.error) return placed.error;
    } else if (!trashedTitle(shelf.notes, book, readingNotesTitle(book.title), claimed)) {
      const placed = await place(supabase, null, bookFolder.id, book.id, readingNotesTitle(book.title));
      if (placed.error) return placed.error;
      if (placed.id) claimed.add(placed.id);
    }

    const word = pickWord(shelf.notes, book, wordFolderIds, claimed);
    if (word) {
      claimed.add(word.id);
      const placed = await place(supabase, word, wordFolder.id, book.id, newWordFileTitle(book.title));
      if (placed.error) return placed.error;
    } else if (!trashedTitle(shelf.notes, book, newWordFileTitle(book.title), claimed)) {
      const placed = await place(supabase, null, wordFolder.id, book.id, newWordFileTitle(book.title));
      if (placed.error) return placed.error;
      if (placed.id) claimed.add(placed.id);
    }

    for (const extra of shelf.notes) {
      if (claimed.has(extra.id) || extra.deleted_at || extra.book_id !== book.id) continue;
      if (extra.folder_id === bookFolder.id || wordFolderIds.has(extra.folder_id ?? "")) continue;
      claimed.add(extra.id);
      const placed = await place(supabase, extra, bookFolder.id, book.id, extra.title || readingNotesTitle(book.title));
      if (placed.error) return placed.error;
    }
  }

  if (legacy) {
    const stillThere = shelf.notes.some((note) => !note.deleted_at && note.folder_id === legacy.id);
    if (!stillThere) {
      await supabase.from("note_folders").update({ deleted_at: new Date().toISOString() }).eq("id", legacy.id);
    }
  }
  return null;
}

export async function reviveBookFile(
  supabase: SupabaseClient,
  book: BookRef,
  role: BookFileRole,
): Promise<{ id: string | null; error: string | null }> {
  const shelf = await loadShelf(supabase);
  if (shelf.error) return { id: null, error: shelf.error };
  const folderName = role === "reading" ? BOOK_NOTE_FOLDER : NEW_WORD_FOLDER;
  const folder = await rootFolder(supabase, shelf.folders, folderName);
  if (folder.error || !folder.id) return { id: null, error: folder.error };
  const title = bookFileTitle(book.title, role);
  const legacy = shelf.folders.find((item) => !item.deleted_at && item.parent_id == null && item.name === LEGACY_WORD_FOLDER);
  const homes = new Set([folder.id, role === "word" ? legacy?.id : null].filter((id): id is string => Boolean(id)));
  const active = shelf.notes.find(
    (note) => !note.deleted_at && (note.book_id === book.id || note.title === title) && (note.folder_id === folder.id || note.title === title),
  );
  const trashed = shelf.notes.find(
    (note) => Boolean(note.deleted_at) && note.title === title && (note.book_id == null || note.book_id === book.id || homes.has(note.folder_id ?? "")),
  );
  return place(supabase, active ?? trashed ?? null, folder.id, book.id, title);
}

export async function activeWordNotebook(
  supabase: SupabaseClient,
  bookId: string,
  bookTitle: string,
): Promise<{ id: string; body: string } | null> {
  const title = newWordFileTitle(bookTitle);
  const linked = await supabase.from("notes").select("id, body").eq("book_id", bookId).eq("title", title).is("deleted_at", null).maybeSingle();
  if (!linked.error && typeof linked.data?.id === "string") {
    return { id: linked.data.id, body: typeof linked.data.body === "string" ? linked.data.body : "" };
  }
  const named = await supabase.from("notes").select("id, body").eq("title", title).is("deleted_at", null).limit(1).maybeSingle();
  if (named.error || typeof named.data?.id !== "string") return null;
  return { id: named.data.id, body: typeof named.data.body === "string" ? named.data.body : "" };
}
