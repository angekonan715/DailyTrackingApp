"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import PageHeader from "@/components/PageHeader";
import SetupNotice from "@/components/SetupNotice";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { formatMinutes, workoutTypeLabel } from "@/lib/workouts";
import {
  parseSamsungCsv,
  type SamsungExercise,
  type SamsungStepDay,
} from "@/lib/samsung-csv";
import { toDayKey } from "@/lib/dates";

interface Preview {
  exercises: SamsungExercise[];
  steps: SamsungStepDay[];
  skipped: number;
  notes: string[];
}

function chunks<T>(items: T[], size: number): T[][] {
  const groups: T[][] = [];
  for (let index = 0; index < items.length; index += size) groups.push(items.slice(index, index + size));
  return groups;
}

export default function SamsungImport() {
  if (!isSupabaseConfigured()) {
    return (
      <>
        <PageHeader title="Import from Samsung Health" />
        <SetupNotice />
      </>
    );
  }
  return <ImportScreen />;
}

function ImportScreen() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [lastImport, setLastImport] = useState<string | null>(null);
  const [loadingImport, setLoadingImport] = useState(true);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadLastImport() {
      const { data, error: loadError } = await createClient()
        .from("workouts")
        .select("created_at")
        .eq("source", "samsung")
        .order("created_at", { ascending: false })
        .limit(1);
      if (cancelled) return;
      if (loadError) setError(loadError.message);
      const createdAt = (data?.[0] as { created_at?: string } | undefined)?.created_at;
      setLastImport(createdAt ?? null);
      setLoadingImport(false);
    }
    void loadLastImport();
    return () => {
      cancelled = true;
    };
  }, []);

  async function onFiles(fileList: FileList | null) {
    const files = [...(fileList ?? [])];
    if (files.length === 0) return;
    setReading(true);
    setError(null);
    setResult(null);
    const next: Preview = { exercises: [], steps: [], skipped: 0, notes: [] };
    try {
      for (const file of files) {
        const text = await file.text();
        const parsed = parseSamsungCsv(file.name, text);
        if (parsed.kind === "unknown") {
          next.notes.push(`${file.name} was skipped. Choose the exercise file or the step count file.`);
          continue;
        }
        next.exercises.push(...parsed.exercises);
        next.steps.push(...parsed.steps);
        next.skipped += parsed.skipped;
        next.notes.push(
          parsed.kind === "exercise"
            ? `${file.name}: ${parsed.exercises.length} workouts`
            : `${file.name}: ${parsed.steps.length} days of steps`,
        );
      }
      setPreview(next);
    } catch (readError) {
      setPreview(null);
      setError(readError instanceof Error ? readError.message : "Could not read that file.");
    } finally {
      setReading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function save() {
    if (!preview) return;
    setSaving(true);
    setError(null);
    try {
      const supabase = createClient();
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError || !authData.user) throw new Error("Your session expired. Sign in again.");
      const userId = authData.user.id;

      let saved = 0;
      let duplicates = 0;
      for (const group of chunks(preview.exercises, 200)) {
        const rows = group.map((exercise) => ({
          user_id: userId,
          started_at: exercise.startedAt,
          type: exercise.type,
          duration_min: exercise.durationMin,
          distance_km: exercise.distanceKm,
          calories: exercise.calories,
          avg_heart_rate: exercise.avgHeartRate,
          notes: exercise.notes,
          source: "samsung" as const,
        }));
        const { data, error: saveError } = await supabase
          .from("workouts")
          .upsert(rows, { onConflict: "user_id,started_at,type", ignoreDuplicates: true })
          .select("id");
        if (saveError) throw new Error(saveError.message);
        const inserted = data?.length ?? 0;
        saved += inserted;
        duplicates += rows.length - inserted;
      }

      if (preview.steps.length > 0) {
        const { error: stepError } = await supabase.from("daily_steps").upsert(
          preview.steps.map((day) => ({ user_id: userId, day: day.day, steps: day.steps })),
          { onConflict: "user_id,day" },
        );
        if (stepError) throw new Error(stepError.message);
      }

      const parts = [`Saved ${saved} workouts`];
      if (duplicates > 0) parts.push(`skipped ${duplicates} already imported`);
      if (preview.steps.length > 0) parts.push(`updated ${preview.steps.length} days of steps`);
      setResult(`${parts.join(", ")}.`);
      setLastImport(new Date().toISOString());
      setPreview(null);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save the import.");
    } finally {
      setSaving(false);
    }
  }

  const exercisePreview = preview?.exercises.slice(0, 12) ?? [];
  const stepPreview = preview?.steps.slice(-8) ?? [];

  return (
    <>
      <PageHeader
        title="Import from Samsung Health"
        action={
          <Link href="/workouts" className="flex min-h-11 items-center text-sm font-medium text-accent">
            Back
          </Link>
        }
      />

      <section className="mb-4 rounded-2xl bg-card p-4 text-sm">
        <h2 className="font-semibold">How to export from the phone</h2>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-muted">
          <li>Open the Samsung Health app.</li>
          <li>Go to Settings, then Download personal data.</li>
          <li>Request the download and unzip the file it gives you.</li>
          <li>Choose the CSV with “exercise” in the name. The step count file is optional.</li>
        </ol>
        <p className="mt-3">
          {loadingImport
            ? "Checking your last import…"
            : lastImport
              ? `Last import: ${new Date(lastImport).toLocaleString(undefined, {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}`
              : "You have not imported a Samsung file yet."}
        </p>
      </section>

      <label className="mb-4 flex min-h-12 cursor-pointer items-center justify-center rounded-xl bg-accent px-4 text-base font-semibold text-white dark:text-neutral-950">
        {reading ? "Reading files…" : "Choose CSV files"}
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          multiple
          className="sr-only"
          onChange={(event) => void onFiles(event.target.files)}
        />
      </label>

      {error ? (
        <p role="alert" className="mb-4 rounded-2xl bg-card px-4 py-3 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
      {result ? (
        <p role="status" className="mb-4 rounded-2xl bg-card px-4 py-3 text-sm">
          {result}
        </p>
      ) : null}

      {preview ? (
        <section className="space-y-4">
          <div className="rounded-2xl bg-card p-4 text-sm">
            <p className="font-semibold">
              {preview.exercises.length} workouts
              {preview.steps.length > 0 ? ` and ${preview.steps.length} days of steps` : ""}
            </p>
            {preview.notes.map((note) => (
              <p key={note} className="mt-1 text-muted">
                {note}
              </p>
            ))}
            {preview.skipped > 0 ? (
              <p className="mt-1 text-muted">{preview.skipped} rows had no usable time and were left out.</p>
            ) : null}
          </div>

          {exercisePreview.length > 0 ? (
            <div className="overflow-x-auto rounded-2xl bg-card">
              <table className="w-full min-w-[32rem] text-left text-sm">
                <thead className="text-muted">
                  <tr>
                    <th className="px-3 py-2 font-medium">When</th>
                    <th className="px-3 py-2 font-medium">Type</th>
                    <th className="px-3 py-2 font-medium">Time</th>
                    <th className="px-3 py-2 font-medium">Distance</th>
                  </tr>
                </thead>
                <tbody>
                  {exercisePreview.map((exercise, index) => {
                    const start = new Date(exercise.startedAt);
                    return (
                      <tr key={`${exercise.startedAt}-${exercise.type}-${index}`} className="border-t border-black/5 dark:border-white/10">
                        <td className="px-3 py-2">
                          {toDayKey(start)} {start.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                        </td>
                        <td className="px-3 py-2">{workoutTypeLabel(exercise.type)}</td>
                        <td className="px-3 py-2">{formatMinutes(exercise.durationMin)}</td>
                        <td className="px-3 py-2">
                          {exercise.distanceKm == null ? "—" : `${exercise.distanceKm} km`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {preview.exercises.length > exercisePreview.length ? (
                <p className="px-3 py-2 text-sm text-muted">
                  Showing {exercisePreview.length} of {preview.exercises.length}.
                </p>
              ) : null}
            </div>
          ) : null}

          {stepPreview.length > 0 ? (
            <div className="overflow-x-auto rounded-2xl bg-card">
              <table className="w-full text-left text-sm">
                <thead className="text-muted">
                  <tr>
                    <th className="px-3 py-2 font-medium">Day</th>
                    <th className="px-3 py-2 font-medium">Steps</th>
                  </tr>
                </thead>
                <tbody>
                  {stepPreview.map((day) => (
                    <tr key={day.day} className="border-t border-black/5 dark:border-white/10">
                      <td className="px-3 py-2">{day.day}</td>
                      <td className="px-3 py-2">{day.steps.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setPreview(null)}
              className="min-h-12 flex-1 rounded-xl bg-card text-sm font-medium"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving || (preview.exercises.length === 0 && preview.steps.length === 0)}
              className="min-h-12 flex-1 rounded-xl bg-accent text-sm font-semibold text-white disabled:opacity-60 dark:text-neutral-950"
            >
              {saving ? "Saving…" : "Save import"}
            </button>
          </div>
        </section>
      ) : null}
    </>
  );
}
