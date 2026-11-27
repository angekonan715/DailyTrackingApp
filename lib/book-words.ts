import type { SupabaseClient } from "@supabase/supabase-js";

interface SavedWord {
  word: string;
  definition: string;
  example: string;
  book_id: string;
}

function missingTable(message: string): boolean {
  return /relation|schema cache|does not exist|book_words/i.test(message);
}

export const WORD_NOTES_FOLDER = "Word notes";

function wordBlock(word: string, definition: string, example: string): string {
  return `${word.trim()}\n${definition.trim()}\nExample: ${example.trim()}`;
}

function blocks(body: string): string[] {
  return body
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function sameWord(block: string, word: string): boolean {
  return (block.split("\n")[0] ?? "").trim().toLowerCase() === word.trim().toLowerCase();
}

export function upsertWordEntry(body: string, word: string, definition: string, example: string): string {
  const next = wordBlock(word, definition, example);
  const parts = blocks(body);
  const index = parts.findIndex((part) => sameWord(part, word));
  if (index >= 0) parts[index] = next;
  else parts.unshift(next);
  return parts.join("\n\n").slice(0, 40000);
}

export function removeWordEntry(body: string, word: string): string {
  return blocks(body)
    .filter((part) => !sameWord(part, word))
    .join("\n\n");
}

async function wordNotesFolder(supabase: SupabaseClient): Promise<string | null> {
  const existing = await supabase
    .from("note_folders")
    .select("id")
    .is("parent_id", null)
    .eq("name", WORD_NOTES_FOLDER)
    .limit(1)
    .maybeSingle();
  if (existing.error) return null;
  if (typeof existing.data?.id === "string") return existing.data.id;
  const created = await supabase.from("note_folders").insert({ name: WORD_NOTES_FOLDER }).select("id").single();
  return typeof created.data?.id === "string" ? created.data.id : null;
}

async function notebook(supabase: SupabaseClient, bookTitle: string): Promise<{ id: string; body: string } | null> {
  const folderId = await wordNotesFolder(supabase);
  if (!folderId) return null;
  const title = bookTitle.trim().slice(0, 200) || "Words";
  const found = await supabase.from("notes").select("id, body").eq("folder_id", folderId).eq("title", title).is("book_id", null).maybeSingle();
  if (found.error) return null;
  if (typeof found.data?.id === "string") {
    return { id: found.data.id, body: typeof found.data.body === "string" ? found.data.body : "" };
  }
  const created = await supabase.from("notes").insert({ folder_id: folderId, title, body: "" }).select("id, body").single();
  if (created.error || typeof created.data?.id !== "string") return null;
  return { id: created.data.id, body: "" };
}

export async function keepWordInNotes(
  supabase: SupabaseClient,
  bookTitle: string,
  word: string,
  definition: string,
  example: string,
): Promise<boolean> {
  const page = await notebook(supabase, bookTitle);
  if (!page) return false;
  const saved = await supabase
    .from("notes")
    .update({ body: upsertWordEntry(page.body, word, definition, example), updated_at: new Date().toISOString() })
    .eq("id", page.id);
  return !saved.error;
}

export async function dropWordFromNotes(supabase: SupabaseClient, bookTitle: string, word: string): Promise<void> {
  const page = await notebook(supabase, bookTitle);
  if (!page) return;
  await supabase
    .from("notes")
    .update({ body: removeWordEntry(page.body, word), updated_at: new Date().toISOString() })
    .eq("id", page.id);
}

export async function loadWordContext(supabase: SupabaseClient, message: string): Promise<string> {
  const rows = await supabase
    .from("book_words")
    .select("word, definition, example, book_id")
    .order("updated_at", { ascending: false })
    .limit(40);
  if (rows.error || !rows.data?.length) {
    if (rows.error && !missingTable(rows.error.message)) return "";
    return "";
  }
  const saved = rows.data as SavedWord[];
  const bookIds = [...new Set(saved.map((item) => item.book_id))];
  const books = await supabase.from("books").select("id, title").in("id", bookIds);
  const titles = new Map<string, string>();
  for (const book of (books.data ?? []) as { id: string; title: string }[]) titles.set(book.id, book.title);

  const needle = message.toLowerCase();
  const ranked = [...saved].sort((a, b) => {
    const aHit = needle.includes(a.word.toLowerCase()) ? 1 : 0;
    const bHit = needle.includes(b.word.toLowerCase()) ? 1 : 0;
    return bHit - aHit;
  });
  const lines = ranked.slice(0, 12).map((item) => {
    const book = titles.get(item.book_id) ?? "a book";
    return `- ${item.word} (${book}): ${item.definition} Example: ${item.example}`;
  });
  return [
    "Words this person saved while reading. If they ask about one, teach it in one or two short sentences a middle school student would understand, using the definition and example below. Do not invent a saved word.",
    lines.join("\n"),
  ].join("\n");
}
