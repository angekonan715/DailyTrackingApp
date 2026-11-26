import { createClient } from "@/lib/supabase/server";
import { pagesLeft } from "@/lib/books";
import {
  COACH_MODEL,
  MONTHLY_CAP_CENTS,
  buildWeekBrief,
  dayKeyInZone,
  estimateCents,
  isDayKey,
  isTimeZone,
  monthKey,
  nextWeekKey,
  parseTips,
  streakEnding,
  weekStartKey,
} from "@/lib/coach";
import type { Book } from "@/types";

interface InsightRow {
  tips: unknown;
}

interface UsageRow {
  cost_cents: number | string;
}

function json(body: unknown, status = 200) {
  return Response.json(body, { status });
}

function missingTable(message: string): boolean {
  return /relation|schema cache|does not exist|weekly_insights|ai_usage/i.test(message);
}

function asTips(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const tips = value.filter((item): item is string => typeof item === "string").slice(0, 3);
  return tips.length === 3 ? tips : null;
}

async function callerContext(request: Request) {
  const url = new URL(request.url);
  let today = url.searchParams.get("today") ?? "";
  let timeZone = url.searchParams.get("timeZone") ?? "UTC";
  if (request.method === "POST") {
    const body = (await request.json().catch(() => null)) as {
      today?: unknown;
      timeZone?: unknown;
    } | null;
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

async function loadCache(
  supabase: Awaited<ReturnType<typeof createClient>>,
  weekStart: string,
  month: string,
) {
  const [insightResult, usageResult] = await Promise.all([
    supabase
      .from("weekly_insights")
      .select("tips")
      .eq("week_start", weekStart)
      .maybeSingle(),
    supabase.from("ai_usage").select("cost_cents").eq("month", month).maybeSingle(),
  ]);
  const error = insightResult.error ?? usageResult.error;
  if (error) {
    if (missingTable(error.message)) {
      return {
        error: json(
          {
            error:
              "The coach tables are missing. In Supabase, open the SQL Editor, paste supabase/migrations/0002_weekly_insights.sql, and run it.",
          },
          503,
        ),
      };
    }
    return { error: json({ error: error.message }, 500) };
  }
  const insight = insightResult.data as InsightRow | null;
  const usage = usageResult.data as UsageRow | null;
  return {
    tips: asTips(insight?.tips),
    monthCents: Number(usage?.cost_cents ?? 0),
  };
}

export async function GET(request: Request) {
  const context = await callerContext(request);
  if ("error" in context && context.error) return context.error;
  if (!("supabase" in context)) return json({ error: "Sign in again." }, 401);

  const weekStart = weekStartKey(context.today);
  const cached = await loadCache(context.supabase, weekStart, monthKey(context.today));
  if ("error" in cached && cached.error) return cached.error;
  if (!("tips" in cached)) return json({ error: "Could not load this week's insight." }, 500);

  return json({
    tips: cached.tips,
    cached: Boolean(cached.tips),
    monthCents: cached.monthCents,
  });
}

export async function POST(request: Request) {
  const context = await callerContext(request);
  if ("error" in context && context.error) return context.error;
  if (!("supabase" in context)) return json({ error: "Sign in again." }, 401);

  const { supabase, userId, today, timeZone } = context;
  const weekStart = weekStartKey(today);
  const month = monthKey(today);
  const cached = await loadCache(supabase, weekStart, month);
  if ("error" in cached && cached.error) return cached.error;
  if (!("tips" in cached)) return json({ error: "Could not load this week's insight." }, 500);
  if (cached.tips) {
    return json({ tips: cached.tips, cached: true, monthCents: cached.monthCents });
  }

  const stored = await supabase.from("user_settings").select("openai_api_key").maybeSingle();
  const storedKey =
    stored.error || typeof stored.data?.openai_api_key !== "string" ? "" : stored.data.openai_api_key.trim();
  const apiKey = process.env.AI_API_KEY?.trim() || storedKey;
  if (!apiKey) {
    return json(
      {
        tips: null,
        cached: false,
        monthCents: cached.monthCents,
        code: "missing_key",
        error:
          "Add your OpenAI key in the box under Weekly insight. The app uses gpt-4o-mini and stops at $5 per month.",
      },
      200,
    );
  }
  if (cached.monthCents >= MONTHLY_CAP_CENTS) {
    return json(
      {
        error: "The coach has reached the $5 limit for this month. It will work again next month.",
        monthCents: cached.monthCents,
      },
      429,
    );
  }

  const weekEnd = nextWeekKey(weekStart);
  const [tasksResult, workoutsResult, stepsResult, sessionsResult, booksResult] = await Promise.all([
    supabase.from("tasks").select("task_date, done").order("task_date", { ascending: false }).limit(2000),
    supabase
      .from("workouts")
      .select("started_at, duration_min, distance_km")
      .order("started_at", { ascending: false })
      .limit(1000),
    supabase.from("daily_steps").select("day, steps").gte("day", weekStart).lt("day", weekEnd),
    supabase.from("reading_sessions").select("day, pages_read").order("day", { ascending: false }).limit(2000),
    supabase.from("books").select("title, status, total_pages, current_page").eq("status", "reading"),
  ]);
  const loadError =
    tasksResult.error ??
    workoutsResult.error ??
    stepsResult.error ??
    sessionsResult.error ??
    booksResult.error;
  if (loadError) return json({ error: loadError.message }, 500);

  const tasks = (tasksResult.data ?? []) as { task_date: string; done: boolean }[];
  const weekTasks = tasks.filter((task) => task.task_date >= weekStart && task.task_date < weekEnd);
  const workouts = (workoutsResult.data ?? []) as {
    started_at: string;
    duration_min: number | string;
    distance_km: number | string | null;
  }[];
  const weekWorkouts = workouts.filter((workout) => {
    const day = dayKeyInZone(workout.started_at, timeZone);
    return day >= weekStart && day < weekEnd;
  });
  const stepRows = (stepsResult.data ?? []) as { steps: number }[];
  const sessions = (sessionsResult.data ?? []) as { day: string; pages_read: number | string }[];
  const weekSessions = sessions.filter((session) => session.day >= weekStart && session.day < weekEnd);
  const books = ((booksResult.data ?? []) as Pick<Book, "title" | "status" | "total_pages" | "current_page">[]).map(
    (book) => ({
      ...book,
      total_pages: Number(book.total_pages),
      current_page: Number(book.current_page),
    }),
  );

  const readingDays = new Set(weekSessions.map((session) => session.day));
  const brief = buildWeekBrief({
    today,
    tasksDone: weekTasks.filter((task) => task.done).length,
    tasksTotal: weekTasks.length,
    workoutCount: weekWorkouts.length,
    workoutMinutes: weekWorkouts.reduce((sum, workout) => sum + Number(workout.duration_min), 0),
    distanceKm: weekWorkouts.reduce((sum, workout) => sum + Number(workout.distance_km ?? 0), 0),
    steps: stepRows.length === 0 ? null : stepRows.reduce((sum, row) => sum + Number(row.steps), 0),
    pagesRead: weekSessions.reduce((sum, session) => sum + Number(session.pages_read), 0),
    readingDays: readingDays.size,
    todoStreak: streakEnding(
      tasks.filter((task) => task.done).map((task) => task.task_date),
      today,
    ),
    activeStreak: streakEnding(
      workouts.map((workout) => dayKeyInZone(workout.started_at, timeZone)),
      today,
    ),
    readingStreak: streakEnding(
      sessions.map((session) => session.day),
      today,
    ),
    books: books.map((book) => ({ title: book.title, pagesLeft: pagesLeft(book) })),
  });

  let upstream: Response;
  try {
    upstream = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(20000),
      body: JSON.stringify({
        model: COACH_MODEL,
        temperature: 0.7,
        max_tokens: 300,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              'You are a kind coach for one person. Reply with JSON only: {"tips":["...","...","..."]}. Each tip is one sentence under 140 characters. Use only the numbers you are given. Do not invent workouts, books, or steps. Encourage; do not scold.',
          },
          { role: "user", content: brief },
        ],
      }),
    });
  } catch {
    return json({ error: "The coach did not answer. Try again in a minute." }, 502);
  }

  if (!upstream.ok) {
    const detail = (await upstream.json().catch(() => null)) as { error?: { message?: string } } | null;
    const message =
      upstream.status === 401
        ? "OpenAI rejected that key. Check it and save it again."
        : (detail?.error?.message ?? "The coach did not answer. Try again in a minute.");
    return json({ error: message }, 502);
  }

  const payload = (await upstream.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const content = payload.choices?.[0]?.message?.content ?? "";
  const tips = parseTips(content);
  const spent = estimateCents(
    payload.usage?.prompt_tokens ?? null,
    payload.usage?.completion_tokens ?? null,
  );
  const monthCents = Math.round((cached.monthCents + spent) * 10_000) / 10_000;

  const { error: usageError } = await supabase.from("ai_usage").upsert(
    { user_id: userId, month, cost_cents: monthCents },
    { onConflict: "user_id,month" },
  );
  if (usageError) return json({ error: usageError.message }, 500);

  if (!tips) {
    return json(
      { error: "The coach reply was unreadable. Try the button again.", monthCents },
      502,
    );
  }

  const { error: saveError } = await supabase.from("weekly_insights").upsert(
    { user_id: userId, week_start: weekStart, tips },
    { onConflict: "user_id,week_start" },
  );
  if (saveError) return json({ error: saveError.message, tips, monthCents }, 500);

  return json({ tips, cached: false, monthCents });
}
