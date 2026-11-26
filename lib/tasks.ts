import type { Task } from "@/types";

export function sortTasks(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    if (a.position !== b.position) return a.position - b.position;
    return a.created_at.localeCompare(b.created_at);
  });
}

/** Move a task one step inside its open or done group and rewrite positions. */
export function moveTask(tasks: Task[], id: string, direction: -1 | 1): Task[] {
  const sorted = sortTasks(tasks);
  const index = sorted.findIndex((task) => task.id === id);
  if (index < 0) return tasks;
  const target = index + direction;
  const neighbor = sorted[target];
  if (!neighbor || neighbor.done !== sorted[index].done) return tasks;

  const next = sorted.slice();
  next[index] = neighbor;
  next[target] = sorted[index];
  return next.map((task, position) =>
    task.position === position ? task : { ...task, position },
  );
}
