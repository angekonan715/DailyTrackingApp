import { createClient } from "@/lib/supabase/server";
import {
  CAP_MESSAGE,
  coachAccess,
  completeChat,
  loadSpend,
  overCap,
  recordSpend,
} from "@/lib/ai-server";
import { isDayKey, isTimeZone, monthKey, parseQuote } from "@/lib/coach";
import { loadWeekBrief } from "@/lib/week-brief";

function json(body: unknown, status = 200) {
  return Response.json(body, { status });
}

function missingTable(message: string): boolean {
  return /relation|schema cache|does not exist|daily_quotes/i.test(message);
}

async function caller(request: Request) {
  const url = new URL(request.url);
  let today = url.searchParams.get("today") ?? "";
  let timeZone = url.searchParams.get("timeZone") ?? "UTC";
  if (request.method === "POST") {
    const body = (await request.json().catch(() => null)) as { today?: unknown; timeZone?: unknown } | null;
    if (typeof body?.today === "string") today = body.today;
    if (typeof body?.timeZone === "string") timeZone = body.timeZone;
  }
  if (!isDayKey(today)) return { error: json({ error: "Pick a valid day first." }, 400) };
  if (!isTimeZone(timeZone)) timeZone = "UTC";
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: json({ error: "Sign in again." }, 401) };
  return { supabase, userId: user.id, today, timeZone };
}

export async function GET(request: Request) {
  const context = await caller(request);
  if ("error" in context && context.error) return context.error;
  if (!("supabase" in context)) return json({ error: "Sign in again." }, 401);

  const row = await context.supabase.from("daily_quotes").select("quote, author").eq("day", context.today).maybeSingle();
  if (row.error) {
    if (missingTable(row.error.message)) {
      return json({ error: "Daily quotes need the family AI script in the Supabase SQL editor." }, 503);
    }
    return json({ error: row.error.message }, 500);
  }
  return json({
    quote: typeof row.data?.quote === "string" ? row.data.quote : null,
    author: typeof row.data?.author === "string" ? row.data.author : null,
  });
}

export async function POST(request: Request) {
  const context = await caller(request);
  if ("error" in context && context.error) return context.error;
  if (!("supabase" in context)) return json({ error: "Sign in again." }, 401);

  const { supabase, userId, today, timeZone } = context;
  const existing = await supabase.from("daily_quotes").select("quote, author").eq("day", today).maybeSingle();
  if (existing.error) {
    if (missingTable(existing.error.message)) {
      return json({ error: "Daily quotes need the family AI script in the Supabase SQL editor." }, 503);
    }
    return json({ error: existing.error.message }, 500);
  }
  if (typeof existing.data?.quote === "string") {
    return json({ quote: existing.data.quote, author: existing.data.author });
  }

  const month = monthKey(today);
  let spend;
  try {
    spend = await loadSpend(supabase, month);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Could not load the coach." }, 500);
  }
  const access = await coachAccess(supabase, userId);
  if (!("key" in access)) return json({ quote: null, code: access.code, error: access.message });
  const apiKey = access.key;
  if (overCap(spend.householdCents)) return json({ error: CAP_MESSAGE, monthCents: spend.householdCents }, 429);

  let brief = "";
  try {
    brief = await loadWeekBrief(supabase, today, timeZone);
  } catch {
    brief = `Day ${today}.`;
  }

  const result = await completeChat(
    apiKey,
    [
      {
        role: "system",
        content:
          'Write one original motivational sentence for this person. Reply with JSON only: {"quote":"...","author":"Daily Hub"}. Under 140 characters. Warm and specific only when the week summary supports it. Do not attribute the line to a real person. No medical advice.',
      },
      { role: "user", content: brief },
    ],
    120,
    true,
  );
  if ("error" in result) return json({ error: result.error }, result.status);
  const quote = parseQuote(result.content);
  if (!quote) return json({ error: "The quote was unreadable. Open Today again in a minute." }, 502);

  try {
    await recordSpend(supabase, userId, month, spend.ownCents, result.spent);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Could not record the coach cost." }, 500);
  }

  const saved = await supabase.from("daily_quotes").insert({ day: today, quote: quote.quote, author: quote.author });
  if (saved.error && saved.error.code !== "23505") return json({ error: saved.error.message }, 500);
  return json({ quote: quote.quote, author: quote.author });
}
