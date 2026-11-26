"use client";

import { useEffect, useState } from "react";
import type { GoalMetric } from "@/types";
import { createClient } from "@/lib/supabase/client";
import { formatAmount, metricLabel, type PeriodCounts } from "@/lib/goals";

interface Member {
  user_id: string;
  household_id: string;
  display_name: string;
  email: string;
  share_summary: boolean;
}

interface FamilySummary {
  tasks: PeriodCounts;
  workout_minutes: PeriodCounts;
  workouts: PeriodCounts;
  pages: PeriodCounts;
  steps: PeriodCounts;
  goals: { metric: GoalMetric; weekly_target: number | null; monthly_target: number | null }[];
}

const OPEN_KEY = "daily-hub-family-open";
const dayLabels = ["M", "T", "W", "T", "F", "S", "S"];

const listeners = new Set<() => void>();

function readOpen(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(OPEN_KEY) ?? "[]") as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function writeOpen(next: string[]) {
  localStorage.setItem(OPEN_KEY, JSON.stringify(next));
  listeners.forEach((listener) => listener());
}

function subscribeOpen(onChange: () => void) {
  listeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function friendlyError(message: string): string {
  if (/household|schema cache|does not exist|function/i.test(message)) {
    return "Adding someone needs one more script in Supabase. Paste the latest family script, run it, and reload.";
  }
  if (/jwt|not authenticated|invalid claim/i.test(message)) return "Your session expired. Sign in again.";
  return message;
}

function counts(value: unknown): PeriodCounts {
  const row = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const days = Array.isArray(row.weekDays) ? row.weekDays.map((item) => Number(item) || 0) : [];
  while (days.length < 7) days.push(0);
  return {
    today: Number(row.today) || 0,
    week: Number(row.week) || 0,
    month: Number(row.month) || 0,
    weekDays: days.slice(0, 7),
  };
}

function asSummary(value: unknown): FamilySummary {
  const row = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const goals = Array.isArray(row.goals) ? row.goals : [];
  return {
    tasks: counts(row.tasks),
    workout_minutes: counts(row.workout_minutes),
    workouts: counts(row.workouts),
    pages: counts(row.pages),
    steps: counts(row.steps),
    goals: goals.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const goal = item as Record<string, unknown>;
      const metric = goal.metric;
      if (metric !== "tasks" && metric !== "workout_minutes" && metric !== "workouts" && metric !== "pages" && metric !== "steps") {
        return [];
      }
      return [
        {
          metric,
          weekly_target: goal.weekly_target == null ? null : Number(goal.weekly_target),
          monthly_target: goal.monthly_target == null ? null : Number(goal.monthly_target),
        },
      ];
    }),
  };
}

function displayName(user: { email?: string | null; user_metadata?: Record<string, unknown> }): string {
  const saved = user.user_metadata?.display_name;
  if (typeof saved === "string" && saved.trim()) return saved.trim().slice(0, 40);
  const email = user.email ?? "";
  return email.split("@")[0] || "Me";
}

export default function FamilyBoard({ todayKey }: { todayKey: string }) {
  const [me, setMe] = useState<string | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<{ email: string; display_name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [openIds, setOpenIds] = useState<string[]>([]);
  const [summaries, setSummaries] = useState<Record<string, { summary?: FamilySummary; error?: string }>>({});

  useEffect(() => {
    if (!todayKey) return;
    let cancelled = false;
    async function run() {
      try {
        const people = await loadFamily();
        if (cancelled) return;
        setMe(people.me);
        setMembers(people.members);
        setInvites(people.invites);
        setOpenIds(readOpen());
        setError(null);
      } catch (loadError) {
        if (cancelled) return;
        const message = loadError instanceof Error ? loadError.message : "Could not load your family.";
        setError(friendlyError(message));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [todayKey]);

  useEffect(() => subscribeOpen(() => setOpenIds(readOpen())), []);

  const openKey = openIds.join(",");

  useEffect(() => {
    if (!todayKey || !openKey) return;
    const ids = openKey.split(",");
    let cancelled = false;
    async function run() {
      const supabase = createClient();
      const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const next: Record<string, { summary?: FamilySummary; error?: string }> = {};
      await Promise.all(
        ids.map(async (id) => {
          const { data, error: rpcError } = await supabase.rpc("household_summary", {
            target: id,
            today: todayKey,
            tz: zone,
          });
          if (rpcError) next[id] = { error: friendlyError(rpcError.message) };
          else next[id] = { summary: asSummary(data) };
        }),
      );
      if (!cancelled) setSummaries(next);
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [todayKey, openKey]);

  async function reload() {
    const people = await loadFamily();
    setMe(people.me);
    setMembers(people.members);
    setInvites(people.invites);
  }

  async function setSharing(share: boolean) {
    if (!me) return;
    const { error: updateError } = await createClient()
      .from("household_members")
      .update({ share_summary: share })
      .eq("user_id", me);
    if (updateError) {
      setError(friendlyError(updateError.message));
      return;
    }
    setMembers((current) => current.map((member) => (member.user_id === me ? { ...member, share_summary: share } : member)));
  }

  function toggleSummary(id: string) {
    const next = openIds.includes(id) ? openIds.filter((item) => item !== id) : [...openIds, id];
    writeOpen(next);
  }

  const others = members.filter((member) => member.user_id !== me);
  const mine = members.find((member) => member.user_id === me);

  return (
    <section className="mb-5 rounded-2xl bg-card p-4">
      <h2 className="font-semibold">Family</h2>
      <p className="mt-1 text-sm text-muted">
        Each person has their own tasks, workouts, and books. Share a summary only if you want the others to see it.
      </p>
      {loading ? <div className="mt-3 h-16 animate-pulse rounded-xl bg-background" /> : null}
      {error ? <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p> : null}
      {mine ? (
        <button
          type="button"
          aria-pressed={mine.share_summary}
          onClick={() => void setSharing(!mine.share_summary)}
          className={`mt-3 min-h-12 w-full rounded-xl text-sm font-semibold ${
            mine.share_summary ? "bg-accent text-white dark:text-neutral-950" : "bg-background"
          }`}
        >
          {mine.share_summary ? "My summary is shared" : "Share my summary"}
        </button>
      ) : null}
      {others.length === 0 && invites.length === 0 && !loading ? (
        <p className="mt-3 text-sm text-muted">No one else is in your family yet.</p>
      ) : (
        <ul className="mt-3 space-y-3">
          {invites.map((invite) => (
            <li key={invite.email} className="rounded-xl bg-background p-3">
              <p className="font-medium break-words">{invite.display_name}</p>
              <p className="text-sm text-muted break-all">{invite.email}</p>
              <p className="mt-1 text-sm text-muted">Waiting for them to set a password.</p>
            </li>
          ))}
          {others.map((member) => {
            const open = openIds.includes(member.user_id);
            const card = summaries[member.user_id];
            return (
              <li key={member.user_id} className="rounded-xl bg-background p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium break-words">{member.display_name}</p>
                    <p className="text-sm text-muted break-all">{member.email}</p>
                  </div>
                  {member.share_summary ? (
                    <button
                      type="button"
                      onClick={() => toggleSummary(member.user_id)}
                      className="min-h-11 shrink-0 text-sm font-medium text-accent"
                    >
                      {open ? "Hide" : "Show summary"}
                    </button>
                  ) : (
                    <p className="text-sm text-muted">Not shared</p>
                  )}
                </div>
                {open && member.share_summary ? (
                  card?.error ? (
                    <p className="mt-2 text-sm text-red-600 dark:text-red-400">{card.error}</p>
                  ) : card?.summary ? (
                    <SummaryCard summary={card.summary} />
                  ) : (
                    <div className="mt-2 h-16 animate-pulse rounded-xl bg-card" />
                  )
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      <button
        type="button"
        onClick={() => setAdding((open) => !open)}
        className="mt-4 min-h-12 w-full rounded-xl bg-background text-sm font-semibold"
      >
        {adding ? "Close" : "Add someone"}
      </button>
      {adding ? (
        <AddPerson
          onAdded={async () => {
            await reload();
            setAdding(false);
          }}
        />
      ) : null}
    </section>
  );
}

function SummaryCard({ summary }: { summary: FamilySummary }) {
  const lines: { metric: GoalMetric; count: PeriodCounts }[] = [
    { metric: "tasks", count: summary.tasks },
    { metric: "workout_minutes", count: summary.workout_minutes },
    { metric: "pages", count: summary.pages },
    { metric: "steps", count: summary.steps },
  ];
  const peak = Math.max(...summary.tasks.weekDays, 1);
  return (
    <div className="mt-3 space-y-2">
      {lines.map(({ metric, count }) => {
        const weekly = summary.goals.find((goal) => goal.metric === metric)?.weekly_target;
        const weekText =
          weekly == null ? formatAmount(metric, count.week) : `${formatAmount(metric, count.week)} of ${formatAmount(metric, weekly)}`;
        return (
          <p key={metric} className="text-sm">
            <span className="font-medium">{metricLabel(metric)}</span>
            <span className="text-muted">
              {" "}
              · today {formatAmount(metric, count.today)} · week {weekText}
            </span>
          </p>
        );
      })}
      <div className="flex h-16 items-end gap-1 pt-1" aria-hidden>
        {summary.tasks.weekDays.map((amount, index) => (
          <div key={dayLabels[index] + index} className="flex flex-1 flex-col items-center gap-1">
            <div className="flex h-10 w-full items-end">
              <div
                className={`w-full rounded-sm ${amount === 0 ? "bg-foreground/15" : "bg-accent"}`}
                style={{ height: `${Math.max(Math.round((amount / peak) * 100), amount > 0 ? 12 : 6)}%` }}
              />
            </div>
            <span className="text-[10px] text-muted">{dayLabels[index]}</span>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted">Tasks finished this week.</p>
    </div>
  );
}

function AddPerson({ onAdded }: { onAdded: () => Promise<void> }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const { error: rpcError } = await createClient().rpc("add_family_member", {
        member_email: email.trim(),
        member_name: name.trim(),
      });
      if (rpcError) throw new Error(friendlyError(rpcError.message));
      setName("");
      setEmail("");
      await onAdded();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Could not add them.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-3 space-y-3">
      <p className="text-sm text-muted">
        Add the email they gave you. They open the app, tap Set your password, and choose it themselves.
      </p>
      <input
        value={name}
        onChange={(event) => setName(event.target.value)}
        maxLength={40}
        placeholder="Name"
        aria-label="Name"
        className="w-full min-h-12 rounded-xl bg-background px-4 text-base outline-none focus:ring-2 focus:ring-accent"
      />
      <input
        type="email"
        required
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        placeholder="Email"
        aria-label="Email"
        className="w-full min-h-12 rounded-xl bg-background px-4 text-base outline-none focus:ring-2 focus:ring-accent"
      />
      {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}
      <button
        type="submit"
        disabled={saving || !email.trim()}
        className="min-h-12 w-full rounded-xl bg-accent text-base font-semibold text-white disabled:opacity-60 dark:text-neutral-950"
      >
        {saving ? "Adding…" : "Add to family"}
      </button>
    </form>
  );
}

async function loadFamily(): Promise<{ me: string; members: Member[]; invites: { email: string; display_name: string }[] }> {
  const supabase = createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) throw new Error(userError?.message ?? "Sign in again.");

  const columns = "user_id, household_id, display_name, email, share_summary";
  const existing = await supabase.from("household_members").select(columns).eq("user_id", user.id).maybeSingle();
  if (existing.error) throw new Error(existing.error.message);

  let mine = existing.data as Member | null;
  if (!mine) {
    const created = await supabase.from("households").insert({}).select("id").single();
    if (created.error) throw new Error(created.error.message);
    const inserted = await supabase
      .from("household_members")
      .insert({
        household_id: created.data.id,
        user_id: user.id,
        display_name: displayName(user),
        email: user.email ?? "",
      })
      .select(columns)
      .single();
    if (inserted.error) throw new Error(inserted.error.message);
    mine = inserted.data as Member;
  }

  const people = await supabase.from("household_members").select(columns).eq("household_id", mine.household_id);
  if (people.error) throw new Error(people.error.message);
  const invites = await supabase
    .from("household_invites")
    .select("email, display_name")
    .eq("household_id", mine.household_id);
  if (invites.error) throw new Error(invites.error.message);
  return {
    me: user.id,
    members: (people.data ?? []) as Member[],
    invites: (invites.data ?? []) as { email: string; display_name: string }[],
  };
}
