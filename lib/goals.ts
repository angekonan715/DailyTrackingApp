import type { GoalMetric } from "@/types";
import { formatMinutes } from "@/lib/workouts";
import { parseDayKey, startOfWeek, toDayKey, addDays } from "@/lib/dates";

export const GOAL_METRICS: { id: GoalMetric; label: string; noun: string }[] = [
  { id: "tasks", label: "Tasks completed", noun: "tasks" },
  { id: "workout_minutes", label: "Workout time", noun: "minutes" },
  { id: "workouts", label: "Workouts", noun: "workouts" },
  { id: "books", label: "Books finished", noun: "books" },
  { id: "steps", label: "Steps", noun: "steps" },
];

export const ALL_GOAL_METRICS: GoalMetric[] = GOAL_METRICS.map((item) => item.id);

export function metricLabel(metric: GoalMetric): string {
  return GOAL_METRICS.find((item) => item.id === metric)?.label ?? metric;
}

export interface PeriodCounts {
  today: number;
  week: number;
  month: number;
  year: number;
  weekDays: number[];
}

export function monthBounds(todayKey: string): { start: string; end: string; days: number; day: number } {
  const date = parseDayKey(todayKey);
  const days = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  const start = `${todayKey.slice(0, 7)}-01`;
  const endDate = new Date(date.getFullYear(), date.getMonth() + 1, 1);
  return { start, end: toDayKey(endDate), days, day: date.getDate() };
}

export function yearBounds(todayKey: string): { start: string; end: string; day: number; days: number } {
  const year = parseDayKey(todayKey).getFullYear();
  const start = `${year}-01-01`;
  const end = `${year + 1}-01-01`;
  const startDate = parseDayKey(start);
  const today = parseDayKey(todayKey);
  const day = Math.round((today.getTime() - startDate.getTime()) / 86400000) + 1;
  const days = Math.round((parseDayKey(end).getTime() - startDate.getTime()) / 86400000);
  return { start, end, day, days };
}

/** A yearly book goal, split across the weeks and months of the year. */
export function bookTargets(yearly: number | null): { week: number | null; month: number | null } {
  if (yearly == null || yearly <= 0) return { week: null, month: null };
  return { week: yearly / 52, month: yearly / 12 };
}

export function bookGoalSentence(yearly: number): string {
  const month = yearly / 12;
  const monthText =
    Math.abs(month - Math.round(month)) < 0.05
      ? `${Math.round(month)} a month`
      : `about ${formatAmount("books", month)} a month`;
  const weeks = 52 / yearly;
  const weekText =
    weeks >= 1.5
      ? `about 1 every ${Math.round(weeks)} weeks`
      : weeks >= 0.95
        ? "about 1 a week"
        : `${formatAmount("books", yearly / 52)} a week`;
  return `${yearly} ${yearly === 1 ? "book" : "books"} this year · ${monthText} · ${weekText}`;
}

export function weekBounds(todayKey: string): { start: string; end: string; day: number } {
  const startDate = startOfWeek(parseDayKey(todayKey));
  const day = ((parseDayKey(todayKey).getDay() + 6) % 7) + 1;
  return { start: toDayKey(startDate), end: toDayKey(addDays(startDate, 7)), day };
}

/** What one day is worth inside a weekly or monthly target. */
export function dailyShare(target: number | null, days: number): number | null {
  if (target == null || target <= 0 || days <= 0) return null;
  return target / days;
}

export function formatAmount(metric: GoalMetric, value: number): string {
  if (metric === "workout_minutes") return formatMinutes(value);
  if (metric === "books") {
    const rounded = Math.round(value * 10) / 10;
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  }
  const rounded = metric === "steps" ? Math.round(value) : Math.round(value * 10) / 10;
  const text = Number.isInteger(rounded) ? rounded.toLocaleString() : rounded.toFixed(1);
  return text;
}

export function paceLabel(
  metric: GoalMetric,
  actual: number,
  target: number | null,
  elapsed: number,
  total: number,
): string {
  if (target == null || target <= 0) return "No goal";
  const expected = (target * elapsed) / total;
  if (actual + 0.05 >= expected) return "On pace";
  return `${formatAmount(metric, Math.max(expected - actual, 0))} behind pace`;
}

export function inDayRange(day: string, start: string, end: string): boolean {
  return day >= start && day < end;
}
