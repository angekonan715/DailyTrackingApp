// Phase 3: parser for Samsung Health "Download personal data" CSV files.
//
// Notes on the export format:
// - The first line is metadata (e.g. "com.samsung.shealth.exercise,6312004,3");
//   the real header row comes after it.
// - Column names are long, e.g. "com.samsung.health.exercise.start_time".
// - exercise_type is a numeric code; map it to WorkoutType.
// Column names can differ between Samsung Health versions, so map by name.

import type { WorkoutType } from "@/types";

export const SAMSUNG_EXERCISE_TYPES: Record<number, WorkoutType> = {
  1001: "walk",
  1002: "run",
  11007: "ride",
  // TODO (Phase 3): extend from real export data.
};

export function mapExerciseType(code: number): WorkoutType {
  return SAMSUNG_EXERCISE_TYPES[code] ?? "other";
}
