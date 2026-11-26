import type { WorkoutType } from "@/types";

const TYPE_WORDS: { type: WorkoutType; words: string[] }[] = [
  { type: "run", words: ["run", "running", "jog"] },
  { type: "walk", words: ["walk", "walking", "hike"] },
  { type: "ride", words: ["ride", "bike", "cycling", "cycle"] },
  { type: "strength", words: ["strength", "weights", "lifting", "lift", "gym"] },
  { type: "yoga", words: ["yoga", "stretch"] },
];

export interface WorkoutFromTask {
  type: WorkoutType;
  durationMin: number;
  distanceKm: number | null;
  notes: string;
}

/** Read a workout out of a task title and description. */
export function workoutFromTask(title: string, note: string | null): WorkoutFromTask {
  const description = note?.trim() ?? "";
  const text = `${title} ${description}`.toLowerCase();
  const minutes = text.match(/(\d+(?:\.\d+)?)\s*(?:minutes|minute|mins|min)\b/);
  if (!minutes) {
    throw new Error('Put the minutes in the description, for example "30 min easy run".');
  }
  const distance = text.match(/(\d+(?:\.\d+)?)\s*(km|kilometers|mi|miles|mile)\b/);
  let distanceKm: number | null = null;
  if (distance) {
    const value = Number(distance[1]);
    const unit = distance[2];
    distanceKm = unit === "km" || unit === "kilometers" ? value : value * 1.609344;
    distanceKm = Math.round(distanceKm * 1000) / 1000;
  }
  const type = TYPE_WORDS.find((item) => item.words.some((word) => new RegExp(`\\b${word}\\b`).test(text)))?.type ?? "other";
  return {
    type,
    durationMin: Number(minutes[1]),
    distanceKm,
    notes: description || title.trim(),
  };
}
