import type { SupabaseClient } from "@supabase/supabase-js";
import { ancestorInTrash } from "@/lib/notes";

const STOP = new Set([
  "the", "and", "for", "that", "with", "this", "from", "have", "what", "when", "your", "about",
  "note", "notes", "wrote", "write", "find", "something", "they", "them", "was", "were", "are",
  "you", "can", "how", "did", "does", "just", "like", "want", "please", "tell", "show", "where",
  "which", "who", "why", "into", "out", "not", "but", "its", "it's", "my", "me", "a", "an", "of",
]);

interface NoteRow {
  id: string;
  title: string | null;
  body?: string | null;
  folder_id: string | null;
  book_id: string | null;
  deleted_at?: string | null;
}

interface FolderRow {
  id: string;
  parent_id: string | null;
  name: string;
  deleted_at?: string | null;
}

function keywords(message: string): string[] {
  const seen = new Set<string>();
  const words: string[] = [];
  for (const raw of message.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 3 || STOP.has(raw) || seen.has(raw)) continue;
    seen.add(raw);
    words.push(raw);
    if (words.length === 6) break;
  }
  return words;
}

function folderLabel(folders: Map<string, FolderRow>, id: string | null): string {
  if (!id) return "";
  const names: string[] = [];
  let current: string | null = id;
  const seen = new Set<string>();
  while (current && !seen.has(current)) {
    seen.add(current);
    const folder = folders.get(current);
    if (!folder) break;
    names.unshift(folder.name);
    current = folder.parent_id;
  }
  return names.join(" / ");
}

function readable(body: string): string {
  return body
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function excerpt(body: string, words: string[]): string {
  const plain = readable(body);
  const lower = plain.toLowerCase();
  let at = -1;
  for (const word of words) {
    const index = lower.indexOf(word);
    if (index >= 0 && (at < 0 || index < at)) at = index;
  }
  if (at < 0) return plain.slice(0, 700);
  const start = Math.max(0, at - 160);
  const slice = plain.slice(start, start + 800).trim();
  return `${start > 0 ? "…" : ""}${slice}${start + 800 < plain.length ? "…" : ""}`;
}

function place(note: NoteRow, folders: Map<string, FolderRow>, books: Map<string, string>): string {
  if (note.book_id) return `book: ${books.get(note.book_id) ?? "a book"}`;
  const folder = folderLabel(folders, note.folder_id);
  return folder ? `folder: ${folder}` : "folder: Notes";
}

function missingTable(message: string): boolean {
  return /relation|schema cache|does not exist|note_folders|notes/i.test(message);
}

function kept(note: NoteRow, folders: Map<string, FolderRow>): boolean {
  if (note.deleted_at) return false;
  return !ancestorInTrash([...folders.values()], note.folder_id);
}

async function listedNotes(
  supabase: SupabaseClient,
  filter: string | null,
  limit: number,
): Promise<{ rows: NoteRow[]; error: string | null }> {
  const full = "id, title, body, folder_id, book_id, deleted_at";
  const first = filter
    ? await supabase.from("notes").select(full).is("deleted_at", null).or(filter).limit(limit)
    : await supabase.from("notes").select(full).is("deleted_at", null).order("updated_at", { ascending: false }).limit(limit);
  if (first.error && /deleted_at/i.test(first.error.message)) {
    const plain = "id, title, body, folder_id, book_id";
    const second = filter
      ? await supabase.from("notes").select(plain).or(filter).limit(limit)
      : await supabase.from("notes").select(plain).order("updated_at", { ascending: false }).limit(limit);
    return { rows: (second.data ?? []) as NoteRow[], error: second.error?.message ?? null };
  }
  return { rows: (first.data ?? []) as NoteRow[], error: first.error?.message ?? null };
}

export async function loadNoteContext(supabase: SupabaseClient, message: string): Promise<string> {
  const recent = await listedNotes(supabase, null, 12);
  if (recent.error) {
    if (missingTable(recent.error)) return "";
    return "";
  }
  const words = keywords(message);
  let found: NoteRow[] = [];
  if (words.length > 0) {
    const filter = words.map((word) => `title.ilike.%${word}%,body.ilike.%${word}%`).join(",");
    const matches = await listedNotes(supabase, filter, 8);
    if (!matches.error) found = matches.rows;
  }

  const bookIds = [...new Set(recent.rows.concat(found).map((note) => note.book_id).filter((id): id is string => Boolean(id)))];
  const folderQuery = await supabase.from("note_folders").select("id, parent_id, name, deleted_at");
  const folderResult =
    folderQuery.error && /deleted_at/i.test(folderQuery.error.message)
      ? await supabase.from("note_folders").select("id, parent_id, name")
      : folderQuery;
  const bookResult =
    bookIds.length > 0
      ? await supabase.from("books").select("id, title").in("id", bookIds)
      : { data: [], error: null };
  const folders = new Map<string, FolderRow>();
  for (const folder of (folderResult.data ?? []) as FolderRow[]) folders.set(folder.id, folder);
  const books = new Map<string, string>();
  for (const book of (bookResult.data ?? []) as { id: string; title: string }[]) books.set(book.id, book.title);

  const rows = recent.rows.filter((note) => kept(note, folders));
  found = found.filter((note) => kept(note, folders));
  if (rows.length === 0 && found.length === 0) return "";

  const ranked = found
    .map((note) => {
      const title = (note.title ?? "").toLowerCase();
      const body = readable(note.body ?? "").toLowerCase();
      const score = words.reduce((total, word) => total + (title.includes(word) ? 5 : 0) + (body.includes(word) ? 2 : 0), 0);
      return { note, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);

  const matchedIds = new Set(ranked.map((item) => item.note.id));
  const titles = rows
    .filter((note) => !matchedIds.has(note.id))
    .slice(0, 12)
    .map((note) => `- ${note.title?.trim() || "Untitled"} (${place(note, folders, books)})`);
  const previews = rows
    .filter((note) => !matchedIds.has(note.id))
    .slice(0, 6)
    .map((note) => {
      const preview = readable(note.body ?? "").slice(0, 220);
      return `- ${note.title?.trim() || "Untitled"} (${place(note, folders, books)}): ${preview || "Empty note."}`;
    });
  const closest = ranked.map(({ note }) => {
    const quote = excerpt(note.body ?? "", words);
    return `Title: ${note.title?.trim() || "Untitled"}\nWhere: ${place(note, folders, books)}\n${quote}`;
  });

  return [
    "Notes this person wrote. Use them when they ask about something they wrote, even if they only mention one idea from it.",
    "Name the note and where it lives, then quote the matching lines. If none of these match, say you could not find that note. Do not invent a note.",
    titles.length > 0 ? `Recent titles:\n${titles.join("\n")}` : "",
    previews.length > 0 ? `Recent lines:\n${previews.join("\n")}` : "",
    closest.length > 0 ? `Closest notes:\n${closest.join("\n\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}
