"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Priority, Task, TaskKind } from "@/types";
import PageHeader from "@/components/PageHeader";
import EmptyState from "@/components/EmptyState";
import SetupNotice from "@/components/SetupNotice";
import SignOutButton from "@/components/auth/SignOutButton";
import TaskList, { type TaskDraft } from "@/components/tasks/TaskList";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { addDays, formatLongDate, parseDayKey, relativeDayLabel, toDayKey } from "@/lib/dates";
import { sortTasks } from "@/lib/tasks";
import { workoutFromTask } from "@/lib/task-workout";
import DailyQuote from "@/components/summary/DailyQuote";
import QuickWorkout from "@/components/workouts/QuickWorkout";
import { carriedOnServer, readCarried, rememberCarried, subscribeCarried } from "@/lib/carried";

function subscribe() {
  return () => {};
}

async function syncLinkedWorkout(task: Pick<Task, "id" | "task_date" | "title" | "note" | "kind">) {
  const supabase = createClient();
  if (task.kind === "task") {
    const { error } = await supabase.from("workouts").delete().eq("task_id", task.id);
    if (error && !/task_id|schema cache|column/i.test(error.message)) {
      throw new Error(friendlyError(error.message));
    }
    return;
  }
  const parsed = workoutFromTask(task.title, task.note);
  const { data: existing, error: lookupError } = await supabase
    .from("workouts")
    .select("id")
    .eq("task_id", task.id)
    .maybeSingle();
  if (lookupError) throw new Error(friendlyError(lookupError.message));
  const fields = {
    type: parsed.type,
    duration_min: parsed.durationMin,
    distance_km: parsed.distanceKm,
    notes: parsed.notes,
    task_id: task.id,
  };
  if (existing?.id) {
    const { error } = await supabase.from("workouts").update(fields).eq("id", existing.id);
    if (error) throw new Error(friendlyError(error.message));
    return;
  }
  const clock = new Date();
  const started = parseDayKey(task.task_date);
  started.setHours(clock.getHours(), clock.getMinutes(), 0, 0);
  const { error } = await supabase.from("workouts").insert({
    ...fields,
    started_at: started.toISOString(),
    source: "manual",
  });
  if (error?.code === "23505") {
    started.setMinutes(started.getMinutes() + 1);
    const retry = await supabase.from("workouts").insert({
      ...fields,
      started_at: started.toISOString(),
      source: "manual",
    });
    if (retry.error) throw new Error(friendlyError(retry.error.message));
    return;
  }
  if (error) throw new Error(friendlyError(error.message));
}

function friendlyError(message: string): string {
  if (/kind|task_id|schema cache|column/i.test(message)) {
    return "In Supabase, open the SQL Editor, paste supabase/migrations/0006_task_workouts.sql, and run it.";
  }
  if (/relation|schema cache|does not exist/i.test(message)) {
    return "The tasks table is missing. In Supabase, open the SQL Editor, paste supabase/migrations/0001_init.sql, and run it.";
  }
  if (/jwt|not authenticated|invalid claim/i.test(message)) {
    return "Your session expired. Sign in again.";
  }
  return message;
}

export default function TodayBoard() {
  if (!isSupabaseConfigured()) {
    return (
      <>
        <PageHeader title="Today" />
        <SetupNotice />
      </>
    );
  }
  return <TaskScreen />;
}

function TaskScreen() {
  const todayKey = useSyncExternalStore(subscribe, toDayKey, () => "");
  const [picked, setPicked] = useState("");
  const activeDate = picked || todayKey;
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loadedFor, setLoadedFor] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [carrying, setCarrying] = useState(false);
  const [adding, setAdding] = useState(false);
  const [todoOnly, setTodoOnly] = useState(false);
  const savedPositions = useRef(new Map<string, number>());
  const touch = useRef<{ x: number; y: number } | null>(null);
  const remember = useCallback((list: Task[]) => {
    savedPositions.current = new Map(list.map((task) => [task.id, task.position]));
  }, []);

  useEffect(() => {
    if (!activeDate) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      const { data, error: loadError } = await createClient()
        .from("tasks")
        .select("id, user_id, title, note, priority, task_date, kind, done, position, created_at")
        .eq("task_date", activeDate)
        .order("position", { ascending: true });

      if (cancelled) return;
      if (loadError) {
        setTasks([]);
        setError(friendlyError(loadError.message));
        setLoadedFor(activeDate);
        setLoading(false);
        return;
      }

      const rows = sortTasks((data ?? []) as Task[]);
      setTasks(rows);
      remember(rows);
      setLoadedFor(activeDate);
      setLoading(false);
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [activeDate, remember]);

  function shift(days: number) {
    if (!activeDate) return;
    setNotice(null);
    setError(null);
    setPicked(toDayKey(addDays(parseDayKey(activeDate), days)));
  }

  async function savePositions(ordered: Task[]) {
    const changed = ordered.filter(
      (task) => savedPositions.current.get(task.id) !== task.position,
    );
    if (changed.length === 0) return;
    const supabase = createClient();
    const results = await Promise.all(
      changed.map((task) =>
        supabase.from("tasks").update({ position: task.position }).eq("id", task.id),
      ),
    );
    const failed = results.find((result) => result.error);
    if (failed?.error) throw new Error(friendlyError(failed.error.message));
    remember(ordered);
  }

  async function reload() {
    if (!activeDate) return;
    const { data, error: loadError } = await createClient()
      .from("tasks")
      .select("id, user_id, title, note, priority, task_date, kind, done, position, created_at")
      .eq("task_date", activeDate)
      .order("position", { ascending: true });
    if (loadError) {
      setError(friendlyError(loadError.message));
      return;
    }
    const rows = sortTasks((data ?? []) as Task[]);
    setTasks(rows);
    remember(rows);
  }

  async function toggle(task: Task) {
    const done = !task.done;
    setTasks((current) =>
      sortTasks(current.map((item) => (item.id === task.id ? { ...item, done } : item))),
    );
    const { error: updateError } = await createClient()
      .from("tasks")
      .update({ done })
      .eq("id", task.id);
    if (updateError) {
      setError(friendlyError(updateError.message));
      await reload();
    }
  }

  async function remove(task: Task) {
    setTasks((current) => current.filter((item) => item.id !== task.id));
    const { error: deleteError } = await createClient().from("tasks").delete().eq("id", task.id);
    if (deleteError) {
      setError(friendlyError(deleteError.message));
      await reload();
    }
  }

  async function save(task: Task, draft: TaskDraft) {
    const note = draft.note.trim() || null;
    const kind = draft.kind;
    if (kind !== "task") workoutFromTask(draft.title, note);
    const { error: updateError } = await createClient()
      .from("tasks")
      .update({ title: draft.title, note, priority: draft.priority, kind })
      .eq("id", task.id);
    if (updateError) throw new Error(friendlyError(updateError.message));
    await syncLinkedWorkout({ id: task.id, task_date: task.task_date, title: draft.title, note, kind });
    setTasks((current) =>
      sortTasks(
        current.map((item) =>
          item.id === task.id ? { ...item, title: draft.title, note, priority: draft.priority, kind } : item,
        ),
      ),
    );
  }

  async function commitOrder(next: Task[]) {
    setTasks(next);
    try {
      await savePositions(next);
    } catch (commitError) {
      setError(commitError instanceof Error ? commitError.message : "Could not save the new order.");
      await reload();
    }
  }

  async function carryOver() {
    if (!todayKey) return;
    setCarrying(true);
    setError(null);
    setNotice(null);
    const yesterday = toDayKey(addDays(parseDayKey(todayKey), -1));
    const supabase = createClient();
    const { data, error: loadError } = await supabase
      .from("tasks")
      .select("id, user_id, title, note, priority, task_date, kind, done, position, created_at")
      .eq("task_date", yesterday)
      .eq("done", false)
      .order("position", { ascending: true });

    if (loadError) {
      setError(friendlyError(loadError.message));
      setCarrying(false);
      return;
    }

    const unfinished = (data ?? []) as Task[];
    if (unfinished.length === 0) {
      setNotice("No unfinished tasks from yesterday.");
      setCarrying(false);
      return;
    }

    const start = tasks.reduce((max, task) => Math.max(max, task.position), -1) + 1;
    const results = await Promise.all(
      unfinished.map((task, index) =>
        supabase
          .from("tasks")
          .update({ task_date: todayKey, position: start + index, done: false })
          .eq("id", task.id),
      ),
    );
    const failed = results.find((result) => result.error);
    if (failed?.error) {
      setError(friendlyError(failed.error.message));
      await reload();
      setCarrying(false);
      return;
    }

    setNotice(
      unfinished.length === 1
        ? "Moved 1 unfinished task from yesterday."
        : `Moved ${unfinished.length} unfinished tasks from yesterday.`,
    );
    rememberCarried(unfinished.map((task) => task.id));
    await reload();
    setCarrying(false);
  }

  const viewingToday = Boolean(todayKey) && activeDate === todayKey;
  const ready = Boolean(activeDate) && loadedFor === activeDate && !loading;
  const visibleTasks = ready ? tasks : [];
  const doneCount = visibleTasks.filter((task) => task.done).length;
  const total = visibleTasks.length;
  const percent = total === 0 ? 0 : Math.round((doneCount / total) * 100);

  function onTouchStart(event: React.TouchEvent) {
    const target = event.target;
    if (target instanceof Element && target.closest("button, a")) return;
    const point = event.changedTouches[0];
    if (!point) return;
    touch.current = { x: point.clientX, y: point.clientY };
  }

  function onTouchEnd(event: React.TouchEvent) {
    const start = touch.current;
    touch.current = null;
    if (!start) return;
    const point = event.changedTouches[0];
    if (!point) return;
    const dx = point.clientX - start.x;
    const dy = point.clientY - start.y;
    if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy) * 1.2) return;
    shift(dx > 0 ? -1 : 1);
  }

  async function addTask(draft: {
    title: string;
    note: string | null;
    priority: Priority | null;
    kind: TaskKind;
  }) {
    if (!activeDate) return;
    if (draft.kind !== "task") workoutFromTask(draft.title, draft.note);
    const position = tasks.reduce((max, task) => Math.max(max, task.position), -1) + 1;
    const { data, error: insertError } = await createClient()
      .from("tasks")
      .insert({
        title: draft.title,
        note: draft.note,
        priority: draft.priority,
        kind: draft.kind,
        task_date: activeDate,
        position,
      })
      .select("id, user_id, title, note, priority, task_date, kind, done, position, created_at")
      .single();
    if (insertError) throw new Error(friendlyError(insertError.message));
    const created = { ...(data as Task), kind: (data as Task).kind ?? draft.kind };
    await syncLinkedWorkout(created);
    setTasks((current) => {
      const next = sortTasks([...current, created]);
      remember(next);
      return next;
    });
    setAdding(false);
  }

  const carriedIds = useSyncExternalStore(subscribeCarried, readCarried, carriedOnServer);

  useEffect(() => {
    if (!ready || !viewingToday || !("setAppBadge" in navigator)) return;
    const left = tasks.filter((task) => !task.done).length;
    const nav = navigator as Navigator & {
      setAppBadge?: (count?: number) => Promise<void>;
      clearAppBadge?: () => Promise<void>;
    };
    const pending = left > 0 ? nav.setAppBadge?.(left) : nav.clearAppBadge?.();
    void pending?.catch(() => undefined);
  }, [ready, viewingToday, tasks]);

  const focusToday = viewingToday && todoOnly;
  const list = (
    <>
      {!ready ? (
        <div className="space-y-2" aria-live="polite">
          <p className="sr-only">Loading tasks</p>
          <div className="h-20 animate-pulse rounded-2xl bg-card" />
          <div className="h-20 animate-pulse rounded-2xl bg-card" />
        </div>
      ) : null}
      {ready && tasks.length === 0 ? <EmptyState title="No tasks yet" hint="Add one when you are ready." /> : null}
      {ready && tasks.length > 0 && todoOnly && tasks.every((task) => task.done) ? (
        <EmptyState title="Today is clear" hint="Every task for today is done." />
      ) : null}
      {ready && tasks.some((task) => (todoOnly ? !task.done : true)) ? (
        <TaskList
          tasks={tasks}
          hideDone={todoOnly}
          carriedIds={carriedIds}
          onToggle={toggle}
          onDelete={remove}
          onSave={save}
          onPreview={setTasks}
          onCommit={(next) => void commitOrder(next)}
        />
      ) : null}
      {adding ? <AddTaskForm disabled={!ready} onAdd={addTask} /> : null}
      <button
        type="button"
        onClick={() => setAdding((open) => !open)}
        className="mt-4 min-h-12 w-full rounded-xl bg-accent text-base font-semibold text-white dark:text-neutral-950"
      >
        {adding ? "Close" : "Add a task"}
      </button>
    </>
  );

  if (focusToday) {
    return (
      <>
        {todayKey ? <DailyQuote today={todayKey} quiet className="mb-4" /> : null}
        <header className="mb-5 flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Today</h1>
            <p className="mt-0.5 text-sm text-muted">{todayKey ? formatLongDate(todayKey) : "Loading date…"}</p>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setTodoOnly(false)}
              className="min-h-11 px-2 text-sm font-medium text-muted"
            >
              Other days
            </button>
            <SignOutButton />
          </div>
        </header>
        {error ? (
          <div role="alert" className="mb-4 rounded-2xl bg-card px-4 py-3 text-sm">
            <p className="text-red-600 dark:text-red-400">{error}</p>
            <button type="button" onClick={() => void reload()} className="mt-2 min-h-11 font-medium text-accent">
              Try again
            </button>
          </div>
        ) : null}
        <QuickWorkout />
        {list}
      </>
    );
  }

  return (
    <>
      {viewingToday && todayKey ? <DailyQuote today={todayKey} quiet className="mb-4" /> : null}
      <div className="mb-6" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        <div className="flex justify-end">
          <SignOutButton />
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label="Previous day"
            onClick={() => shift(-1)}
            disabled={!activeDate}
            className="h-12 w-12 shrink-0 rounded-full bg-card text-2xl leading-none disabled:opacity-40"
          >
            ‹
          </button>
          <div className="min-w-0 flex-1 text-center">
            <h1 className="text-2xl font-bold">
              {activeDate && todayKey ? relativeDayLabel(activeDate, todayKey) : "Today"}
            </h1>
            <p className="mt-0.5 text-sm text-muted">
              {activeDate ? formatLongDate(activeDate) : "Loading date…"}
            </p>
            {activeDate && todayKey && !viewingToday ? (
              <button
                type="button"
                onClick={() => {
                  setNotice(null);
                  setError(null);
                  setPicked("");
                }}
                className="min-h-11 px-3 text-sm font-medium text-accent"
              >
                Back to today
              </button>
            ) : null}
          </div>
          <button
            type="button"
            aria-label="Next day"
            onClick={() => shift(1)}
            disabled={!activeDate}
            className="h-12 w-12 shrink-0 rounded-full bg-card text-2xl leading-none disabled:opacity-40"
          >
            ›
          </button>
        </div>
      </div>

      <div className="mb-5">
        <div className="mb-2 flex items-baseline justify-between text-sm">
          <p className="font-medium">
            {!ready ? "Loading…" : total === 0 ? "Nothing planned" : `${doneCount} of ${total} done`}
          </p>
          {total > 0 ? <p className="text-muted">{percent}%</p> : null}
        </div>
        <div
          className="h-2 overflow-hidden rounded-full bg-card"
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Tasks done"
        >
          <div className="h-full bg-accent transition-[width]" style={{ width: `${percent}%` }} />
        </div>
      </div>

      {viewingToday ? (
        <button
          type="button"
          onClick={carryOver}
          disabled={carrying || !ready}
          className="mb-4 min-h-12 w-full rounded-xl bg-card text-sm font-medium disabled:opacity-60"
        >
          {carrying ? "Moving…" : "Carry over from yesterday"}
        </button>
      ) : null}

      <button
        type="button"
        onClick={() => {
          setNotice(null);
          setError(null);
          setPicked("");
          setTodoOnly(true);
          setAdding(false);
        }}
        className="mb-4 min-h-12 w-full rounded-xl bg-card text-sm font-semibold"
      >
        Today only
      </button>

      <QuickWorkout />

      {notice ? (
        <p role="status" className="mb-4 text-sm text-muted">
          {notice}
        </p>
      ) : null}
      {error ? (
        <div role="alert" className="mb-4 rounded-2xl bg-card px-4 py-3 text-sm">
          <p className="text-red-600 dark:text-red-400">{error}</p>
          <button type="button" onClick={() => void reload()} className="mt-2 min-h-11 font-medium text-accent">
            Try again
          </button>
        </div>
      ) : null}

      {list}
    </>
  );
}

function AddTaskForm({
  disabled,
  onAdd,
}: {
  disabled: boolean;
  onAdd: (draft: {
    title: string;
    note: string | null;
    priority: Priority | null;
    kind: TaskKind;
  }) => Promise<void>;
}) {
  const titleRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [priority, setPriority] = useState<Priority | null>(null);
  const [kind, setKind] = useState<TaskKind>("task");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) {
      setError("Add a title first.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onAdd({ title: trimmed, note: note.trim() || null, priority, kind });
      setTitle("");
      setNote("");
      setPriority(null);
      setKind("task");
      titleRef.current?.focus();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Could not add the task.");
    } finally {
      setSaving(false);
    }
  }

  const options: Priority[] = ["low", "medium", "high"];

  return (
    <form onSubmit={submit} className="mb-5 space-y-3 rounded-2xl bg-card p-4">
      <div>
        <label htmlFor="task-title" className="mb-1 block text-sm font-medium">
          New task
        </label>
        <input
          ref={titleRef}
          id="task-title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          maxLength={200}
          placeholder="What needs doing?"
          className="w-full min-h-12 rounded-xl bg-background px-4 text-base outline-none focus:ring-2 focus:ring-accent"
        />
      </div>
      <fieldset>
        <legend className="mb-2 text-sm font-medium">Kind</legend>
        <div className="grid grid-cols-3 gap-2">
          {(
            [
              ["task", "Task"],
              ["exercise", "Exercise"],
              ["workout", "Workout"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={kind === value}
              onClick={() => setKind(value)}
              className={`min-h-11 rounded-xl text-sm font-medium ${
                kind === value ? "bg-accent text-white dark:text-neutral-950" : "bg-background"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </fieldset>
      <div>
        <label htmlFor="task-note" className="mb-1 block text-sm font-medium">
          {kind === "task" ? (
            <>
              Note <span className="font-normal text-muted">(optional)</span>
            </>
          ) : (
            "Description"
          )}
        </label>
        <textarea
          id="task-note"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={2}
          maxLength={1000}
          placeholder={kind === "task" ? "Details" : "30 min easy run"}
          className="w-full rounded-xl bg-background px-4 py-3 text-base outline-none focus:ring-2 focus:ring-accent"
        />
        {kind === "task" ? null : (
          <p className="mt-1 text-sm text-muted">Include the minutes, for example 30 min. This is saved as a workout.</p>
        )}
      </div>
      <fieldset>
        <legend className="mb-2 text-sm font-medium">
          Priority <span className="font-normal text-muted">(optional)</span>
        </legend>
        <div className="grid grid-cols-3 gap-2">
          {options.map((option) => {
            const selected = priority === option;
            return (
              <button
                key={option}
                type="button"
                aria-pressed={selected}
                onClick={() => setPriority(selected ? null : option)}
                className={`min-h-11 rounded-xl text-sm font-medium capitalize ${
                  selected
                    ? "bg-accent text-white dark:text-neutral-950"
                    : "bg-background"
                }`}
              >
                {option}
              </button>
            );
          })}
        </div>
      </fieldset>
      {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}
      <button
        type="submit"
        disabled={disabled || saving || title.trim().length === 0}
        className="min-h-12 w-full rounded-xl bg-accent text-base font-semibold text-white disabled:opacity-60 dark:text-neutral-950"
      >
        {saving ? "Adding…" : "Add task"}
      </button>
    </form>
  );
}
