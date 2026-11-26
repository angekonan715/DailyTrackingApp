"use client";

import { useState } from "react";
import type { Workout, WorkoutType } from "@/types";
import {
  WORKOUT_TYPES,
  fromKm,
  toKm,
  type DistanceUnit,
} from "@/lib/workouts";
import { toDayKey } from "@/lib/dates";

export interface WorkoutDraft {
  startedAt: string;
  type: WorkoutType;
  durationMin: number;
  distanceKm: number | null;
  calories: number | null;
  avgHeartRate: number | null;
  notes: string | null;
}

function timeValue(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function startedAtFrom(date: string, time: string): string {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  return new Date(year, (month ?? 1) - 1, day ?? 1, hour ?? 0, minute ?? 0, 0, 0).toISOString();
}

function optionalNumber(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : Number.NaN;
}

export default function WorkoutForm({
  workout,
  unit,
  onUnitChange,
  onCancel,
  onSubmit,
}: {
  workout?: Workout | null;
  unit: DistanceUnit;
  onUnitChange: (unit: DistanceUnit) => void;
  onCancel: () => void;
  onSubmit: (draft: WorkoutDraft) => Promise<void>;
}) {
  const existing = workout ? new Date(workout.started_at) : new Date();
  const [date, setDate] = useState(toDayKey(existing));
  const [time, setTime] = useState(timeValue(existing));
  const [type, setType] = useState<WorkoutType>(workout?.type ?? "run");
  const [duration, setDuration] = useState(
    workout ? String(Math.round(workout.duration_min)) : "",
  );
  const [distance, setDistance] = useState(
    workout?.distance_km == null ? "" : String(roundDistance(fromKm(workout.distance_km, unit))),
  );
  const [calories, setCalories] = useState(
    workout?.calories == null ? "" : String(Math.round(workout.calories)),
  );
  const [heartRate, setHeartRate] = useState(
    workout?.avg_heart_rate == null ? "" : String(Math.round(workout.avg_heart_rate)),
  );
  const [notes, setNotes] = useState(workout?.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function changeUnit(next: DistanceUnit) {
    if (next === unit) return;
    const current = optionalNumber(distance);
    if (typeof current === "number") {
      const km = toKm(current, unit);
      setDistance(String(roundDistance(fromKm(km, next))));
    }
    onUnitChange(next);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const minutes = Number(duration);
    if (!date || !time) {
      setError("Choose a date and start time.");
      return;
    }
    if (!Number.isFinite(minutes) || minutes <= 0) {
      setError("Enter how many minutes you moved.");
      return;
    }
    if (minutes > 24 * 60) {
      setError("Duration needs to be under 24 hours.");
      return;
    }

    const distanceValue = optionalNumber(distance);
    if (Number.isNaN(distanceValue) || (distanceValue != null && distanceValue < 0)) {
      setError("Distance needs to be a number, or left blank.");
      return;
    }
    const calorieValue = optionalNumber(calories);
    if (Number.isNaN(calorieValue) || (calorieValue != null && calorieValue < 0)) {
      setError("Calories need to be a number, or left blank.");
      return;
    }
    const heartValue = optionalNumber(heartRate);
    if (
      Number.isNaN(heartValue) ||
      (heartValue != null && (heartValue < 1 || heartValue > 250))
    ) {
      setError("Heart rate needs to be between 1 and 250, or left blank.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await onSubmit({
        startedAt: startedAtFrom(date, time),
        type,
        durationMin: minutes,
        distanceKm: distanceValue == null ? null : toKm(distanceValue, unit),
        calories: calorieValue,
        avgHeartRate: heartValue,
        notes: notes.trim() || null,
      });
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Could not save the workout.");
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="mb-5 space-y-3 rounded-2xl bg-card p-4">
      <div className="grid grid-cols-2 gap-2">
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Date</span>
          <input
            type="date"
            required
            value={date}
            onChange={(event) => setDate(event.target.value)}
            className="w-full min-h-12 rounded-xl bg-background px-3 text-base outline-none focus:ring-2 focus:ring-accent"
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Start time</span>
          <input
            type="time"
            required
            value={time}
            onChange={(event) => setTime(event.target.value)}
            className="w-full min-h-12 rounded-xl bg-background px-3 text-base outline-none focus:ring-2 focus:ring-accent"
          />
        </label>
      </div>

      <fieldset>
        <legend className="mb-2 text-sm font-medium">Type</legend>
        <div className="grid grid-cols-3 gap-2">
          {WORKOUT_TYPES.map((option) => {
            const selected = type === option.value;
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={selected}
                onClick={() => setType(option.value)}
                className={`min-h-11 rounded-xl text-sm font-medium ${
                  selected ? "bg-accent text-white dark:text-neutral-950" : "bg-background"
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </fieldset>

      <label className="block text-sm">
        <span className="mb-1 block font-medium">Duration (minutes)</span>
        <input
          inputMode="decimal"
          value={duration}
          onChange={(event) => setDuration(event.target.value)}
          placeholder="45"
          className="w-full min-h-12 rounded-xl bg-background px-4 text-base outline-none focus:ring-2 focus:ring-accent"
        />
      </label>

      <div>
        <div className="mb-1 flex items-center justify-between">
          <label htmlFor="workout-distance" className="text-sm font-medium">
            Distance <span className="font-normal text-muted">(optional)</span>
          </label>
          <div className="grid grid-cols-2 rounded-lg bg-background p-0.5 text-xs font-medium">
            {(["km", "mi"] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={unit === option}
                onClick={() => changeUnit(option)}
                className={`min-h-8 rounded-md px-2 ${
                  unit === option ? "bg-accent text-white dark:text-neutral-950" : "text-muted"
                }`}
              >
                {option}
              </button>
            ))}
          </div>
        </div>
        <input
          id="workout-distance"
          inputMode="decimal"
          value={distance}
          onChange={(event) => setDistance(event.target.value)}
          placeholder={unit === "km" ? "5.2" : "3.2"}
          className="w-full min-h-12 rounded-xl bg-background px-4 text-base outline-none focus:ring-2 focus:ring-accent"
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="block text-sm">
          <span className="mb-1 block font-medium">
            Calories <span className="font-normal text-muted">(optional)</span>
          </span>
          <input
            inputMode="numeric"
            value={calories}
            onChange={(event) => setCalories(event.target.value)}
            placeholder="kcal"
            className="w-full min-h-12 rounded-xl bg-background px-3 text-base outline-none focus:ring-2 focus:ring-accent"
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">
            Avg heart rate <span className="font-normal text-muted">(optional)</span>
          </span>
          <input
            inputMode="numeric"
            value={heartRate}
            onChange={(event) => setHeartRate(event.target.value)}
            placeholder="bpm"
            className="w-full min-h-12 rounded-xl bg-background px-3 text-base outline-none focus:ring-2 focus:ring-accent"
          />
        </label>
      </div>

      <label className="block text-sm">
        <span className="mb-1 block font-medium">
          Notes <span className="font-normal text-muted">(optional)</span>
        </span>
        <textarea
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          rows={2}
          maxLength={1000}
          className="w-full rounded-xl bg-background px-4 py-3 text-base outline-none focus:ring-2 focus:ring-accent"
        />
      </label>

      {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="min-h-12 flex-1 rounded-xl bg-background text-sm font-medium"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving}
          className="min-h-12 flex-1 rounded-xl bg-accent text-sm font-semibold text-white disabled:opacity-60 dark:text-neutral-950"
        >
          {saving ? "Saving…" : workout ? "Save changes" : "Save workout"}
        </button>
      </div>
    </form>
  );
}

function roundDistance(value: number): number {
  return Math.round(value * 100) / 100;
}
