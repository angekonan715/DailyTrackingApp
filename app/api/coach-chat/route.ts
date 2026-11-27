import { createClient } from "@/lib/supabase/server";
import {
  CAP_MESSAGE,
  coachAccess,
  completeChat,
  loadSpend,
  overCap,
  recordSpend,
} from "@/lib/ai-server";
import { isDayKey, isTimeZone, monthKey } from "@/lib/coach";
import { loadWeekBrief } from "@/lib/week-brief";
import { loadNoteContext } from "@/lib/note-search";
import { loadWordContext } from "@/lib/book-words";

function json(body: unknown, status = 200) {
  return Response.json(body, { status });
}

function missingTable(message: string): boolean {
  return /relation|schema cache|does not exist|coach_messages/i.test(message);
}

interface StoredMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return json({ error: "Sign in again." }, 401);

  const rows = await supabase
    .from("coach_messages")
    .select("id, role, content")
    .order("created_at", { ascending: false })
    .limit(20);
  if (rows.error) {
    if (missingTable(rows.error.message)) {
      return json({ messages: [], error: "Chat needs the family AI script in the Supabase SQL editor." }, 503);
    }
    return json({ error: rows.error.message }, 500);
  }
  const messages = ((rows.data ?? []) as StoredMessage[]).reverse();
  return json({ messages });
}

export async function DELETE() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return json({ error: "Sign in again." }, 401);
  const { error } = await supabase.from("coach_messages").delete().eq("user_id", user.id);
  if (error) {
    if (missingTable(error.message)) return json({ error: "Chat needs the family AI script in the Supabase SQL editor." }, 503);
    return json({ error: error.message }, 500);
  }
  return json({ messages: [] });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return json({ error: "Sign in again." }, 401);

  const body = (await request.json().catch(() => null)) as {
    today?: unknown;
    timeZone?: unknown;
    message?: unknown;
  } | null;
  const today = typeof body?.today === "string" ? body.today : "";
  const timeZone = typeof body?.timeZone === "string" && isTimeZone(body.timeZone) ? body.timeZone : "UTC";
  const message = typeof body?.message === "string" ? body.message.trim().slice(0, 500) : "";
  if (!isDayKey(today)) return json({ error: "Pick a valid day first." }, 400);
  if (!message) return json({ error: "Type a message first." }, 400);

  const month = monthKey(today);
  let spend;
  try {
    spend = await loadSpend(supabase, month);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Could not load the coach." }, 500);
  }
  const access = await coachAccess(supabase, user.id);
  if (!("key" in access)) return json({ code: access.code, error: access.message }, 200);
  const apiKey = access.key;
  if (overCap(spend.householdCents)) return json({ error: CAP_MESSAGE, monthCents: spend.householdCents }, 429);

  const history = await supabase
    .from("coach_messages")
    .select("role, content")
    .order("created_at", { ascending: false })
    .limit(8);
  if (history.error && missingTable(history.error.message)) {
    return json({ error: "Chat needs the family AI script in the Supabase SQL editor." }, 503);
  }
  if (history.error) return json({ error: history.error.message }, 500);

  let brief = `Day ${today}.`;
  try {
    brief = await loadWeekBrief(supabase, today, timeZone);
  } catch {
    brief = `Day ${today}.`;
  }
  const notes = await loadNoteContext(supabase, message);
  const words = await loadWordContext(supabase, message);

  const prior = ((history.data ?? []) as { role: "user" | "assistant"; content: string }[])
    .reverse()
    .filter((item) => item.role === "user" || item.role === "assistant");

  const result = await completeChat(
    apiKey,
    [
      {
        role: "system",
        content: `You are the Daily Hub coach for one person. Help with their tasks, workouts, reading, hobbies, notes, and motivation. Use the week summary, their notes, their saved words, and what they tell you. When they mention an idea from a note, find that note, say its title and where it lives, and quote the matching lines. When they ask about a saved word, explain it in one or two short sentences a middle school student would understand, and include the example. If you do not know a number or cannot find a note, say so. Keep everyday replies under 80 words. A note or word answer may be a little longer. No medical diagnosis or diet plan. Never ask for or repeat an API key.\n\nWeek:\n${brief}${notes ? `\n\n${notes}` : ""}${words ? `\n\n${words}` : ""}`,
      },
      ...prior.map((item) => ({ role: item.role, content: item.content })),
      { role: "user", content: message },
    ],
    400,
    false,
  );
  if ("error" in result) return json({ error: result.error }, result.status);
  const reply = result.content.trim().slice(0, 2000);
  if (!reply) return json({ error: "The coach did not answer. Try again in a minute." }, 502);

  const saved = await supabase.from("coach_messages").insert([
    { role: "user", content: message },
    { role: "assistant", content: reply },
  ]);
  if (saved.error) return json({ error: saved.error.message, reply }, 500);

  try {
    await recordSpend(supabase, user.id, month, spend.ownCents, result.spent);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Could not record the coach cost.", reply }, 500);
  }

  return json({
    reply,
    monthCents: Math.round((spend.householdCents + result.spent) * 10_000) / 10_000,
  });
}
