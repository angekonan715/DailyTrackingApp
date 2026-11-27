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
  const paper = useRef<HTMLDivElement | null>(null);
  const ready = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ title: "", body: "" });
  const [marks, setMarks] = useState({ bold: false, italic: false });
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
      if (paper.current) paper.current.innerHTML = editorHtml(nextBody);
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

  useEffect(() => {
    function sync() {
      const page = paper.current;
      const selection = document.getSelection();
      if (!page || !selection?.anchorNode || !page.contains(selection.anchorNode)) return;
      try {
        setMarks({
          bold: document.queryCommandState("bold"),
          italic: document.queryCommandState("italic"),
        });
      } catch {
        setMarks({ bold: false, italic: false });
      }
    }
    document.addEventListener("selectionchange", sync);
    return () => document.removeEventListener("selectionchange", sync);
  }, []);

  function capture() {
    const html = sanitizeNoteHtml(paper.current?.innerHTML ?? "");
    setBody(html);
    if (ready.current) schedule(latest.current.title, html);
  }

  function apply(command: string, value?: string) {
    paper.current?.focus();
    document.execCommand(command, false, value);
    capture();
  }

  function heading() {
    const current = document.queryCommandValue("formatBlock");
    apply("formatBlock", /h2/i.test(current) ? "P" : "H2");
  }

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
        <div className="sticky top-0 z-10 -mx-5 mt-4 flex gap-1 border-y border-slate-200 bg-[#fffdf8] px-3 py-2">
          <ToolButton label="Heading" pressed={false} onPress={heading}>
            H
          </ToolButton>
          <ToolButton label="Bold" pressed={marks.bold} onPress={() => apply("bold")}>
            <span className="font-bold">B</span>
          </ToolButton>
          <ToolButton label="Italic" pressed={marks.italic} onPress={() => apply("italic")}>
            <span className="italic">I</span>
          </ToolButton>
          <ToolButton label="Bullet list" pressed={false} onPress={() => apply("insertUnorderedList")}>
            •
          </ToolButton>
          <ToolButton label="Numbered list" pressed={false} onPress={() => apply("insertOrderedList")}>
            1.
          </ToolButton>
        </div>
        <div className="relative mt-3">
          {visibleText(body).length === 0 ? (
            <span className="pointer-events-none absolute text-lg text-slate-400">Write here</span>
          ) : null}
          <div
            ref={paper}
            role="textbox"
            aria-multiline="true"
            aria-label="Note"
            contentEditable
            suppressContentEditableWarning
            onInput={capture}
            className="min-h-[58vh] w-full text-lg leading-8 outline-none [&_h2]:mt-4 [&_h2]:text-xl [&_h2]:font-bold [&_li]:my-1 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-6 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-6"
          />
        </div>
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

function ToolButton({
  label,
  pressed,
  onPress,
  children,
}: {
  label: string;
  pressed: boolean;
  onPress: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      onPointerDown={(event) => event.preventDefault()}
      onClick={onPress}
      className={`flex h-11 min-w-11 items-center justify-center rounded-xl px-3 text-base text-slate-800 ${
        pressed ? "bg-slate-200" : "bg-transparent"
      }`}
    >
      {children}
    </button>
  );
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function plainToHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => `<p>${escapeHtml(part).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

const ALLOWED = new Set(["P", "BR", "STRONG", "EM", "U", "H2", "UL", "OL", "LI"]);

function sanitizeNoteHtml(html: string): string {
  if (!html.trim() || typeof DOMParser === "undefined") return "";
  const doc = new DOMParser().parseFromString(html, "text/html");
  return [...doc.body.childNodes].map(cleanNode).join("").slice(0, 40000);
}

function cleanNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return escapeHtml(node.textContent ?? "");
  if (node.nodeType !== Node.ELEMENT_NODE) return "";
  const el = node as HTMLElement;
  let tag = el.tagName;
  if (tag === "DIV") tag = "P";
  if (tag === "B") tag = "STRONG";
  if (tag === "I") tag = "EM";
  if (tag === "H1" || tag === "H3" || tag === "H4") tag = "H2";
  if (tag === "BR") return "<br>";
  const inner = [...el.childNodes].map(cleanNode).join("");
  if (!ALLOWED.has(tag)) return inner;
  if ((tag === "P" || tag === "H2" || tag === "LI") && inner.replace(/<br>/g, "").trim() === "") return "";
  return `<${tag.toLowerCase()}>${inner}</${tag.toLowerCase()}>`;
}

function editorHtml(stored: string): string {
  if (!stored.trim()) return "";
  if (/<\/?[a-z][\s\S]*>/i.test(stored)) return sanitizeNoteHtml(stored);
  return plainToHtml(stored);
}

function visibleText(html: string): string {
  return html.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim();
}
