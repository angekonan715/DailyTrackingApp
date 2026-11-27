"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { explainNotesError } from "@/lib/notes";

interface FolderChoice {
  id: string;
  label: string;
}

export default function NoteEditor({
  noteId,
  context,
  folderId,
  folders,
  onBack,
  onDeleted,
}: {
  noteId: string;
  context?: string;
  folderId?: string | null;
  folders?: FolderChoice[];
  onBack: () => void;
  onDeleted: () => void;
}) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [status, setStatus] = useState("Loading…");
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const ready = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ title: "", body: "" });
  const [home, setHome] = useState(folderId ?? "");

  useEffect(() => {
    let cancelled = false;
    ready.current = false;
    async function run() {
      const { data, error: loadError } = await createClient()
        .from("notes")
        .select("title, body")
        .eq("id", noteId)
        .maybeSingle();
      if (cancelled) return;
      if (loadError || !data) {
        setError(explainNotesError(loadError?.message ?? "That note is gone."));
        setStatus("");
        return;
      }
      const nextTitle = typeof data.title === "string" ? data.title : "";
      const nextBody = typeof data.body === "string" ? data.body : "";
      latest.current = { title: nextTitle, body: nextBody };
      setTitle(nextTitle);
      setBody(nextBody);
      ready.current = true;
      setStatus("Saved");
    }
    void run();
    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
      if (!ready.current) return;
      const snapshot = latest.current;
      void createClient()
        .from("notes")
        .update({
          title: snapshot.title.slice(0, 200),
          body: snapshot.body.slice(0, 40000),
          updated_at: new Date().toISOString(),
        })
        .eq("id", noteId);
    };
  }, [noteId]);

  function schedule(nextTitle: string, nextBody: string) {
    latest.current = { title: nextTitle, body: nextBody };
    setStatus("Saving…");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void persist(nextTitle, nextBody);
    }, 500);
  }

  async function persist(nextTitle: string, nextBody: string) {
    const { error: saveError } = await createClient()
      .from("notes")
      .update({
        title: nextTitle.slice(0, 200),
        body: nextBody.slice(0, 40000),
        updated_at: new Date().toISOString(),
      })
      .eq("id", noteId);
    if (saveError) {
      setError(explainNotesError(saveError.message));
      setStatus("Not saved");
      return;
    }
    setError(null);
    setStatus("Saved");
  }

  async function move(nextFolder: string) {
    const folder = nextFolder || null;
    setHome(nextFolder);
    setStatus("Saving…");
    const { error: moveError } = await createClient()
      .from("notes")
      .update({ folder_id: folder, updated_at: new Date().toISOString() })
      .eq("id", noteId);
    if (moveError) {
      setError(explainNotesError(moveError.message));
      setStatus("Not saved");
      return;
    }
    setStatus("Saved");
  }

  async function remove() {
    setRemoving(true);
    ready.current = false;
    const { error: deleteError } = await createClient().from("notes").delete().eq("id", noteId);
    if (deleteError) {
      ready.current = true;
      setRemoving(false);
      setError(explainNotesError(deleteError.message));
      return;
    }
    onDeleted();
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <button type="button" onClick={onBack} className="min-h-12 px-1 text-base font-medium text-accent">
          Back
        </button>
        <p className="text-sm text-muted">{status}</p>
      </div>
      <section className="rounded-3xl bg-[#fffdf8] px-5 py-6 text-slate-900 shadow-[0_18px_50px_rgba(0,0,0,0.28)]">
        {context ? <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{context}</p> : null}
        <label className="sr-only" htmlFor="note-title">
          Title
        </label>
        <input
          id="note-title"
          value={title}
          onChange={(event) => {
            const next = event.target.value;
            setTitle(next);
            if (ready.current) schedule(next, latest.current.body);
          }}
          maxLength={200}
          placeholder="Title"
          className="mt-1 w-full bg-transparent text-2xl font-semibold outline-none placeholder:text-slate-400"
        />
        <label className="sr-only" htmlFor="note-body">
          Note
        </label>
        <textarea
          id="note-body"
          value={body}
          onChange={(event) => {
            const next = event.target.value;
            setBody(next);
            if (ready.current) schedule(latest.current.title, next);
          }}
          maxLength={40000}
          placeholder="Write here"
          className="mt-4 min-h-[58vh] w-full resize-none bg-transparent text-lg leading-8 outline-none placeholder:text-slate-400"
        />
      </section>
      {folders ? (
        <label className="mt-4 block text-sm font-medium">
          Folder
          <select
            value={home}
            onChange={(event) => void move(event.target.value)}
            className="mt-1 min-h-12 w-full rounded-xl bg-card px-4 text-base outline-none focus:ring-2 focus:ring-accent"
          >
            <option value="">Notes</option>
            {folders.map((folder) => (
              <option key={folder.id} value={folder.id}>
                {folder.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {error ? <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p> : null}
      <div className="mt-4">
        {confirming ? (
          <div className="flex gap-3">
            <button type="button" disabled={removing} onClick={() => void remove()} className="min-h-12 font-medium text-red-600 dark:text-red-400">
              {removing ? "Deleting…" : "Delete note"}
            </button>
            <button type="button" onClick={() => setConfirming(false)} className="min-h-12 text-muted">
              Cancel
            </button>
          </div>
        ) : (
          <button type="button" onClick={() => setConfirming(true)} className="min-h-12 text-sm text-muted">
            Delete
          </button>
        )}
      </div>
    </div>
  );
}
