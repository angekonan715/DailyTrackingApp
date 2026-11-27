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
