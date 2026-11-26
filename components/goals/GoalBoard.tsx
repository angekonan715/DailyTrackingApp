"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import type { Goal, GoalMetric } from "@/types";
import { createClient } from "@/lib/supabase/client";
import { toDayKey } from "@/lib/dates";
import {
  dailyShare,
  formatAmount,
  inDayRange,
  metricLabel,
  monthBounds,
  paceLabel,
  weekBounds,
  type PeriodCounts,
} from "@/lib/goals";

const field =
  "w-full min-h-12 rounded-xl bg-background px-3 text-base outline-none focus:ring-2 focus:ring-accent";

function subscribe() {
  return () => {};
}

function friendlyError(message: string): string {
  if (/relation|schema cache|does not exist|permission denied/i.test(message)) {
    return "Goals are not set up yet. In Supabase, open the SQL Editor, paste supabase/migrations/0005_goals.sql, and run it.";
  }
  if (/jwt|not authenticated|invalid claim/i.test(message)) return "Your session expired. Sign in again.";
  return message;
}

async function loadGoals(metrics: GoalMetric[], today: string): Promise<{
  goals: Goal[];
  counts: Record<GoalMetric, PeriodCounts>;
}> {
  const month = monthBounds(today);
  const week = weekBounds(today);
  const rangeStart = week.start < month.start ? week.start : month.start;
  const supabase = createClient();
  const [goalsResult, tasksResult, workoutsResult, stepsResult, sessionsResult] = await Promise.all([
    supabase.from("goals").select("user_id, metric, weekly_target, monthly_target").in("metric", metrics),
    metrics.includes("tasks")
      ? supabase
          .from("tasks")
          .select("task_date, done")
          .eq("done", true)
          .gte("task_date", rangeStart)
          .lt("task_date", month.end)
      : Promise.resolve({ data: [], error: null }),
    metrics.includes("workout_minutes") || metrics.includes("workouts")
      ? supabase
          .from("workouts")
          .select("started_at, duration_min")
          .gte("started_at", new Date(`${rangeStart}T00:00:00`).toISOString())
          .lt("started_at", new Date(`${month.end}T00:00:00`).toISOString())
      : Promise.resolve({ data: [], error: null }),
    metrics.includes("steps")
      ? supabase.from("daily_steps").select("day, steps").gte("day", rangeStart).lt("day", month.end)
      : Promise.resolve({ data: [], error: null }),
    metrics.includes("pages")
      ? supabase.from("reading_sessions").select("day, pages_read").gte("day", rangeStart).lt("day", month.end)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const error =
    goalsResult.error ??
    tasksResult.error ??
    workoutsResult.error ??
    stepsResult.error ??
    sessionsResult.error;
  if (error) throw error;

  const empty = (): PeriodCounts => ({ today: 0, week: 0, month: 0 });
  const counts = Object.fromEntries(metrics.map((metric) => [metric, empty()])) as Record<GoalMetric, PeriodCounts>;

  function add(metric: GoalMetric, day: string, amount: number) {
    const bucket = counts[metric];
    if (!bucket || amount <= 0) return;
    if (day === today) bucket.today += amount;
    if (inDayRange(day, week.start, week.end)) bucket.week += amount;
    if (inDayRange(day, month.start, month.end)) bucket.month += amount;
  }

  for (const row of (tasksResult.data ?? []) as { task_date: string; done: boolean }[]) {
    if (row.done) add("tasks", row.task_date, 1);
  }
  for (const row of (workoutsResult.data ?? []) as { started_at: string; duration_min: number | string }[]) {
    const day = toDayKey(new Date(row.started_at));
    add("workouts", day, 1);
    add("workout_minutes", day, Number(row.duration_min) || 0);
  }
  for (const row of (stepsResult.data ?? []) as { day: string; steps: number }[]) {
    add("steps", row.day, Number(row.steps) || 0);
  }
  for (const row of (sessionsResult.data ?? []) as { day: string; pages_read: number | string }[]) {
    add("pages", row.day, Number(row.pages_read) || 0);
  }

  return {
    goals: ((goalsResult.data ?? []) as Goal[]).map((goal) => ({
      ...goal,
      weekly_target: goal.weekly_target == null ? null : Number(goal.weekly_target),
      monthly_target: goal.monthly_target == null ? null : Number(goal.monthly_target),
    })),
    counts,
  };
}

export default function GoalBoard({ metrics }: { metrics: GoalMetric[] }) {
  const todayKey = useSyncExternalStore(subscribe, toDayKey, () => "");
  const [goals, setGoals] = useState<Goal[]>([]);
  const [counts, setCounts] = useState<Record<GoalMetric, PeriodCounts> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  const metricKey = metrics.join(",");

  useEffect(() => {
    if (!todayKey) return;
    const selected = metricKey.split(",") as GoalMetric[];
    let cancelled = false;
    async function run() {
      try {
        const loaded = await loadGoals(selected, todayKey);
        if (cancelled) return;
        setGoals(loaded.goals);
        setCounts(loaded.counts);
        setError(null);
      } catch (loadError) {
        if (cancelled) return;
        const message =
          loadError && typeof loadError === "object" && "message" in loadError
            ? String(loadError.message)
            : "Could not load goals.";
        setError(friendlyError(message));
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [todayKey, metricKey]);

  async function save(drafts: Record<GoalMetric, { weekly: string; monthly: string }>) {
    setSaving(true);
    setError(null);
    try {
      const supabase = createClient();
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError || !userData.user) throw new Error("Your session expired. Sign in again.");
      for (const metric of metrics) {
        const weekly = parseTarget(drafts[metric].weekly);
        const monthly = parseTarget(drafts[metric].monthly);
        if (weekly == null && monthly == null) {
          const { error: deleteError } = await supabase.from("goals").delete().eq("metric", metric);
          if (deleteError) throw deleteError;
          continue;
        }
        const { error: upsertError } = await supabase.from("goals").upsert(
          {
            user_id: userData.user.id,
            metric,
            weekly_target: weekly,
            monthly_target: monthly,
          },
          { onConflict: "user_id,metric" },
        );
        if (upsertError) throw upsertError;
      }
      if (todayKey) {
        const loaded = await loadGoals(metrics, todayKey);
        setGoals(loaded.goals);
        setCounts(loaded.counts);
      }
      setEditing(false);
    } catch (saveError) {
      const message =
        saveError && typeof saveError === "object" && "message" in saveError
          ? String(saveError.message)
          : "Could not save goals.";
      setError(friendlyError(message));
    } finally {
      setSaving(false);
    }
  }

  if (!todayKey) return null;
  const month = monthBounds(todayKey);
  const week = weekBounds(todayKey);

  return (
    <section className="mb-5 rounded-2xl border border-black/10 bg-card p-4 dark:border-white/10">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Goals</h2>
          <p className="mt-1 text-sm text-muted">Today, this week, and this month.</p>
        </div>
        <button
          type="button"
          onClick={() => setEditing((open) => !open)}
          className="min-h-11 shrink-0 text-sm font-medium text-accent"
        >
          {editing ? "Close" : "Set goals"}
        </button>
      </div>

      {error ? <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p> : null}

      {editing ? (
        <GoalEditor metrics={metrics} goals={goals} saving={saving} onSave={save} />
      ) : counts ? (
        <div className="mt-4 space-y-4">
          {metrics.map((metric) => {
            const goal = goals.find((item) => item.metric === metric);
            const count = counts[metric];
            return (
              <MetricCard
                key={metric}
                metric={metric}
                weeklyTarget={goal?.weekly_target ?? null}
                monthlyTarget={goal?.monthly_target ?? null}
                count={count}
                weekDay={week.day}
                monthDay={month.day}
                monthDays={month.days}
              />
            );
          })}
        </div>
      ) : (
        <div className="mt-4 h-20 animate-pulse rounded-xl bg-background" />
      )}
    </section>
  );
}

function parseTarget(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const number = Number(trimmed);
  if (!Number.isInteger(number) || number < 0) {
    throw new Error("Goals must be whole numbers, or left blank.");
  }
  return number;
}

function GoalEditor({
  metrics,
  goals,
  saving,
  onSave,
}: {
  metrics: GoalMetric[];
  goals: Goal[];
  saving: boolean;
  onSave: (drafts: Record<GoalMetric, { weekly: string; monthly: string }>) => Promise<void>;
}) {
  const [drafts, setDrafts] = useState(() => {
    const initial = {} as Record<GoalMetric, { weekly: string; monthly: string }>;
    for (const metric of metrics) {
      const goal = goals.find((item) => item.metric === metric);
      initial[metric] = {
        weekly: goal?.weekly_target == null ? "" : String(goal.weekly_target),
        monthly: goal?.monthly_target == null ? "" : String(goal.monthly_target),
      };
    }
    return initial;
  });
  const [formError, setFormError] = useState<string | null>(null);

  return (
    <form
      className="mt-4 space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        setFormError(null);
        void onSave(drafts).catch((reason: Error) => setFormError(reason.message));
      }}
    >
      {metrics.map((metric) => (
        <fieldset key={metric} className="space-y-2">
          <legend className="text-sm font-medium">{metricLabel(metric)}</legend>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-muted">
              Per week
              <input
                inputMode="numeric"
                className={`mt-1 ${field}`}
                value={drafts[metric].weekly}
                onChange={(event) =>
                  setDrafts((current) => ({
                    ...current,
                    [metric]: { ...current[metric], weekly: event.target.value },
                  }))
                }
              />
            </label>
            <label className="text-xs text-muted">
              Per month
              <input
                inputMode="numeric"
                className={`mt-1 ${field}`}
                value={drafts[metric].monthly}
                onChange={(event) =>
                  setDrafts((current) => ({
                    ...current,
                    [metric]: { ...current[metric], monthly: event.target.value },
                  }))
                }
              />
            </label>
          </div>
        </fieldset>
      ))}
      {formError ? <p className="text-sm text-red-600 dark:text-red-400">{formError}</p> : null}
      <button
        type="submit"
        disabled={saving}
        className="min-h-12 w-full rounded-xl bg-accent text-base font-semibold text-white disabled:opacity-60 dark:text-neutral-950"
      >
        {saving ? "Saving…" : "Save goals"}
      </button>
    </form>
  );
}

function MetricCard({
  metric,
  weeklyTarget,
  monthlyTarget,
  count,
  weekDay,
  monthDay,
  monthDays,
}: {
  metric: GoalMetric;
  weeklyTarget: number | null;
  monthlyTarget: number | null;
  count: PeriodCounts;
  weekDay: number;
  monthDay: number;
  monthDays: number;
}) {
  const weekShare = dailyShare(weeklyTarget, 7);
  const monthShare = dailyShare(monthlyTarget, monthDays);
  const hasGoal = weeklyTarget != null || monthlyTarget != null;

  return (
    <article className="rounded-xl bg-background p-3">
      <h3 className="font-semibold">{metricLabel(metric)}</h3>
      {hasGoal ? (
        <p className="mt-1 text-sm text-muted">
          {shareSentence(metric, weekShare, monthShare)}
        </p>
      ) : (
        <p className="mt-1 text-sm text-muted">Set a weekly and a monthly number.</p>
      )}
      <div className="mt-3 grid grid-cols-3 gap-2">
        <Column
          label="Today"
          value={formatAmount(metric, count.today)}
          detail={todayDetail(metric, count.today, weekShare, monthShare)}
          percent={null}
        />
        <Column
          label="This week"
          value={targetText(metric, count.week, weeklyTarget)}
          detail={paceLabel(metric, count.week, weeklyTarget, weekDay, 7)}
          percent={percent(count.week, weeklyTarget)}
        />
        <Column
          label="This month"
          value={targetText(metric, count.month, monthlyTarget)}
          detail={paceLabel(metric, count.month, monthlyTarget, monthDay, monthDays)}
          percent={percent(count.month, monthlyTarget)}
        />
      </div>
    </article>
  );
}

function shareSentence(metric: GoalMetric, weekShare: number | null, monthShare: number | null): string {
  const parts = [
    weekShare == null ? null : `${formatAmount(metric, weekShare)} a day toward the week`,
    monthShare == null ? null : `${formatAmount(metric, monthShare)} a day toward the month`,
  ].filter(Boolean);
  return parts.join(" · ");
}

function todayDetail(
  metric: GoalMetric,
  actual: number,
  weekShare: number | null,
  monthShare: number | null,
): string {
  const share = weekShare ?? monthShare;
  if (share == null) return "No daily share yet";
  if (actual + 0.05 >= share) return "Daily share met";
  return `${formatAmount(metric, share - actual)} left for today`;
}

function targetText(metric: GoalMetric, actual: number, target: number | null): string {
  if (target == null) return formatAmount(metric, actual);
  return `${formatAmount(metric, actual)} / ${formatAmount(metric, target)}`;
}

function percent(actual: number, target: number | null): number | null {
  if (target == null || target <= 0) return null;
  return Math.min(100, Math.round((actual / target) * 100));
}

function Column({
  label,
  value,
  detail,
  percent: width,
}: {
  label: string;
  value: string;
  detail: string;
  percent: number | null;
}) {
  return (
    <div>
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 text-sm font-semibold leading-snug">{value}</p>
      <p className="mt-1 text-xs text-muted">{detail}</p>
      {width == null ? null : (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-card">
          <div className="h-full bg-accent" style={{ width: `${width}%` }} />
        </div>
      )}
    </div>
  );
}
