"use client";

import Link from "next/link";
import { useState } from "react";
import type { WorkoutType } from "@/types";
import { createClient } from "@/lib/supabase/client";
import { WORKOUT_TYPES } from "@/lib/workouts";

export default function QuickWorkout() {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<WorkoutType>("run");
  const [minutes, setMinutes] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const duration = Number(minutes);
    if (!Number.isFinite(duration) || duration <= 0) {
      setError("Enter how many minutes.");
      return;
    }
    setSaving(true);
    setError(null);
    setSaved(null);
    const started = new Date();
    const payload = {
      type,
      duration_min: duration,
      distance_km: null,
      calories: null,
      avg_heart_rate: null,
      notes: notes.trim() || null,
      source: "manual" as const,
    };
    const supabase = createClient();
    let result = await supabase.from("workouts").insert({ ...payload, started_at: started.toISOString() });
    if (result.error?.code === "23505") {
      started.setMinutes(started.getMinutes() + 1);
      result = await supabase.from("workouts").insert({ ...payload, started_at: started.toISOString() });
    }
    setSaving(false);
    if (result.error) {
      setError(result.error.message);
      return;
    }
    const label = WORKOUT_TYPES.find((item) => item.value === type)?.label ?? "Workout";
    setSaved(`${label} saved for today.`);
    setMinutes("");
    setNotes("");
    setOpen(false);
  }

  return (
    <section className="mb-4">
      {saved ? <p className="mb-2 text-sm text-muted">{saved}</p> : null}
      {open ? (
        <form onSubmit={submit} className="space-y-3 rounded-2xl bg-card p-4">
          <p className="font-semibold">Record a workout</p>
          <div className="grid grid-cols-3 gap-2">
            {WORKOUT_TYPES.map((item) => (
              <button
                key={item.value}
                type="button"
                aria-pressed={type === item.value}
                onClick={() => setType(item.value)}
                className={`min-h-11 rounded-xl text-sm font-medium ${
                  type === item.value ? "bg-accent text-white dark:text-neutral-950" : "bg-background"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
          <label className="block text-sm font-medium" htmlFor="workout-minutes">
            Minutes
          </label>
          <input
            id="workout-minutes"
            inputMode="numeric"
            value={minutes}
            onChange={(event) => setMinutes(event.target.value)}
            placeholder="30"
            className="w-full min-h-12 rounded-xl bg-background px-4 text-base outline-none focus:ring-2 focus:ring-accent"
          />
          <label className="block text-sm font-medium" htmlFor="workout-notes">
            What you did
          </label>
          <textarea
            id="workout-notes"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            rows={2}
            maxLength={1000}
            placeholder="Easy run, 3 miles"
            className="w-full rounded-xl bg-background px-4 py-3 text-base outline-none focus:ring-2 focus:ring-accent"
          />
          {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="min-h-12 flex-1 rounded-xl bg-background text-sm font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="min-h-12 flex-1 rounded-xl bg-accent text-sm font-semibold text-white disabled:opacity-60 dark:text-neutral-950"
            >
              {saving ? "Saving…" : "Save workout"}
            </button>
          </div>
        </form>
      ) : (
        <>
          <button
            type="button"
            onClick={() => {
              setOpen(true);
              setError(null);
            }}
            className="min-h-12 w-full rounded-xl bg-card text-sm font-semibold"
          >
            Record a workout
          </button>
          <Link
            href="/workouts/track"
            className="mt-2 flex min-h-12 w-full items-center justify-center rounded-xl bg-accent text-sm font-semibold text-white dark:text-neutral-950"
          >
            Track a run or walk
          </Link>
        </>
      )}
    </section>
  );
}
