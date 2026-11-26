import type { Workout, WorkoutType } from "@/types";
import { addDays, startOfWeek, toDayKey } from "@/lib/dates";

export type DistanceUnit = "km" | "mi";

const KM_PER_MILE = 1.609344;

export const WORKOUT_TYPES: { value: WorkoutType; label: string }[] = [
  { value: "run", label: "Run" },
  { value: "walk", label: "Walk" },
  { value: "ride", label: "Ride" },
  { value: "strength", label: "Strength" },
  { value: "yoga", label: "Yoga" },
  { value: "other", label: "Other" },
];

export function workoutTypeLabel(type: WorkoutType): string {
  return WORKOUT_TYPES.find((item) => item.value === type)?.label ?? "Other";
}

export function toKm(value: number, unit: DistanceUnit): number {
  return unit === "mi" ? value * KM_PER_MILE : value;
}

export function fromKm(km: number, unit: DistanceUnit): number {
  return unit === "mi" ? km / KM_PER_MILE : km;
}

export function formatDistance(km: number, unit: DistanceUnit): string {
  const value = fromKm(km, unit);
  const text = new Intl.NumberFormat(undefined, {
    maximumFractionDigits: value >= 10 ? 1 : 2,
  }).format(value);
  return `${text} ${unit}`;
}

export function formatMinutes(minutes: number): string {
  const total = Math.round(minutes);
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  if (hours === 0) return `${mins} min`;
  if (mins === 0) return `${hours} h`;
  return `${hours} h ${mins} min`;
}

export function formatClock(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

export interface WeekTotals {
  minutes: number;
  distanceKm: number;
  count: number;
  calories: number;
}

export function totalsBetween(workouts: Workout[], start: Date, end: Date): WeekTotals {
  const startMs = start.getTime();
  const endMs = end.getTime();
  const inRange = workouts.filter((workout) => {
    const time = new Date(workout.started_at).getTime();
    return time >= startMs && time < endMs;
  });
  return {
    minutes: inRange.reduce((sum, workout) => sum + workout.duration_min, 0),
    distanceKm: inRange.reduce((sum, workout) => sum + (workout.distance_km ?? 0), 0),
    count: inRange.length,
    calories: inRange.reduce((sum, workout) => sum + (workout.calories ?? 0), 0),
  };
}

/** Days in a row with at least one workout. Today still counts as open until it ends. */
export function activeDayStreak(workouts: Workout[], today = new Date()): number {
  const days = new Set(workouts.map((workout) => toDayKey(new Date(workout.started_at))));
  let cursor = new Date(today);
  cursor.setHours(0, 0, 0, 0);
  if (!days.has(toDayKey(cursor))) cursor = addDays(cursor, -1);

  let streak = 0;
  while (days.has(toDayKey(cursor))) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

export interface ChartDay {
  key: string;
  minutes: number;
  label: string;
}

export interface ChartWeek {
  key: string;
  label: string;
  days: ChartDay[];
}

/** Current week plus the three before it, Monday through Sunday. */
export function lastFourWeeks(workouts: Workout[], today = new Date()): ChartWeek[] {
  const thisMonday = startOfWeek(today);
  const minutes = new Map<string, number>();
  for (const workout of workouts) {
    const key = toDayKey(new Date(workout.started_at));
    minutes.set(key, (minutes.get(key) ?? 0) + workout.duration_min);
  }

  return Array.from({ length: 4 }, (_, weekIndex) => {
    const monday = addDays(thisMonday, (weekIndex - 3) * 7);
    const days = Array.from({ length: 7 }, (_, dayIndex) => {
      const date = addDays(monday, dayIndex);
      const key = toDayKey(date);
      return {
        key,
        minutes: minutes.get(key) ?? 0,
        label: date.toLocaleDateString(undefined, {
          weekday: "short",
          month: "short",
          day: "numeric",
        }),
      };
    });
    return {
      key: toDayKey(monday),
      label: monday.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
      days,
    };
  });
}

export function sortNewest(workouts: Workout[]): Workout[] {
  return [...workouts].sort(
    (a, b) => b.started_at.localeCompare(a.started_at) || b.created_at.localeCompare(a.created_at),
  );
}

export function normalizeWorkout(row: Workout): Workout {
  return {
    ...row,
    duration_min: Number(row.duration_min),
    distance_km: row.distance_km == null ? null : Number(row.distance_km),
    calories: row.calories == null ? null : Number(row.calories),
    avg_heart_rate: row.avg_heart_rate == null ? null : Number(row.avg_heart_rate),
  };
}
