const KEY = "daily-hub-carried-tasks";
const EMPTY: string[] = [];

export function carriedOnServer(): string[] {
  return EMPTY;
}

let raw = "";
let cache: string[] = EMPTY;
const listeners = new Set<() => void>();

export function subscribeCarried(onChange: () => void) {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

/** Task ids moved onto a later day by Carry over. Stable between writes. */
export function readCarried(): string[] {
  if (typeof localStorage === "undefined") return EMPTY;
  const next = localStorage.getItem(KEY) ?? "[]";
  if (next === raw) return cache;
  raw = next;
  try {
    const parsed = JSON.parse(next) as unknown;
    cache = Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : EMPTY;
  } catch {
    cache = EMPTY;
  }
  return cache;
}

export function rememberCarried(ids: string[]) {
  const next = Array.from(new Set([...readCarried(), ...ids]));
  const text = JSON.stringify(next);
  localStorage.setItem(KEY, text);
  raw = text;
  cache = next;
  listeners.forEach((listener) => listener());
}
