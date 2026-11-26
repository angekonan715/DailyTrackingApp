"use client";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { Workout, WorkoutType } from "@/types";
import PageHeader from "@/components/PageHeader";
import EmptyState from "@/components/EmptyState";
import SetupNotice from "@/components/SetupNotice";
import WorkoutForm, { type WorkoutDraft } from "@/components/workouts/WorkoutForm";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { addDays, relativeDayLabel, startOfWeek, toDayKey } from "@/lib/dates";
import {
  activeDayStreak,
  formatClock,
  formatDistance,
  formatMinutes,
  lastFourWeeks,
  normalizeWorkout,
  sortNewest,
  totalsBetween,
  workoutTypeLabel,
  WORKOUT_TYPES,
  type DistanceUnit,
} from "@/lib/workouts";

const UNIT_KEY = "daily-hub-distance-unit";
const UNIT_EVENT = "daily-hub-unit";

function subscribeToday() {
  return () => {};
}

function subscribeUnit(onChange: () => void) {
  window.addEventListener(UNIT_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(UNIT_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function readUnit(): DistanceUnit {
  return localStorage.getItem(UNIT_KEY) === "mi" ? "mi" : "km";
}

function writeUnit(unit: DistanceUnit) {
  localStorage.setItem(UNIT_KEY, unit);
  window.dispatchEvent(new Event(UNIT_EVENT));
}

function friendlyError(error: { message: string; code?: string }): string {
  if (error.code === "23505" || /duplicate/i.test(error.message)) {
    return "You already logged this workout type at that start time.";
  }
  if (/relation|schema cache|does not exist/i.test(error.message)) {
    return "The workouts table is missing. In Supabase, open the SQL Editor and run supabase/migrations/0001_init.sql.";
  }
  if (/jwt|not authenticated|invalid claim/i.test(error.message)) {
    return "Your session expired. Sign in again.";
  }
  return error.message;
}

const WORKOUT_COLUMNS =
  "id, user_id, started_at, type, duration_min, distance_km, calories, avg_heart_rate, notes, source, created_at";

async function fetchWorkoutRows(): Promise<Workout[]> {
  const { data, error } = await createClient()
    .from("workouts")
    .select(WORKOUT_COLUMNS)
    .order("started_at", { ascending: false })
    .limit(2000);
  if (error) throw error;
  return sortNewest(((data ?? []) as Workout[]).map(normalizeWorkout));
}

function errorText(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    const known = error as { message: string; code?: string };
    return friendlyError(known);
  }
  return "Could not load workouts.";
}

export default function WorkoutsBoard() {
  if (!isSupabaseConfigured()) {
    return (
      <>
        <PageHeader title="Workouts" />
        <SetupNotice />
      </>
    );
  }
  return <WorkoutScreen />;
}

function WorkoutScreen() {
  const todayKey = useSyncExternalStore(subscribeToday, toDayKey, () => "");
  const unit = useSyncExternalStore(subscribeUnit, readUnit, () => "km" as DistanceUnit);
  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<WorkoutType | "all">("all");
  const [formMode, setFormMode] = useState<"new" | Workout | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      try {
        const rows = await fetchWorkoutRows();
        if (cancelled) return;
        setWorkouts(rows);
        setError(null);
      } catch (loadError) {
        if (cancelled) return;
        setWorkouts([]);
        setError(errorText(loadError));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  async function refresh() {
    try {
      setWorkouts(await fetchWorkoutRows());
      setError(null);
    } catch (loadError) {
      setError(errorText(loadError));
    }
  }

  async function saveWorkout(draft: WorkoutDraft, existing?: Workout) {
    const supabase = createClient();
    const payload = {
      started_at: draft.startedAt,
      type: draft.type,
      duration_min: draft.durationMin,
      distance_km: draft.distanceKm,
      calories: draft.calories,
      avg_heart_rate: draft.avgHeartRate,
      notes: draft.notes,
    };
    const query = existing
      ? supabase.from("workouts").update(payload).eq("id", existing.id)
      : supabase.from("workouts").insert({ ...payload, source: "manual" });
    const { error: saveError } = await query;
    if (saveError) throw new Error(friendlyError(saveError));
    setFormMode(null);
    await refresh();
  }

  async function removeWorkout(workout: Workout) {
    setWorkouts((current) => current.filter((item) => item.id !== workout.id));
    setConfirmingId(null);
    const { error: deleteError } = await createClient().from("workouts").delete().eq("id", workout.id);
    if (deleteError) {
      setError(friendlyError(deleteError));
      await refresh();
    }
  }

  const today = todayKey ? new Date() : null;
  const thisWeekStart = today ? startOfWeek(today) : null;
  const lastWeekStart = thisWeekStart ? addDays(thisWeekStart, -7) : null;
  const thisWeek = thisWeekStart && today ? totalsBetween(workouts, thisWeekStart, addDays(thisWeekStart, 7)) : null;
  const lastWeek =
    lastWeekStart && thisWeekStart ? totalsBetween(workouts, lastWeekStart, thisWeekStart) : null;
  const streak = today ? activeDayStreak(workouts, today) : 0;
  const weeks = today ? lastFourWeeks(workouts, today) : [];
  const visible = filter === "all" ? workouts : workouts.filter((workout) => workout.type === filter);

  return (
    <>
      <PageHeader
        title="Workouts"
        action={
          <Link href="/workouts/import" className="flex min-h-11 items-center text-sm font-medium text-accent">
            Import Samsung
          </Link>
        }
      />

      {formMode ? (
        <WorkoutForm
          key={formMode === "new" ? "new" : formMode.id}
          workout={formMode === "new" ? null : formMode}
          unit={unit}
          onUnitChange={writeUnit}
          onCancel={() => setFormMode(null)}
          onSubmit={(draft) => saveWorkout(draft, formMode === "new" ? undefined : formMode)}
        />
      ) : (
        <button
          type="button"
          onClick={() => {
            setConfirmingId(null);
            setFormMode("new");
          }}
          className="mb-5 min-h-12 w-full rounded-xl bg-accent text-base font-semibold text-white dark:text-neutral-950"
        >
          Log a workout
        </button>
      )}

      {error ? (
        <div role="alert" className="mb-4 rounded-2xl bg-card px-4 py-3 text-sm">
          <p className="text-red-600 dark:text-red-400">{error}</p>
          <button type="button" onClick={() => void refresh()} className="mt-2 min-h-11 font-medium text-accent">
            Try again
          </button>
        </div>
      ) : null}

      <WeekSummary
        loading={loading || !thisWeek || !lastWeek}
        unit={unit}
        onUnitChange={formMode ? undefined : writeUnit}
        thisWeek={thisWeek}
        lastWeek={lastWeek}
        streak={streak}
        weeks={weeks}
        todayKey={todayKey}
      />

      <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
        <FilterChip label="All" selected={filter === "all"} onClick={() => setFilter("all")} />
        {WORKOUT_TYPES.map((option) => (
          <FilterChip
            key={option.value}
            label={option.label}
            selected={filter === option.value}
            onClick={() => setFilter(option.value)}
          />
        ))}
      </div>

      {loading ? (
        <div className="space-y-2" aria-live="polite">
          <p className="sr-only">Loading workouts</p>
          <div className="h-20 animate-pulse rounded-2xl bg-card" />
          <div className="h-20 animate-pulse rounded-2xl bg-card" />
        </div>
      ) : visible.length === 0 ? (
        <EmptyState
          title={workouts.length === 0 ? "No workouts yet" : `No ${filter === "all" ? "" : workoutTypeLabel(filter).toLowerCase() + " "}workouts yet`}
          hint={
            workouts.length === 0
              ? "Log a run, walk, ride, or anything else you did today."
              : "Try another type, or log one with the button above."
          }
        />
      ) : (
        <ul className="space-y-2">
          {visible.map((workout) => (
            <li key={workout.id} className="rounded-2xl bg-card px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold">{workoutTypeLabel(workout.type)}</p>
                  <p className="mt-0.5 text-sm text-muted">
                    {relativeDayLabel(toDayKey(new Date(workout.started_at)), todayKey || toDayKey())}
                    {" · "}
                    {formatClock(workout.started_at)}
                  </p>
                </div>
                <p className="shrink-0 font-semibold tabular-nums">{formatMinutes(workout.duration_min)}</p>
              </div>
              <WorkoutMeta workout={workout} unit={unit} />
              {workout.notes ? <p className="mt-2 text-sm break-words">{workout.notes}</p> : null}
              {workout.source === "samsung" ? (
                <p className="mt-2 text-xs font-medium text-muted">Samsung Health</p>
              ) : null}
              {confirmingId === workout.id ? (
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() => void removeWorkout(workout)}
                    className="min-h-11 rounded-xl bg-red-600 px-3 text-sm font-semibold text-white"
                  >
                    Delete
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmingId(null)}
                    className="min-h-11 rounded-xl bg-background px-3 text-sm font-medium"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <div className="mt-1 flex gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      setConfirmingId(null);
                      setFormMode(workout);
                    }}
                    className="min-h-11 px-2 text-sm font-medium text-accent"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmingId(workout.id)}
                    className="min-h-11 px-2 text-sm font-medium text-red-600 dark:text-red-400"
                  >
                    Delete
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function WorkoutMeta({ workout, unit }: { workout: Workout; unit: DistanceUnit }) {
  const parts = [
    workout.distance_km != null ? formatDistance(workout.distance_km, unit) : null,
    workout.calories != null ? `${Math.round(workout.calories)} kcal` : null,
    workout.avg_heart_rate != null ? `${Math.round(workout.avg_heart_rate)} bpm` : null,
  ].filter((part): part is string => Boolean(part));
  if (parts.length === 0) return null;
  return <p className="mt-2 text-sm text-muted">{parts.join(" · ")}</p>;
}

function FilterChip({
  label,
  selected,
  onClick,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={`min-h-11 shrink-0 rounded-full px-4 text-sm font-medium ${
        selected ? "bg-accent text-white dark:text-neutral-950" : "bg-card"
      }`}
    >
      {label}
    </button>
  );
}

function WeekSummary({
  loading,
  unit,
  onUnitChange,
  thisWeek,
  lastWeek,
  streak,
  weeks,
  todayKey,
}: {
  loading: boolean;
  unit: DistanceUnit;
  onUnitChange?: (unit: DistanceUnit) => void;
  thisWeek: ReturnType<typeof totalsBetween> | null;
  lastWeek: ReturnType<typeof totalsBetween> | null;
  streak: number;
  weeks: ReturnType<typeof lastFourWeeks>;
  todayKey: string;
}) {
  const maxMinutes = Math.max(1, ...weeks.flatMap((week) => week.days.map((day) => day.minutes)));

  return (
    <section className="mb-5 rounded-2xl bg-card p-4">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium">This week vs last week</h2>
        {onUnitChange ? (
          <div className="grid grid-cols-2 rounded-lg bg-background p-0.5 text-xs font-medium">
            {(["km", "mi"] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={unit === option}
                onClick={() => onUnitChange(option)}
                className={`min-h-8 rounded-md px-2 ${
                  unit === option ? "bg-accent text-white dark:text-neutral-950" : "text-muted"
                }`}
              >
                {option}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <div className="mb-1 grid grid-cols-3 gap-2 text-xs font-medium text-muted">
        <span />
        <span className="text-right">This</span>
        <span className="text-right">Last</span>
      </div>
      {loading || !thisWeek || !lastWeek ? (
        <div className="h-28 animate-pulse rounded-xl bg-background" />
      ) : (
        <div className="divide-y divide-black/5 dark:divide-white/10">
          <CompareRow label="Time" current={formatMinutes(thisWeek.minutes)} previous={formatMinutes(lastWeek.minutes)} />
          <CompareRow
            label="Distance"
            current={formatDistance(thisWeek.distanceKm, unit)}
            previous={formatDistance(lastWeek.distanceKm, unit)}
          />
          <CompareRow label="Workouts" current={String(thisWeek.count)} previous={String(lastWeek.count)} />
          <CompareRow
            label="Calories"
            current={Math.round(thisWeek.calories).toLocaleString()}
            previous={Math.round(lastWeek.calories).toLocaleString()}
          />
        </div>
      )}

      <p className="mt-4 text-sm">
        {streak === 0 ? (
          <span className="text-muted">No active streak yet.</span>
        ) : (
          <>
            <span className="font-semibold">{streak}</span>{" "}
            <span className="text-muted">{streak === 1 ? "active day in a row" : "active days in a row"}</span>
          </>
        )}
      </p>

      <h2 className="mt-4 mb-2 text-sm font-medium">Minutes per day, last 4 weeks</h2>
      {weeks.length === 0 ? (
        <div className="h-24 animate-pulse rounded-xl bg-background" />
      ) : (
        <div className="grid grid-cols-4 gap-2">
          {weeks.map((week) => (
            <div key={week.key}>
              <div className="flex h-24 items-end gap-0.5">
                {week.days.map((day) => {
                  const height = day.minutes === 0 ? 8 : Math.max(12, Math.round((day.minutes / maxMinutes) * 100));
                  const isToday = day.key === todayKey;
                  return (
                    <div
                      key={day.key}
                      role="img"
                      title={`${day.label}: ${formatMinutes(day.minutes)}`}
                      aria-label={`${day.label}, ${formatMinutes(day.minutes)}`}
                      className={`flex-1 rounded-sm ${
                        day.minutes === 0 ? "bg-foreground/15" : isToday ? "bg-accent" : "bg-accent/70"
                      }`}
                      style={{ height: `${height}%` }}
                    />
                  );
                })}
              </div>
              <p className="mt-1 text-center text-[11px] text-muted">{week.label}</p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function CompareRow({
  label,
  current,
  previous,
}: {
  label: string;
  current: string;
  previous: string;
}) {
  return (
    <div className="grid grid-cols-3 items-baseline gap-2 py-2">
      <span className="text-sm">{label}</span>
      <span className="text-right text-sm font-semibold tabular-nums">{current}</span>
      <span className="text-right text-sm text-muted tabular-nums">{previous}</span>
    </div>
  );
}
