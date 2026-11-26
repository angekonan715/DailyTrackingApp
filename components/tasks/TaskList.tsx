"use client";

import { useEffect, useRef, useState } from "react";
import type { Priority, Task } from "@/types";
import { moveTask } from "@/lib/tasks";

const PRIORITY_LABEL: Record<Priority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
};

const PRIORITY_BAR: Record<Priority, string> = {
  low: "border-l-emerald-500",
  medium: "border-l-amber-500",
  high: "border-l-red-500",
};

type Draft = {
  title: string;
  note: string;
  priority: Priority | null;
};

export default function TaskList({
  tasks,
  onToggle,
  onDelete,
  onSave,
  onPreview,
  onCommit,
}: {
  tasks: Task[];
  onToggle: (task: Task) => void;
  onDelete: (task: Task) => void;
  onSave: (task: Task, draft: Draft) => Promise<void>;
  onPreview: (next: Task[]) => void;
  onCommit: (next: Task[]) => void;
}) {
  const open = tasks.filter((task) => !task.done);
  const done = tasks.filter((task) => task.done);

  return (
    <div className="space-y-6">
      {open.length > 0 ? (
        <Group
          label={done.length > 0 ? "To do" : ""}
          tasks={open}
          allTasks={tasks}
          onToggle={onToggle}
          onDelete={onDelete}
          onSave={onSave}
          onPreview={onPreview}
          onCommit={onCommit}
        />
      ) : null}
      {done.length > 0 ? (
        <Group
          label="Done"
          tasks={done}
          allTasks={tasks}
          onToggle={onToggle}
          onDelete={onDelete}
          onSave={onSave}
          onPreview={onPreview}
          onCommit={onCommit}
        />
      ) : null}
    </div>
  );
}

function Group({
  label,
  tasks,
  allTasks,
  onToggle,
  onDelete,
  onSave,
  onPreview,
  onCommit,
}: {
  label: string;
  tasks: Task[];
  allTasks: Task[];
  onToggle: (task: Task) => void;
  onDelete: (task: Task) => void;
  onSave: (task: Task, draft: Draft) => Promise<void>;
  onPreview: (next: Task[]) => void;
  onCommit: (next: Task[]) => void;
}) {
  const tasksRef = useRef(allTasks);
  const dragging = useRef(false);

  useEffect(() => {
    if (!dragging.current) tasksRef.current = allTasks;
  }, [allTasks]);

  const drag = useRef<{
    id: string;
    startY: number;
    height: number;
    moved: boolean;
  } | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [lift, setLift] = useState(0);

  function finishDrag() {
    const current = drag.current;
    drag.current = null;
    dragging.current = false;
    setActiveId(null);
    setLift(0);
    if (current?.moved) onCommit(tasksRef.current);
  }

  function onPointerDown(event: React.PointerEvent<HTMLButtonElement>, id: string) {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const row = event.currentTarget.closest("[data-task-id]");
    const height = row instanceof HTMLElement ? row.getBoundingClientRect().height : 72;
    dragging.current = true;
    tasksRef.current = allTasks;
    drag.current = { id, startY: event.clientY, height, moved: false };
    setActiveId(id);
    setLift(0);
  }

  function onPointerMove(event: React.PointerEvent<HTMLButtonElement>) {
    const current = drag.current;
    if (!current) return;
    const dy = event.clientY - current.startY;
    const threshold = Math.max(36, current.height * 0.55);
    if (Math.abs(dy) >= threshold) {
      const next = moveTask(tasksRef.current, current.id, dy > 0 ? 1 : -1);
      if (next !== tasksRef.current) {
        tasksRef.current = next;
        current.moved = true;
        current.startY = event.clientY;
        onPreview(next);
        setLift(0);
        return;
      }
    }
    setLift(dy);
  }

  return (
    <section>
      {label ? <h2 className="mb-2 text-sm font-medium text-muted">{label}</h2> : null}
      <ul className="space-y-2">
        {tasks.map((task) => (
          <TaskRow
            key={task.id}
            task={task}
            lifted={activeId === task.id ? lift : 0}
            active={activeId === task.id}
            onToggle={onToggle}
            onDelete={onDelete}
            onSave={onSave}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={finishDrag}
          />
        ))}
      </ul>
    </section>
  );
}

function TaskRow({
  task,
  lifted,
  active,
  onToggle,
  onDelete,
  onSave,
  onPointerDown,
  onPointerMove,
  onPointerUp,
}: {
  task: Task;
  lifted: number;
  active: boolean;
  onToggle: (task: Task) => void;
  onDelete: (task: Task) => void;
  onSave: (task: Task, draft: Draft) => Promise<void>;
  onPointerDown: (event: React.PointerEvent<HTMLButtonElement>, id: string) => void;
  onPointerMove: (event: React.PointerEvent<HTMLButtonElement>) => void;
  onPointerUp: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [draft, setDraft] = useState<Draft>({
    title: task.title,
    note: task.note ?? "",
    priority: task.priority,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const title = draft.title.trim();
    if (!title) {
      setError("Add a title first.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(task, { ...draft, title });
      setEditing(false);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <li
      data-task-id={task.id}
      className={`rounded-2xl bg-card border-l-4 ${
        task.priority ? PRIORITY_BAR[task.priority] : "border-l-transparent"
      } ${active ? "relative z-10 shadow-lg" : ""}`}
      style={active ? { transform: `translateY(${lifted}px)` } : undefined}
    >
      {editing ? (
        <div className="space-y-3 p-3">
          <input
            value={draft.title}
            onChange={(event) => setDraft({ ...draft, title: event.target.value })}
            maxLength={200}
            aria-label="Title"
            className="w-full min-h-12 rounded-xl bg-background px-3 text-base outline-none focus:ring-2 focus:ring-accent"
          />
          <textarea
            value={draft.note}
            onChange={(event) => setDraft({ ...draft, note: event.target.value })}
            rows={2}
            maxLength={1000}
            aria-label="Note"
            placeholder="Note (optional)"
            className="w-full rounded-xl bg-background px-3 py-3 text-base outline-none focus:ring-2 focus:ring-accent"
          />
          <PriorityChips
            value={draft.priority}
            onChange={(priority) => setDraft({ ...draft, priority })}
          />
          {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setError(null);
              }}
              className="min-h-12 flex-1 rounded-xl bg-background text-sm font-medium"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="min-h-12 flex-1 rounded-xl bg-accent text-sm font-semibold text-white disabled:opacity-60 dark:text-neutral-950"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-stretch">
          <button
            type="button"
            role="checkbox"
            aria-checked={task.done}
            aria-label={task.done ? `Mark not done: ${task.title}` : `Mark done: ${task.title}`}
            onClick={() => onToggle(task)}
            className="flex w-14 shrink-0 items-center justify-center"
          >
            <span
              className={`flex h-7 w-7 items-center justify-center rounded-md border-2 text-sm ${
                task.done
                  ? "border-accent bg-accent text-white dark:text-neutral-950"
                  : "border-muted"
              }`}
            >
              {task.done ? "✓" : ""}
            </span>
          </button>

          <div className="min-w-0 flex-1 py-3 pr-1">
            <p className={`font-medium break-words ${task.done ? "text-muted line-through" : ""}`}>
              {task.title}
            </p>
            {task.note ? (
              <p className="mt-1 text-sm text-muted break-words">{task.note}</p>
            ) : null}
            {task.priority ? (
              <p className="mt-2">
                <span className="rounded-full bg-background px-2 py-1 text-xs font-medium">
                  {PRIORITY_LABEL[task.priority]}
                </span>
              </p>
            ) : null}
            {confirming ? (
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => onDelete(task)}
                  className="min-h-11 rounded-xl bg-red-600 px-3 text-sm font-semibold text-white"
                >
                  Delete
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  className="min-h-11 rounded-xl bg-background px-3 text-sm font-medium"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div className="mt-1 flex gap-1">
                <button
                  type="button"
                  onClick={() => {
                    setDraft({
                      title: task.title,
                      note: task.note ?? "",
                      priority: task.priority,
                    });
                    setEditing(true);
                  }}
                  className="min-h-11 px-2 text-sm font-medium text-accent"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(true)}
                  className="min-h-11 px-2 text-sm font-medium text-red-600 dark:text-red-400"
                >
                  Delete
                </button>
              </div>
            )}
          </div>

          <button
            type="button"
            data-no-swipe
            aria-label={`Reorder ${task.title}`}
            onPointerDown={(event) => onPointerDown(event, task.id)}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            className="flex w-12 shrink-0 touch-none items-center justify-center text-lg text-muted"
            style={{ touchAction: "none" }}
          >
            ⋮⋮
          </button>
        </div>
      )}
    </li>
  );
}

function PriorityChips({
  value,
  onChange,
}: {
  value: Priority | null;
  onChange: (priority: Priority | null) => void;
}) {
  const options: Priority[] = ["low", "medium", "high"];
  return (
    <div className="grid grid-cols-3 gap-2">
      {options.map((option) => {
        const selected = value === option;
        return (
          <button
            key={option}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(selected ? null : option)}
            className={`min-h-11 rounded-xl text-sm font-medium ${
              selected
                ? "bg-accent text-white dark:text-neutral-950"
                : "bg-background text-foreground"
            }`}
          >
            {PRIORITY_LABEL[option]}
          </button>
        );
      })}
    </div>
  );
}

export type { Draft as TaskDraft };
