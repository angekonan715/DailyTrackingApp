"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

const DISMISS_KEY = "daily-hub-install-dismissed";
const CHANGE = "daily-hub-install";

interface InstallEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function subscribe(onChange: () => void) {
  window.addEventListener(CHANGE, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function installedOrDismissed(): boolean {
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    ("standalone" in navigator && Boolean((navigator as Navigator & { standalone?: boolean }).standalone));
  return standalone || localStorage.getItem(DISMISS_KEY) === "1";
}

function isIos(): boolean {
  const ua = navigator.userAgent;
  const ipadDesktop = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  return /iPad|iPhone|iPod/.test(ua) || ipadDesktop;
}

export function useInstallVisible(): boolean {
  return useSyncExternalStore(subscribe, () => !installedOrDismissed(), () => false);
}

export default function InstallPrompt({ aboveNav }: { aboveNav: boolean }) {
  const visible = useInstallVisible();
  const [installer, setInstaller] = useState<InstallEvent | null>(null);
  const [help, setHelp] = useState<"ios" | "android" | null>(null);

  useEffect(() => {
    function onPrompt(event: Event) {
      event.preventDefault();
      setInstaller(event as InstallEvent);
    }
    function onInstalled() {
      localStorage.setItem(DISMISS_KEY, "1");
      window.dispatchEvent(new Event(CHANGE));
    }
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (!visible) return null;

  async function install() {
    if (installer) {
      await installer.prompt();
      const choice = await installer.userChoice;
      setInstaller(null);
      if (choice.outcome === "accepted") {
        localStorage.setItem(DISMISS_KEY, "1");
        window.dispatchEvent(new Event(CHANGE));
      }
      return;
    }

    if (isIos()) {
      setHelp("ios");
      return;
    }

    setHelp("android");
  }

  function dismiss() {
    localStorage.setItem(DISMISS_KEY, "1");
    window.dispatchEvent(new Event(CHANGE));
  }

  return (
    <div
      className={`fixed inset-x-0 z-20 mx-auto w-full max-w-xl px-4 ${
        aboveNav ? "bottom-[calc(4.75rem+env(safe-area-inset-bottom))]" : "bottom-4"
      }`}
    >
      <div className="rounded-2xl border border-black/10 bg-card p-4 shadow-lg dark:border-white/10">
        <p className="font-semibold">Keep Daily Hub on this phone</p>
        <p className="mt-1 text-sm text-muted">Add it to your home screen so Today opens like an app.</p>
        {help === "ios" ? (
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">
            <li>Open this page in Safari.</li>
            <li>Tap the Share button at the bottom of Safari. It is the square with an arrow.</li>
            <li>Tap Add to Home Screen, then Add.</li>
          </ol>
        ) : null}
        {help === "android" ? (
          <p className="mt-2 text-sm">
            Tap the menu at the end of the address bar, then tap Install app or Add to Home screen.
          </p>
        ) : null}
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={() => void install()}
            className="min-h-12 flex-1 rounded-xl bg-accent text-sm font-semibold text-white dark:text-neutral-950"
          >
            {help === "ios" ? "How to add it" : "Add to home screen"}
          </button>
          <button type="button" onClick={dismiss} className="min-h-12 rounded-xl bg-background px-4 text-sm font-medium">
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}
