"use client";

import { useState, useSyncExternalStore } from "react";
import CoachChat from "@/components/summary/CoachChat";
import { useInstallVisible } from "@/components/InstallPrompt";
import { toDayKey } from "@/lib/dates";

function subscribe() {
  return () => {};
}

export default function FloatingCoach() {
  const today = useSyncExternalStore(subscribe, toDayKey, () => "");
  const installVisible = useInstallVisible();
  const [open, setOpen] = useState(false);
  if (!today) return null;

  const lift = installVisible ? "16rem" : "5.25rem";

  return (
    <div
      className="fixed right-4 z-40 flex w-[min(22rem,calc(100vw-2rem))] flex-col items-end gap-3"
      style={{ bottom: `calc(${lift} + env(safe-area-inset-bottom))` }}
    >
      {open ? (
        <div className="max-h-[min(28rem,70vh)] w-full overflow-y-auto rounded-2xl shadow-lg">
          <CoachChat today={today} />
        </div>
      ) : null}
      <button
        type="button"
        aria-expanded={open}
        aria-label={open ? "Close coach chat" : "Open coach chat"}
        onClick={() => setOpen((current) => !current)}
        className="flex h-14 w-14 items-center justify-center rounded-full bg-accent text-white shadow-lg dark:text-neutral-950"
      >
        {open ? (
          <span className="text-3xl leading-none" aria-hidden>
            ×
          </span>
        ) : (
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
              d="M5 6.5A2.5 2.5 0 0 1 7.5 4h9A2.5 2.5 0 0 1 19 6.5v7A2.5 2.5 0 0 1 16.5 16H9l-4 3.5V6.5Z"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </button>
    </div>
  );
}
