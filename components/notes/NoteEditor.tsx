"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { explainNotesError } from "@/lib/notes";
import { moveNoteToTrash } from "@/lib/note-trash";
import { useInstallVisible } from "@/components/InstallPrompt";

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
  const savedRange = useRef<Range | null>(null);
  const ready = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ title: "", body: "" });
  const [marks, setMarks] = useState({ bold: false, italic: false, heading: false, bullets: false, numbers: false });
  const installVisible = useInstallVisible();
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
      if (selection.rangeCount > 0) savedRange.current = selection.getRangeAt(0).cloneRange();
      try {
        const block = document.queryCommandValue("formatBlock");
        setMarks({
          bold: document.queryCommandState("bold"),
          italic: document.queryCommandState("italic"),
          heading: /h2/i.test(block),
          bullets: document.queryCommandState("insertUnorderedList"),
          numbers: document.queryCommandState("insertOrderedList"),
        });
      } catch {
        setMarks({ bold: false, italic: false, heading: false, bullets: false, numbers: false });
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

  function placeCaret() {
    const page = paper.current;
    const selection = document.getSelection();
    if (!page || !selection) return;
    page.focus();
    const saved = savedRange.current;
    if (saved && page.contains(saved.startContainer)) {
      selection.removeAllRanges();
      selection.addRange(saved);
      return;
    }
    if (visibleText(page.innerHTML).length === 0) page.innerHTML = "<p><br></p>";
    const range = document.createRange();
    range.selectNodeContents(page);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
    savedRange.current = range.cloneRange();
  }

  function apply(command: string, value?: string) {
    placeCaret();
    let worked = document.execCommand(command, false, value);
    if (!worked && command === "formatBlock" && value) {
      const alternate = value.startsWith("<") ? value.slice(1, -1) : `<${value}>`;
      worked = document.execCommand(command, false, alternate);
    }
    const selection = document.getSelection();
    if (selection && selection.rangeCount > 0 && paper.current?.contains(selection.anchorNode)) {
      savedRange.current = selection.getRangeAt(0).cloneRange();
    }
    capture();
  }

  function heading() {
    placeCaret();
    const current = document.queryCommandValue("formatBlock");
    apply("formatBlock", /h2/i.test(current) ? "p" : "h2");
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
    if (timer.current) clearTimeout(timer.current);
    const deleteError = await moveNoteToTrash(noteId);
    if (deleteError) {
      ready.current = true;
      setRemoving(false);
      setError(explainNotesError(deleteError));
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
      <section className="rounded-3xl bg-[#fffdf8] px-5 pb-28 pt-6 text-slate-900 shadow-[0_18px_50px_rgba(0,0,0,0.28)]">
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
        <div className="relative mt-4">
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
            className="min-h-[58vh] w-full text-lg leading-8 outline-none [&_em]:text-slate-500 [&_h2]:mt-5 [&_h2]:text-xl [&_h2]:font-bold [&_h2:not(:first-child)]:border-t [&_h2:not(:first-child)]:border-slate-200 [&_h2:not(:first-child)]:pt-4 [&_li]:my-1 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-6 [&_strong]:font-bold [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-6"
          />
        </div>
      </section>
      <div
        className="pointer-events-none fixed inset-x-0 z-30 mx-auto flex max-w-xl px-4"
        style={{ bottom: `calc(${installVisible ? "16rem" : "5.25rem"} + env(safe-area-inset-bottom))` }}
      >
        <div className="pointer-events-auto mr-16 flex w-full items-stretch rounded-2xl border border-slate-200 bg-white/95 p-1 shadow-[0_10px_30px_rgba(15,23,42,0.18)] backdrop-blur">
          <ToolButton label="Heading" pressed={marks.heading} onPress={heading}>
            <HeadingIcon />
          </ToolButton>
          <ToolButton label="Bold" pressed={marks.bold} onPress={() => apply("bold")}>
            <BoldIcon />
          </ToolButton>
          <ToolButton label="Italic" pressed={marks.italic} onPress={() => apply("italic")}>
            <ItalicIcon />
          </ToolButton>
          <span className="mx-1 my-2 w-px bg-slate-200" aria-hidden />
          <ToolButton label="Bullet list" pressed={marks.bullets} onPress={() => apply("insertUnorderedList")}>
            <BulletIcon />
          </ToolButton>
          <ToolButton label="Numbered list" pressed={marks.numbers} onPress={() => apply("insertOrderedList")}>
            <NumberIcon />
          </ToolButton>
        </div>
      </div>
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
              {removing ? "Moving…" : "Move to trash"}
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
      onPointerDown={(event) => {
        event.preventDefault();
        onPress();
      }}
      className={`flex h-12 flex-1 items-center justify-center rounded-xl ${
        pressed ? "bg-slate-900 text-white" : "text-slate-700"
      }`}
    >
      {children}
    </button>
  );
}

function HeadingIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M6 5v14M18 5v14M6 12h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function BoldIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M7 5h6.5a3.5 3.5 0 0 1 0 7H7V5Zm0 7h7.5a3.5 3.5 0 0 1 0 7H7v-7Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

function ItalicIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M14 5h5M5 19h5M15 5 9 19" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function BulletIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M10 7h9M10 12h9M10 17h9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="6" cy="7" r="1.2" fill="currentColor" />
      <circle cx="6" cy="12" r="1.2" fill="currentColor" />
      <circle cx="6" cy="17" r="1.2" fill="currentColor" />
    </svg>
  );
}

function NumberIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M11 7h8M11 12h8M11 17h8M6 6.5v3M5 17.5c.4.8 1.2 1.2 2 .8.6-.3.8-.8.5-1.3-.4-.6-1.4-.6-1.8 0" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
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
