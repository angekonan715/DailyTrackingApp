"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import type { Hobby, HobbySession } from "@/types";
import PageHeader from "@/components/PageHeader";
import EmptyState from "@/components/EmptyState";
import SetupNotice from "@/components/SetupNotice";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { formatLongDate, toDayKey } from "@/lib/dates";

function friendlyError(message: string): string {
  if (/hobby|schema cache|does not exist|relation/i.test(message)) {
    return "Hobbies are not set up yet. In Supabase, open the SQL Editor, paste the hobbies script, and run it.";
  }
  if (/jwt|not authenticated|invalid claim/i.test(message)) return "Your session expired. Sign in again.";
  return message;
}

export default function HobbiesBoard() {
  if (!isSupabaseConfigured()) {
    return (
      <>
        <PageHeader title="Hobby" />
        <SetupNotice />
      </>
    );
  }
  return <HobbyScreen />;
}

function subscribeToday() {
  return () => {};
}

function HobbyScreen() {
  const todayKey = useSyncExternalStore(subscribeToday, toDayKey, () => "");
  const [hobbies, setHobbies] = useState<Hobby[]>([]);
  const [sessions, setSessions] = useState<HobbySession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      try {
        const loaded = await loadHobbies();
        if (cancelled) return;
        setHobbies(loaded.hobbies);
        setSessions(loaded.sessions);
        setError(null);
      } catch (loadError) {
        if (cancelled) return;
        const message = loadError instanceof Error ? loadError.message : "Could not load hobbies.";
        setError(friendlyError(message));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  async function reload() {
    const loaded = await loadHobbies();
    setHobbies(loaded.hobbies);
    setSessions(loaded.sessions);
  }

  async function logSession(hobbyId: string, note: string) {
    const day = toDayKey();
    const { error: insertError } = await createClient().from("hobby_sessions").insert({
      hobby_id: hobbyId,
      day,
      note: note.trim() || null,
    });
    if (insertError) {
      setError(friendlyError(insertError.message));
      return;
    }
    await reload();
  }

  async function removeHobby(hobby: Hobby) {
    setHobbies((current) => current.filter((item) => item.id !== hobby.id));
    const { error: deleteError } = await createClient().from("hobbies").delete().eq("id", hobby.id);
    if (deleteError) {
      setError(friendlyError(deleteError.message));
      await reload();
    }
  }

  return (
    <>
      <PageHeader title="Hobby" subtitle="Things you enjoy, and the days you spend on them." />
      {error ? <p className="mb-4 text-sm text-red-600 dark:text-red-400">{error}</p> : null}
      {loading ? <div className="h-24 animate-pulse rounded-2xl bg-card" /> : null}
      {!loading && hobbies.length === 0 && !adding ? (
        <EmptyState title="No hobbies yet" hint="Add something you like to do, then mark the days you do it." />
      ) : null}
      <ul className="space-y-3">
        {hobbies.map((hobby) => (
          <HobbyCard
            key={hobby.id}
            hobby={hobby}
            sessions={sessions.filter((session) => session.hobby_id === hobby.id)}
            todayKey={todayKey}
            onLog={logSession}
            onDelete={() => void removeHobby(hobby)}
          />
        ))}
      </ul>
      <button
        type="button"
        onClick={() => setAdding((open) => !open)}
        className="mt-4 min-h-12 w-full rounded-xl bg-accent text-base font-semibold text-white dark:text-neutral-950"
      >
        {adding ? "Close" : "Add a hobby"}
      </button>
      {adding ? (
        <AddHobby
          onAdded={async () => {
            await reload();
            setAdding(false);
          }}
        />
      ) : null}
    </>
  );
}

function HobbyCard({
  hobby,
  sessions,
  todayKey,
  onLog,
  onDelete,
}: {
  hobby: Hobby;
  sessions: HobbySession[];
  todayKey: string;
  onLog: (hobbyId: string, note: string) => Promise<void>;
  onDelete: () => void;
}) {
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const latest = sessions[0];
  const didToday = Boolean(todayKey) && sessions.some((session) => session.day === todayKey);

  async function save() {
    setSaving(true);
    await onLog(hobby.id, note);
    setNote("");
    setSaving(false);
  }

  return (
    <li className="rounded-2xl bg-card p-4">
      <p className="font-semibold break-words">{hobby.name}</p>
      {hobby.note ? <p className="mt-1 text-sm text-muted break-words">{hobby.note}</p> : null}
      <p className="mt-2 text-sm text-muted">
        {latest ? `Last time: ${formatLongDate(latest.day)}` : "Not logged yet"}
        {didToday ? " · Done today" : ""}
      </p>
      <label className="mt-3 block text-sm font-medium" htmlFor={`hobby-note-${hobby.id}`}>
        What you did
      </label>
      <input
        id={`hobby-note-${hobby.id}`}
        value={note}
        onChange={(event) => setNote(event.target.value)}
        maxLength={500}
        placeholder="Optional"
        className="mt-1 w-full min-h-12 rounded-xl bg-background px-4 text-base outline-none focus:ring-2 focus:ring-accent"
      />
      <button
        type="button"
        onClick={() => void save()}
        disabled={saving}
        className="mt-3 min-h-12 w-full rounded-xl bg-accent text-sm font-semibold text-white disabled:opacity-60 dark:text-neutral-950"
      >
        {saving ? "Saving…" : "I did this"}
      </button>
      {sessions.slice(0, 3).length > 0 ? (
        <ul className="mt-3 space-y-1">
          {sessions.slice(0, 3).map((session) => (
            <li key={session.id} className="text-sm text-muted">
              {formatLongDate(session.day)}
              {session.note ? ` · ${session.note}` : ""}
            </li>
          ))}
        </ul>
      ) : null}
      {confirming ? (
        <div className="mt-3 flex gap-2">
          <button type="button" onClick={onDelete} className="min-h-11 flex-1 rounded-xl bg-red-600 text-sm font-semibold text-white">
            Delete
          </button>
          <button type="button" onClick={() => setConfirming(false)} className="min-h-11 flex-1 rounded-xl bg-background text-sm font-medium">
            Cancel
          </button>
        </div>
      ) : (
        <button type="button" onClick={() => setConfirming(true)} className="mt-2 min-h-11 text-sm font-medium text-red-600 dark:text-red-400">
          Delete
        </button>
      )}
    </li>
  );
}

function AddHobby({ onAdded }: { onAdded: () => Promise<void> }) {
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setSaving(true);
    setError(null);
    const { error: insertError } = await createClient()
      .from("hobbies")
      .insert({ name: trimmed, note: note.trim() || null });
    setSaving(false);
    if (insertError) {
      setError(friendlyError(insertError.message));
      return;
    }
    setName("");
    setNote("");
    await onAdded();
  }

  return (
    <form onSubmit={submit} className="mt-3 space-y-3 rounded-2xl bg-card p-4">
      <label className="block text-sm font-medium" htmlFor="hobby-name">
        Hobby
      </label>
      <input
        id="hobby-name"
        value={name}
        onChange={(event) => setName(event.target.value)}
        maxLength={80}
        placeholder="Guitar, gardening, cooking"
        className="w-full min-h-12 rounded-xl bg-background px-4 text-base outline-none focus:ring-2 focus:ring-accent"
      />
      <label className="block text-sm font-medium" htmlFor="hobby-about">
        Why you enjoy it
      </label>
      <textarea
        id="hobby-about"
        value={note}
        onChange={(event) => setNote(event.target.value)}
        rows={2}
        maxLength={500}
        placeholder="Optional"
        className="w-full rounded-xl bg-background px-4 py-3 text-base outline-none focus:ring-2 focus:ring-accent"
      />
      {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}
      <button
        type="submit"
        disabled={saving || name.trim().length === 0}
        className="min-h-12 w-full rounded-xl bg-accent text-base font-semibold text-white disabled:opacity-60 dark:text-neutral-950"
      >
        {saving ? "Adding…" : "Add hobby"}
      </button>
    </form>
  );
}

async function loadHobbies(): Promise<{ hobbies: Hobby[]; sessions: HobbySession[] }> {
  const supabase = createClient();
  const [hobbies, sessions] = await Promise.all([
    supabase.from("hobbies").select("id, user_id, name, note, created_at").order("created_at", { ascending: true }),
    supabase
      .from("hobby_sessions")
      .select("id, user_id, hobby_id, day, note, created_at")
      .order("day", { ascending: false })
      .limit(200),
  ]);
  const error = hobbies.error ?? sessions.error;
  if (error) throw new Error(error.message);
  return {
    hobbies: (hobbies.data ?? []) as Hobby[],
    sessions: (sessions.data ?? []) as HobbySession[],
  };
}
