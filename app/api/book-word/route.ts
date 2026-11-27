import { createClient } from "@/lib/supabase/server";
import {
  CAP_MESSAGE,
  coachAccess,
  completeChat,
  loadSpend,
  overCap,
  recordSpend,
} from "@/lib/ai-server";
import { isDayKey, monthKey } from "@/lib/coach";
import { toDayKey } from "@/lib/dates";
import { keepWordInNotes } from "@/lib/book-words";

function json(body: unknown, status = 200) {
  return Response.json(body, { status });
}

const TEACH =
  'You teach one word to a middle school student. Use everyday words. Reply with JSON only: {"definition":"...","example":"..."}. The definition is one clear sentence, 18 words or fewer. The example is one short sentence that uses the word, 18 words or fewer. No dictionary talk, no extra facts.';

const POLISH =
  'Rewrite this definition and example so they sound smooth and clear for a middle school student. Keep each one to a single short sentence. Reply with JSON only: {"definition":"...","example":"..."}.';

function cleanWord(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().replace(/[%_\\]/g, "").replace(/\s+/g, " ").slice(0, 80);
}

function lesson(content: string): { definition: string; example: string } | null {
  try {
    const value = JSON.parse(content) as { definition?: unknown; example?: unknown };
    const definition = typeof value.definition === "string" ? value.definition.trim().replace(/\s+/g, " ").slice(0, 400) : "";
    const example = typeof value.example === "string" ? value.example.trim().replace(/\s+/g, " ").slice(0, 280) : "";
    if (definition.length < 8 || example.length < 8) return null;
    return { definition, example };
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return json({ error: "Sign in again." }, 401);

  const body = (await request.json().catch(() => null)) as {
    bookId?: unknown;
    word?: unknown;
    wordId?: unknown;
    today?: unknown;
    polish?: unknown;
  } | null;
  const today = typeof body?.today === "string" && isDayKey(body.today) ? body.today : "";
  if (!today) return json({ error: "Pick a valid day first." }, 400);

  const month = monthKey(today);
  let spend;
  try {
    spend = await loadSpend(supabase, month);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Could not load the coach." }, 500);
  }
  const access = await coachAccess(supabase, user.id);
  if (!("key" in access)) return json({ code: access.code, error: access.message });
  if (overCap(spend.householdCents)) return json({ error: CAP_MESSAGE, monthCents: spend.householdCents }, 429);

  const polishing = body?.polish === true;
  const wordId = typeof body?.wordId === "string" ? body.wordId : "";
  const bookId = typeof body?.bookId === "string" ? body.bookId : "";
  const word = cleanWord(body?.word);

  let prompt = "";
  let bookTitle = "";
  let existingId = "";

  if (polishing) {
    if (!wordId) return json({ error: "Choose a word first." }, 400);
    const row = await supabase.from("book_words").select("id, word, definition, example, book_id").eq("id", wordId).maybeSingle();
    if (row.error) {
      if (/relation|schema cache|does not exist|book_words/i.test(row.error.message)) {
        return json({ error: "Word notes need the word notes script in the Supabase SQL editor." }, 503);
      }
      return json({ error: row.error.message }, 500);
    }
    if (!row.data) return json({ error: "That word is gone." }, 404);
    existingId = row.data.id;
    const book = await supabase.from("books").select("title").eq("id", row.data.book_id).maybeSingle();
    bookTitle = typeof book.data?.title === "string" ? book.data.title : "this book";
    prompt = `Word: ${row.data.word}\nBook: ${bookTitle}\nDefinition: ${row.data.definition}\nExample: ${row.data.example}`;
  } else {
    if (!bookId || word.length < 2) return json({ error: "Type a word from the book." }, 400);
    const book = await supabase.from("books").select("id, title").eq("id", bookId).maybeSingle();
    if (book.error || !book.data) return json({ error: "Open a book you are reading first." }, 404);
    bookTitle = book.data.title;
    const already = await supabase
      .from("book_words")
      .select("id, word, definition, example, book_id, created_at, updated_at")
      .eq("book_id", bookId)
      .ilike("word", word)
      .maybeSingle();
    if (already.error) {
      if (/relation|schema cache|does not exist|book_words/i.test(already.error.message)) {
        return json({ error: "Word notes need the word notes script in the Supabase SQL editor." }, 503);
      }
      return json({ error: already.error.message }, 500);
    }
    if (already.data) {
      const searchedAt = new Date().toISOString();
      await supabase.from("book_words").update({ updated_at: searchedAt }).eq("id", already.data.id);
      const noteSaved = await keepWordInNotes(supabase, bookTitle, already.data.word, already.data.definition, already.data.example, today);
      return json({ word: { ...already.data, updated_at: searchedAt }, already: true, noteSaved });
    }
    prompt = `Word: ${word}\nBook: ${bookTitle}`;
  }

  const result = await completeChat(
    access.key,
    [
      { role: "system", content: polishing ? POLISH : TEACH },
      { role: "user", content: prompt },
    ],
    160,
    true,
  );
  if ("error" in result) return json({ error: result.error }, result.status);
  const taught = lesson(result.content);
  if (!taught) return json({ error: "The explanation was unclear. Try that word again." }, 502);

  try {
    await recordSpend(supabase, user.id, month, spend.ownCents, result.spent);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Could not record the coach cost." }, 500);
  }

  if (polishing) {
    const saved = await supabase
      .from("book_words")
      .update({ definition: taught.definition, example: taught.example })
      .eq("id", existingId)
      .select("id, word, definition, example, book_id, created_at, updated_at")
      .single();
    if (saved.error) return json({ error: saved.error.message }, 500);
    const noteSaved = await keepWordInNotes(
      supabase,
      bookTitle,
      saved.data.word,
      taught.definition,
      taught.example,
      dayKey(saved.data.created_at),
      true,
    );
    return json({ word: saved.data, noteSaved });
  }

  const saved = await supabase
    .from("book_words")
    .insert({ book_id: bookId, word, definition: taught.definition, example: taught.example })
    .select("id, word, definition, example, book_id, created_at, updated_at")
    .single();
  if (saved.error) {
    if (saved.error.code === "23505") return json({ error: "That word is already on this book." }, 409);
    return json({ error: saved.error.message }, 500);
  }
  const noteSaved = await keepWordInNotes(supabase, bookTitle, saved.data.word, taught.definition, taught.example, today);
  return json({ word: saved.data, noteSaved });
}

function dayKey(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value.slice(0, 10) : toDayKey(date);
}
