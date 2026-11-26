import { addDays, dayStreak, parseDayKey, startOfWeek, toDayKey } from "@/lib/dates";

/** gpt-4o-mini list prices, rounded up so the cap is conservative. */
const INPUT_USD_PER_MILLION = 0.2;
const OUTPUT_USD_PER_MILLION = 0.8;

export const COACH_MODEL = "gpt-4o-mini";
export const MONTHLY_CAP_CENTS = 500;
const FALLBACK_CENTS = 1;

export function isDayKey(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = parseDayKey(value);
  return toDayKey(date) === value;
}

export function weekStartKey(today: string): string {
  return toDayKey(startOfWeek(parseDayKey(today)));
}

export function monthKey(today: string): string {
  return today.slice(0, 7);
}

export function nextWeekKey(weekStart: string): string {
  return toDayKey(addDays(parseDayKey(weekStart), 7));
}

/** Estimated cents for one coach call. Missing token counts bill a flat 1 cent. */
export function estimateCents(inputTokens: number | null, outputTokens: number | null): number {
  if (inputTokens == null || outputTokens == null) return FALLBACK_CENTS;
  const dollars =
    (inputTokens / 1_000_000) * INPUT_USD_PER_MILLION +
    (outputTokens / 1_000_000) * OUTPUT_USD_PER_MILLION;
  return Math.max(0.0001, Math.round(dollars * 100 * 10_000) / 10_000);
}

export interface CoachInsight {
  summary: string;
  recommendations: string[];
  tips: string[];
}

function cleanLines(value: unknown, limit: number, max: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, limit)
    .map((item) => item.slice(0, max));
}

export function parseTips(content: string): string[] | null {
  return parseCoach(content)?.tips ?? null;
}

/** Accepts a legacy tip list or the fuller coach object. */
export function parseCoach(content: string): CoachInsight | null {
  const trimmed = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch {
    return null;
  }
  return readStoredInsight(value);
}

export function readStoredInsight(value: unknown): CoachInsight | null {
  if (Array.isArray(value)) {
    const tips = cleanLines(value, 3, 180);
    return tips.length === 3 ? { summary: "", recommendations: [], tips } : null;
  }
  if (!value || typeof value !== "object") return null;
  const record = value as { summary?: unknown; recommendations?: unknown; tips?: unknown };
  const tips = cleanLines(record.tips, 3, 180);
  if (tips.length !== 3) return null;
  const summary = typeof record.summary === "string" ? record.summary.trim().slice(0, 400) : "";
  return {
    summary,
    recommendations: cleanLines(record.recommendations, 3, 200),
    tips,
  };
}

export function insightIsComplete(insight: CoachInsight): boolean {
  return insight.summary.length > 0 && insight.recommendations.length === 3 && insight.tips.length === 3;
}

export function parseQuote(content: string): { quote: string; author: string } | null {
  const trimmed = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const quote = "quote" in value && typeof value.quote === "string" ? value.quote.trim().slice(0, 180) : "";
  if (quote.length < 8) return null;
  const author =
    "author" in value && typeof value.author === "string" && value.author.trim()
      ? value.author.trim().slice(0, 40)
      : "Daily Hub";
  return { quote, author };
}

export interface WeekBriefInput {
  today: string;
  tasksDone: number;
  tasksTotal: number;
  workoutCount: number;
  workoutMinutes: number;
  distanceKm: number;
  steps: number | null;
  pagesRead: number;
  readingDays: number;
  todoStreak: number;
  activeStreak: number;
  readingStreak: number;
  books: { title: string; pagesLeft: number }[];
  hobbies: string[];
}

export function buildWeekBrief(input: WeekBriefInput): string {
  const bookLine =
    input.books.length === 0
      ? "No books in progress."
      : input.books
          .slice(0, 6)
          .map((book) => `${book.title} (${book.pagesLeft} pages left)`)
          .join("; ");
  const steps =
    input.steps == null ? "no step data this week" : `${input.steps} steps this week`;
  return [
    `Week containing ${input.today}.`,
    `To-dos: ${input.tasksDone} of ${input.tasksTotal} done. To-do streak: ${input.todoStreak} days.`,
    `Workouts: ${input.workoutCount}, ${Math.round(input.workoutMinutes)} minutes, ${input.distanceKm.toFixed(1)} km. Active streak: ${input.activeStreak} days.`,
    `Steps: ${steps}.`,
    `Reading: ${input.pagesRead} pages on ${input.readingDays} days. Reading streak: ${input.readingStreak} days.`,
    `Books in progress: ${bookLine}`,
    input.hobbies.length > 0 ? `Hobbies: ${input.hobbies.slice(0, 12).join(", ")}.` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function streakEnding(days: Iterable<string>, today: string): number {
  return dayStreak(days, parseDayKey(today));
}

export function isTimeZone(value: string): boolean {
  if (!value || value.length > 80) return false;
  try {
    Intl.DateTimeFormat("en-CA", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

/** Calendar day of an instant in an IANA timezone, as YYYY-MM-DD. */
export function dayKeyInZone(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}
