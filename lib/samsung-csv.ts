// Parser for Samsung Health "Download personal data" CSV files.
//
// The first line is metadata (for example "com.samsung.shealth.exercise,6312004,3").
// The real header row comes after it and uses long names such as
// "com.samsung.health.exercise.start_time". Column names vary by app version,
// so this matches them by the ending of the name.

import type { WorkoutType } from "@/types";
import { toDayKey } from "@/lib/dates";

export const SAMSUNG_EXERCISE_TYPES: Record<number, WorkoutType> = {
  0: "other",
  1001: "walk",
  1002: "run",
  9002: "yoga",
  11007: "ride",
  15002: "strength",
};

export function mapExerciseType(code: number): WorkoutType {
  return SAMSUNG_EXERCISE_TYPES[code] ?? "other";
}

export interface SamsungExercise {
  startedAt: string;
  type: WorkoutType;
  durationMin: number;
  distanceKm: number | null;
  calories: number | null;
  avgHeartRate: number | null;
  notes: string | null;
}

export interface SamsungStepDay {
  day: string;
  steps: number;
}

export interface SamsungParseResult {
  kind: "exercise" | "steps" | "unknown";
  exercises: SamsungExercise[];
  steps: SamsungStepDay[];
  skipped: number;
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const source = text.replace(/^\uFEFF/, "");

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char === ",") {
      row.push(cell.trim());
      cell = "";
      continue;
    }
    if (char === "\n" || char === "\r") {
      if (char === "\r" && source[i + 1] === "\n") i += 1;
      row.push(cell.trim());
      cell = "";
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
      continue;
    }
    cell += char;
  }

  if (cell !== "" || row.length > 0) {
    row.push(cell.trim());
    if (row.some((value) => value !== "")) rows.push(row);
  }
  return rows;
}

function headerScore(row: string[]): number {
  return row.filter((cell) =>
    /start_time|end_time|exercise_type|duration|distance|calorie|step_count|day_time|count|heart_rate/i.test(
      cell,
    ),
  ).length;
}

export function findHeaderIndex(rows: string[][]): number {
  let best = -1;
  let bestScore = 1;
  rows.slice(0, 8).forEach((row, index) => {
    const score = headerScore(row);
    if (score > bestScore) {
      best = index;
      bestScore = score;
    }
  });
  return best;
}

function fieldName(header: string): string {
  const parts = header.toLowerCase().split(".");
  return parts[parts.length - 1] ?? "";
}

function columnIndex(headers: string[], fields: string[]): number {
  const names = headers.map(fieldName);
  for (const field of fields) {
    const index = names.indexOf(field);
    if (index >= 0) return index;
  }
  return -1;
}

function cell(row: string[], index: number): string {
  if (index < 0) return "";
  return row[index] ?? "";
}

export function parseSamsungTime(raw: string): Date | null {
  const value = raw.trim();
  if (!value) return null;
  if (/^\d{10,16}$/.test(value)) {
    const number = Number(value);
    const ms = number < 1e12 ? number * 1000 : number;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function optionalNumber(raw: string): number | null {
  const value = raw.trim();
  if (!value) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function durationMinutes(raw: string, start: Date, end: Date | null): number | null {
  const number = optionalNumber(raw);
  let minutes: number | null = null;
  if (number != null && number > 0) {
    if (number >= 1000) minutes = number / 60_000;
    else if (number >= 300) minutes = number / 60;
    else minutes = number;
  } else if (end) {
    minutes = (end.getTime() - start.getTime()) / 60_000;
  }
  if (minutes == null || !Number.isFinite(minutes) || minutes <= 0) return null;
  return Math.round(minutes * 10) / 10;
}

function detectKind(filename: string, headers: string[]): "exercise" | "steps" | "unknown" {
  const name = filename.toLowerCase();
  const joined = headers.join(" ").toLowerCase();
  if (joined.includes("exercise_type") || (name.includes("exercise") && joined.includes("start_time"))) {
    return "exercise";
  }
  if (name.includes("step") || joined.includes("step_count") || joined.includes("step.")) return "steps";
  return "unknown";
}

function parseExercises(headers: string[], dataRows: string[][]): { exercises: SamsungExercise[]; skipped: number } {
  const startCol = columnIndex(headers, ["start_time"]);
  const endCol = columnIndex(headers, ["end_time"]);
  const durationCol = columnIndex(headers, ["duration"]);
  const typeCol = columnIndex(headers, ["exercise_type"]);
  const distanceCol = columnIndex(headers, ["distance"]);
  const calorieCol = columnIndex(headers, ["calorie"]);
  const heartCol = columnIndex(headers, ["mean_heart_rate", "avg_heart_rate", "heart_rate"]);
  const noteCol = columnIndex(headers, ["comment", "additional"]);
  const exercises: SamsungExercise[] = [];
  let skipped = 0;

  for (const row of dataRows) {
    const start = parseSamsungTime(cell(row, startCol));
    if (!start) {
      skipped += 1;
      continue;
    }
    const end = parseSamsungTime(cell(row, endCol));
    const durationMin = durationMinutes(cell(row, durationCol), start, end);
    if (durationMin == null) {
      skipped += 1;
      continue;
    }
    const typeCode = Number(cell(row, typeCol));
    const distanceMeters = optionalNumber(cell(row, distanceCol));
    const calories = optionalNumber(cell(row, calorieCol));
    const heart = optionalNumber(cell(row, heartCol));
    const notes = cell(row, noteCol).trim();
    exercises.push({
      startedAt: start.toISOString(),
      type: mapExerciseType(Number.isFinite(typeCode) ? typeCode : 0),
      durationMin,
      distanceKm:
        distanceMeters == null || distanceMeters <= 0
          ? null
          : Math.round((distanceMeters / 1000) * 1000) / 1000,
      calories: calories == null || calories < 0 ? null : Math.round(calories),
      avgHeartRate: heart == null || heart <= 0 ? null : Math.round(heart),
      notes: notes ? notes.slice(0, 1000) : null,
    });
  }

  return { exercises, skipped };
}

function parseSteps(headers: string[], dataRows: string[][]): { steps: SamsungStepDay[]; skipped: number } {
  const dayCol = columnIndex(headers, ["day_time", "date", "start_time"]);
  const countCol = columnIndex(headers, ["count", "step_count"]);
  const totals = new Map<string, number>();
  let skipped = 0;

  for (const row of dataRows) {
    const rawDay = cell(row, dayCol);
    const day = /^\d{4}-\d{2}-\d{2}$/.test(rawDay) ? rawDay : parseSamsungTime(rawDay);
    const dayKey = typeof day === "string" ? day : day ? toDayKey(day) : null;
    const count = optionalNumber(cell(row, countCol));
    if (!dayKey || count == null || count < 0) {
      skipped += 1;
      continue;
    }
    totals.set(dayKey, (totals.get(dayKey) ?? 0) + Math.round(count));
  }

  return {
    steps: [...totals.entries()]
      .map(([day, steps]) => ({ day, steps }))
      .sort((a, b) => a.day.localeCompare(b.day)),
    skipped,
  };
}

export function parseSamsungCsv(filename: string, text: string): SamsungParseResult {
  const rows = parseCsv(text);
  const headerIndex = findHeaderIndex(rows);
  if (headerIndex < 0) {
    return { kind: "unknown", exercises: [], steps: [], skipped: 0 };
  }
  const headers = rows[headerIndex] ?? [];
  const dataRows = rows.slice(headerIndex + 1);
  const kind = detectKind(filename, headers);
  if (kind === "exercise") {
    const parsed = parseExercises(headers, dataRows);
    return { kind, exercises: parsed.exercises, steps: [], skipped: parsed.skipped };
  }
  if (kind === "steps") {
    const parsed = parseSteps(headers, dataRows);
    return { kind, exercises: [], steps: parsed.steps, skipped: parsed.skipped };
  }
  return { kind: "unknown", exercises: [], steps: [], skipped: 0 };
}
