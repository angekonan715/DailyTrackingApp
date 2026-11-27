import type { SupabaseClient } from "@supabase/supabase-js";
import { formatLongDate } from "@/lib/dates";
import { activeWordNotebook, reviveBookFile } from "@/lib/book-files";

interface SavedWord {
  word: string;
  definition: string;
  example: string;
  pronunciation?: string;
  book_id: string;
}

function missingTable(message: string): boolean {
  return /relation|schema cache|does not exist|book_words/i.test(message);
}

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

function entryHtml(word: string, definition: string, example: string, searchedLabel: string, pronunciation = ""): string {
  const say = pronunciation.trim() ? `<p>${escapeHtml(pronunciation.trim())}</p>` : "";
  return [
    `<h2><strong>${escapeHtml(word.trim())}</strong></h2>`,
    `<p><em>${escapeHtml(searchedLabel)}</em></p>`,
    say,
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
  let pronunciation = "";
  const meaning: string[] = [];
  for (const line of lines.slice(1)) {
    if (/^searched\s+/i.test(line)) searched = line.replace(/^searched/i, "Searched");
    else if (/^example[.:]\s*/i.test(line)) example = line.replace(/^example[.:]\s*/i, "");
    else if (/^(north american|british|us|uk)\b/i.test(line) && line.includes("/")) {
      pronunciation = pronunciation ? `${pronunciation} · ${line}` : line;
    } else meaning.push(line);
  }
  return entryHtml(word, meaning.join(" "), example, searched || "Searched earlier", pronunciation);
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
  pronunciation = "",
): string {
  const html = asHtml(body);
  const pattern = headingPattern(word);
  const current = html.match(pattern)?.[0] ?? html.match(paragraphPattern(word))?.[0] ?? "";
  const label = keepDate && current ? savedLabel(current, searchedOn) : `Searched ${formatLongDate(searchedOn)}`;
  const cleared = html.replace(pattern, "").replace(paragraphPattern(word), "").trim();
  return `${entryHtml(word, definition, example, label, pronunciation)}${cleared}`.slice(0, 40000);
}

export function removeWordEntry(body: string, word: string): string {
  const html = asHtml(body);
  return html.replace(headingPattern(word), "").replace(paragraphPattern(word), "").trim().slice(0, 40000);
}

export async function keepWordInNotes(
  supabase: SupabaseClient,
  bookId: string,
  bookTitle: string,
  word: string,
  definition: string,
  example: string,
  searchedOn: string,
  keepDate = false,
  pronunciation = "",
): Promise<boolean> {
  const opened = await reviveBookFile(supabase, { id: bookId, title: bookTitle }, "word");
  if (!opened.id) return false;
  const page = await supabase.from("notes").select("id, body").eq("id", opened.id).maybeSingle();
  if (page.error || typeof page.data?.id !== "string") return false;
  const body = typeof page.data.body === "string" ? page.data.body : "";
  const saved = await supabase
    .from("notes")
    .update({
      body: upsertWordEntry(body, word, definition, example, searchedOn, keepDate, pronunciation),
      updated_at: new Date().toISOString(),
    })
    .eq("id", page.data.id);
  return !saved.error;
}

export async function dropWordFromNotes(supabase: SupabaseClient, bookId: string, bookTitle: string, word: string): Promise<void> {
  const page = await activeWordNotebook(supabase, bookId, bookTitle);
  if (!page) return;
  await supabase
    .from("notes")
    .update({ body: removeWordEntry(page.body, word), updated_at: new Date().toISOString() })
    .eq("id", page.id);
}

export async function loadWordContext(supabase: SupabaseClient, message: string): Promise<string> {
  let listed = await supabase
    .from("book_words")
    .select("word, definition, example, pronunciation, book_id")
    .order("updated_at", { ascending: false })
    .limit(40);
  if (listed.error && /pronunciation/i.test(listed.error.message)) {
    const again = await supabase.from("book_words").select("word, definition, example, book_id").order("updated_at", { ascending: false }).limit(40);
    if (again.error || !again.data?.length) return "";
    listed = { ...again, data: again.data.map((item) => ({ ...item, pronunciation: "" })) };
  }
  if (listed.error || !listed.data?.length) {
    if (listed.error && !missingTable(listed.error.message)) return "";
    return "";
  }
  const saved = listed.data as SavedWord[];
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
    return `- ${item.word} (${book}): ${item.pronunciation ? `${item.pronunciation}. ` : ""}${item.definition} Example: ${item.example}`;
  });
  return [
    "Words this person saved while reading. If they ask about one, teach it in one or two short sentences a middle school student would understand, using the definition and example below. If they ask how to say it, use the pronunciation in slashes. Those are simple syllables, not phonetic symbols. Do not invent a saved word.",
    lines.join("\n"),
  ].join("\n");
}
