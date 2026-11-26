// Small date helpers used across tabs.

/** Local date as YYYY-MM-DD. */
export function toDayKey(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Monday of the week containing `d`. */
export function startOfWeek(d: Date = new Date()): Date {
  const copy = new Date(d);
  const diff = (copy.getDay() + 6) % 7;
  copy.setDate(copy.getDate() - diff);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

export function addDays(d: Date, n: number): Date {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + n);
  return copy;
}

/** Parse a YYYY-MM-DD key as a local calendar date. */
export function parseDayKey(key: string): Date {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, (month ?? 1) - 1, day ?? 1);
}

export function relativeDayLabel(key: string, today = toDayKey()): string {
  if (key === today) return "Today";
  if (key === toDayKey(addDays(parseDayKey(today), -1))) return "Yesterday";
  if (key === toDayKey(addDays(parseDayKey(today), 1))) return "Tomorrow";
  return parseDayKey(key).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function formatLongDate(key: string): string {
  return parseDayKey(key).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}
