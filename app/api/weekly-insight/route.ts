import { createClient } from "@/lib/supabase/server";
import {
  CAP_MESSAGE,
  coachAccess,
  completeChat,
  loadSpend,
  overCap,
  recordSpend,
} from "@/lib/ai-server";
import { insightIsComplete, isDayKey, isTimeZone, monthKey, parseCoach, readStoredInsight, weekStartKey } from "@/lib/coach";
import { loadWeekBrief } from "@/lib/week-brief";

function json(body: unknown, status = 200) {
  return Response.json(body, { status });
}

function missingTable(message: string): boolean {
  return /relation|schema cache|does not exist|weekly_insights|ai_usage/i.test(message);
}

async function callerContext(request: Request) {
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

const COACH_SYSTEM =
  'You are a kind coach for one person. Reply with JSON only: {"summary":"...","recommendations":["...","...","..."],"tips":["...","...","..."]}. Summary is two sentences. Each recommendation is practical coaching under 180 characters. Each tip is one encouraging sentence under 140 characters. Use only the numbers you are given. Do not invent workouts, books, steps, or hobbies. Do not give medical advice, diagnoses, or diet plans. Encourage; do not scold.';

export async function GET(request: Request) {
  const context = await callerContext(request);
  if ("error" in context && context.error) return context.error;
  if (!("supabase" in context)) return json({ error: "Sign in again." }, 401);

  const weekStart = weekStartKey(context.today);
  const stored = await context.supabase.from("weekly_insights").select("tips").eq("week_start", weekStart).maybeSingle();
  if (stored.error) {
    if (missingTable(stored.error.message)) {
      return json({ error: "The family coach needs the family AI script in the Supabase SQL editor." }, 503);
    }
    return json({ error: stored.error.message }, 500);
  }
  let spend;
  try {
    spend = await loadSpend(context.supabase, monthKey(context.today));
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Could not load the coach." }, 500);
  }
  const insight = readStoredInsight(stored.data?.tips);
  return json({
    summary: insight?.summary || null,
    recommendations: insight?.recommendations ?? [],
    tips: insight?.tips ?? null,
    cached: Boolean(insight && insightIsComplete(insight)),
    monthCents: spend.householdCents,
    sharedSpend: spend.shared,
  });
}

export async function POST(request: Request) {
  const context = await callerContext(request);
  if ("error" in context && context.error) return context.error;
  if (!("supabase" in context)) return json({ error: "Sign in again." }, 401);

  const { supabase, userId, today, timeZone } = context;
  const weekStart = weekStartKey(today);
  const month = monthKey(today);
  const stored = await supabase.from("weekly_insights").select("tips").eq("week_start", weekStart).maybeSingle();
  if (stored.error) {
    if (missingTable(stored.error.message)) {
      return json({ error: "The family coach needs the family AI script in the Supabase SQL editor." }, 503);
    }
    return json({ error: stored.error.message }, 500);
  }

  let spend;
  try {
    spend = await loadSpend(supabase, month);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Could not load the coach." }, 500);
  }

  const existing = readStoredInsight(stored.data?.tips);
  if (existing && insightIsComplete(existing)) {
    return json({
      summary: existing.summary,
      recommendations: existing.recommendations,
      tips: existing.tips,
      cached: true,
      monthCents: spend.householdCents,
      sharedSpend: spend.shared,
    });
  }

  const access = await coachAccess(supabase, userId);
  if (!("key" in access)) {
    return json(
      {
        summary: null,
        recommendations: [],
        tips: null,
        cached: false,
        monthCents: spend.householdCents,
        sharedSpend: spend.shared,
        code: access.code,
        error: access.message,
      },
      200,
    );
  }
  const apiKey = access.key;
  if (overCap(spend.householdCents)) {
    return json({ error: CAP_MESSAGE, monthCents: spend.householdCents, sharedSpend: spend.shared }, 429);
  }

  let brief: string;
  try {
    brief = await loadWeekBrief(supabase, today, timeZone);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Could not read this week." }, 500);
  }

  const result = await completeChat(
    apiKey,
    [
      { role: "system", content: COACH_SYSTEM },
      { role: "user", content: brief },
    ],
    500,
    true,
  );
  if ("error" in result) return json({ error: result.error }, result.status);

  const insight = parseCoach(result.content);
  let monthCents = spend.householdCents;
  try {
    await recordSpend(supabase, userId, month, spend.ownCents, result.spent);
    monthCents = Math.round((spend.householdCents + result.spent) * 10_000) / 10_000;
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Could not record the coach cost." }, 500);
  }
  if (!insight || !insightIsComplete(insight)) {
    return json({ error: "The coach reply was unreadable. Try the button again.", monthCents }, 502);
  }

  const { error: saveError } = await supabase.from("weekly_insights").upsert(
    { user_id: userId, week_start: weekStart, tips: insight },
    { onConflict: "user_id,week_start" },
  );
  if (saveError) {
    return json(
      { error: saveError.message, summary: insight.summary, recommendations: insight.recommendations, tips: insight.tips, monthCents },
      500,
    );
  }
  return json({
    summary: insight.summary,
    recommendations: insight.recommendations,
    tips: insight.tips,
    cached: false,
    monthCents,
    sharedSpend: spend.shared,
  });
}
