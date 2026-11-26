"use client";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { Book, DailySteps, ReadingSession, Task, Workout } from "@/types";
import PageHeader from "@/components/PageHeader";
import SetupNotice from "@/components/SetupNotice";
import WeeklyInsight from "@/components/summary/WeeklyInsight";
import GoalBoard from "@/components/goals/GoalBoard";
import { ALL_GOAL_METRICS } from "@/lib/goals";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { addDays, dayStreak, parseDayKey, startOfWeek, toDayKey } from "@/lib/dates";
import { pagesLeft, percentComplete } from "@/lib/books";
import {
  activeDayStreak,
  formatDistance,
  formatMinutes,
  normalizeWorkout,
  totalsBetween,
  type DistanceUnit,
} from "@/lib/workouts";

const UNIT_KEY = "daily-hub-distance-unit";

function subscribeToday() {
  return () => {};
}

function subscribeUnit(onChange: () => void) {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

function readUnit(): DistanceUnit {
  return localStorage.getItem(UNIT_KEY) === "mi" ? "mi" : "km";
}

function friendlyError(message: string): string {
  if (/relation|schema cache|does not exist/i.test(message)) {
    return "A table is missing. In Supabase, open the SQL Editor and run supabase/migrations/0001_init.sql.";
  }
  if (/jwt|not authenticated|invalid claim/i.test(message)) return "Your session expired. Sign in again.";
  return message;
}

interface Snapshot {
  tasks: Pick<Task, "task_date" | "done">[];
  workouts: Workout[];
  steps: DailySteps[];
  books: Pick<Book, "id" | "title" | "status" | "total_pages" | "current_page">[];
  sessions: Pick<ReadingSession, "day">[];
}

async function fetchSnapshot(weekStart: string, weekEnd: string): Promise<Snapshot> {
  const supabase = createClient();
  const [tasks, workouts, steps, books, sessions] = await Promise.all([
    supabase.from("tasks").select("task_date, done").order("task_date", { ascending: false }).limit(2000),
    supabase
      .from("workouts")
      .select("id, user_id, started_at, type, duration_min, distance_km, calories, avg_heart_rate, notes, source, created_at")
      .order("started_at", { ascending: false })
      .limit(1000),
    supabase.from("daily_steps").select("user_id, day, steps").gte("day", weekStart).lt("day", weekEnd),
    supabase.from("books").select("id, title, status, total_pages, current_page").eq("status", "reading"),
    supabase.from("reading_sessions").select("day").order("day", { ascending: false }).limit(2000),
  ]);
  const error = tasks.error ?? workouts.error ?? steps.error ?? books.error ?? sessions.error;
  if (error) throw error;
  return {
    tasks: (tasks.data ?? []) as Snapshot["tasks"],
    workouts: ((workouts.data ?? []) as Workout[]).map(normalizeWorkout),
    steps: (steps.data ?? []) as DailySteps[],
    books: ((books.data ?? []) as Snapshot["books"]).map((book) => ({
      ...book,
      total_pages: Number(book.total_pages),
      current_page: Number(book.current_page),
    })),
    sessions: (sessions.data ?? []) as Snapshot["sessions"],
  };
}

function errorText(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) return friendlyError(String(error.message));
  return "Could not load your summary.";
}

export default function SummaryBoard() {
  if (!isSupabaseConfigured()) {
    return (
      <>
        <PageHeader title="Summary" />
        <SetupNotice />
      </>
    );
  }
  return <SummaryScreen />;
}

function SummaryScreen() {
  const todayKey = useSyncExternalStore(subscribeToday, toDayKey, () => "");
  const unit = useSyncExternalStore(subscribeUnit, readUnit, () => "km" as DistanceUnit);
  const [data, setData] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const weekStart = todayKey ? toDayKey(startOfWeek(parseDayKey(todayKey))) : "";
  const weekEnd = weekStart ? toDayKey(addDays(parseDayKey(weekStart), 7)) : "";
  const lastWeekStart = weekStart ? toDayKey(addDays(parseDayKey(weekStart), -7)) : "";

  useEffect(() => {
    if (!weekStart || !weekEnd) return;
    let cancelled = false;
    async function run() {
      try {
        const snapshot = await fetchSnapshot(weekStart, weekEnd);
        if (cancelled) return;
        setData(snapshot);
        setError(null);
      } catch (loadError) {
        if (cancelled) return;
        setError(errorText(loadError));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [weekStart, weekEnd]);

  const todayTasks = data?.tasks.filter((task) => task.task_date === todayKey) ?? [];
  const todayDone = todayTasks.filter((task) => task.done).length;
  const todayPercent = todayTasks.length === 0 ? 0 : Math.round((todayDone / todayTasks.length) * 100);
  const thisWeek = data
    ? totalsBetween(data.workouts, parseDayKey(weekStart), parseDayKey(weekEnd))
    : null;
  const lastWeek = data
    ? totalsBetween(data.workouts, parseDayKey(lastWeekStart), parseDayKey(weekStart))
    : null;
  const stepTotal = data?.steps.reduce((sum, row) => sum + Number(row.steps), 0) ?? 0;
  const todaySteps = data?.steps.find((row) => row.day === todayKey)?.steps;
  const reading = data?.books ?? [];
  const todayDate = todayKey ? parseDayKey(todayKey) : null;

  return (
    <>
      <PageHeader title="Summary" subtitle="Today, this week, and this month against your goals" />
      <GoalBoard metrics={ALL_GOAL_METRICS} />
      {error ? (
        <p role="alert" className="mb-4 rounded-2xl bg-card px-4 py-3 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
      {loading ? (
        <div className="space-y-3">
          <div className="h-24 animate-pulse rounded-2xl bg-card" />
          <div className="h-24 animate-pulse rounded-2xl bg-card" />
          <div className="h-24 animate-pulse rounded-2xl bg-card" />
        </div>
      ) : data && thisWeek && lastWeek && todayDate ? (
        <div className="space-y-3">
          <section className="rounded-2xl bg-card p-4">
            <h2 className="font-semibold">Today</h2>
            {todayTasks.length === 0 ? (
              <p className="mt-2 text-sm text-muted">No to-dos today.</p>
            ) : (
              <>
                <p className="mt-2 text-sm">
                  {todayDone} of {todayTasks.length} done
                </p>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-background">
                  <div className="h-full bg-accent" style={{ width: `${todayPercent}%` }} />
                </div>
              </>
            )}
          </section>

          <section className="rounded-2xl bg-card p-4">
            <h2 className="font-semibold">Workouts</h2>
            <p className="mt-2 text-sm">
              This week: {formatMinutes(thisWeek.minutes)} · {thisWeek.count} workouts ·{" "}
              {formatDistance(thisWeek.distanceKm, unit)}
            </p>
            <p className="mt-1 text-sm text-muted">
              Last week: {formatMinutes(lastWeek.minutes)} · {lastWeek.count} workouts ·{" "}
              {formatDistance(lastWeek.distanceKm, unit)}
            </p>
          </section>

          <section className="rounded-2xl bg-card p-4">
            <h2 className="font-semibold">Steps</h2>
            {data.steps.length === 0 ? (
              <p className="mt-2 text-sm text-muted">
                No steps this week.{" "}
                <Link href="/workouts/import" className="font-medium text-accent">
                  Import a Samsung step file
                </Link>
              </p>
            ) : (
              <p className="mt-2 text-sm">
                {stepTotal.toLocaleString()} this week
                {todaySteps == null ? "" : ` · ${Number(todaySteps).toLocaleString()} today`}
              </p>
            )}
          </section>

          <section className="rounded-2xl bg-card p-4">
            <h2 className="font-semibold">Books in progress</h2>
            {reading.length === 0 ? (
              <p className="mt-2 text-sm text-muted">No book is marked Reading.</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {reading.map((book) => (
                  <li key={book.id} className="text-sm">
                    <span className="font-medium">{book.title}</span>
                    <span className="text-muted">
                      {" "}
                      · {pagesLeft(book)} pages left · {percentComplete(book)}%
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="grid grid-cols-3 gap-2">
            <Streak
              label="To-do days"
              value={dayStreak(
                data.tasks.filter((task) => task.done).map((task) => task.task_date),
                todayDate,
              )}
            />
            <Streak label="Active days" value={activeDayStreak(data.workouts, todayDate)} />
            <Streak
              label="Reading days"
              value={dayStreak(
                data.sessions.map((session) => session.day),
                todayDate,
              )}
            />
          </section>

          {todayKey ? <WeeklyInsight today={todayKey} /> : null}
        </div>
      ) : null}
    </>
  );
}

function Streak({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl bg-card px-2 py-4 text-center">
      <p className="text-2xl font-bold">{value}</p>
      <p className="mt-1 text-xs text-muted">{label}</p>
    </div>
  );
}
