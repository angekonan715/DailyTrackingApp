import type { SupabaseClient } from "@supabase/supabase-js";
import { formatLongDate } from "@/lib/dates";

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

function blocks(body: string): string[] {
  return body
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapePattern(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function looksFormatted(body: string): boolean {
  return /<\/?[a-z][\s\S]*>/i.test(body);
}

function entryHtml(word: string, definition: string, example: string, searchedLabel: string): string {
  return [
    `<h2><strong>${escapeHtml(word.trim())}</strong></h2>`,
    `<p><em>${escapeHtml(searchedLabel)}</em></p>`,
    `<p>${escapeHtml(definition.trim())}</p>`,
    `<p><strong>Example.</strong> ${escapeHtml(example.trim())}</p>`,
  ].join("");
}

function headingPattern(word: string): RegExp {
  const name = escapePattern(word.trim());
  return new RegExp(
    `<h2>\\s*(?:<strong>)?\\s*${name}\\s*(?:</strong>)?\\s*</h2>[\\s\\S]*?(?=<h2>|$)`,
    "i",
  );
}

function paragraphPattern(word: string): RegExp {
  const name = escapePattern(word.trim());
  return new RegExp(
    `<p>\\s*(?:<strong>)?\\s*${name}\\s*(?:</strong>)?\\s*</p>\\s*<p>[\\s\\S]*?</p>\\s*<p>[\\s\\S]*?Example[\\s\\S]*?</p>`,
    "i",
  );
}

function savedLabel(block: string, fallback: string): string {
  const line = block
    .replace(/<[^>]+>/g, "\n")
    .split("\n")
    .map((part) => part.trim())
    .find((part) => /^searched\s+/i.test(part));
  if (!line) return `Searched ${formatLongDate(fallback)}`;
  return /^searched\s+/i.test(line) ? line.replace(/^searched/i, "Searched") : line;
}

function plainEntryToHtml(block: string): string {
  const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) return "";
  const word = lines[0] ?? "";
  let searched = "";
  let example = "";
  const meaning: string[] = [];
  for (const line of lines.slice(1)) {
    if (/^searched\s+/i.test(line)) searched = line.replace(/^searched/i, "Searched");
    else if (/^example[.:]\s*/i.test(line)) example = line.replace(/^example[.:]\s*/i, "");
    else meaning.push(line);
  }
  return entryHtml(word, meaning.join(" "), example, searched || "Searched earlier");
}

function asHtml(body: string): string {
  if (!body.trim()) return "";
  if (looksFormatted(body)) return body;
  return blocks(body).map(plainEntryToHtml).join("");
}

export function upsertWordEntry(
  body: string,
  word: string,
  definition: string,
  example: string,
  searchedOn: string,
  keepDate = false,
): string {
  const html = asHtml(body);
  const pattern = headingPattern(word);
  const current = html.match(pattern)?.[0] ?? html.match(paragraphPattern(word))?.[0] ?? "";
  const label = keepDate && current ? savedLabel(current, searchedOn) : `Searched ${formatLongDate(searchedOn)}`;
  const cleared = html.replace(pattern, "").replace(paragraphPattern(word), "").trim();
  return `${entryHtml(word, definition, example, label)}${cleared}`.slice(0, 40000);
}

export function removeWordEntry(body: string, word: string): string {
  const html = asHtml(body);
  return html.replace(headingPattern(word), "").replace(paragraphPattern(word), "").trim().slice(0, 40000);
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
  searchedOn: string,
  keepDate = false,
): Promise<boolean> {
  const page = await notebook(supabase, bookTitle);
  if (!page) return false;
  const saved = await supabase
    .from("notes")
    .update({
      body: upsertWordEntry(page.body, word, definition, example, searchedOn, keepDate),
      updated_at: new Date().toISOString(),
    })
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
