"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { WorkoutType } from "@/types";
import { createClient } from "@/lib/supabase/client";
import { acceptPoint, distanceMeters, formatElapsed, formatPace, type LatLng } from "@/lib/track";
import { formatDistance, type DistanceUnit } from "@/lib/workouts";

type Activity = "run" | "walk" | "ride" | "stairs";
type Phase = "ready" | "recording" | "paused" | "review";

const ACTIVITIES: { id: Activity; label: string; type: WorkoutType; maxSpeed: number }[] = [
  { id: "run", label: "Run", type: "run", maxSpeed: 12 },
  { id: "walk", label: "Walk", type: "walk", maxSpeed: 4 },
  { id: "ride", label: "Ride", type: "ride", maxSpeed: 25 },
  { id: "stairs", label: "Stairs", type: "other", maxSpeed: 3 },
];

const UNIT_KEY = "daily-hub-distance-unit";
const UNIT_EVENT = "daily-hub-unit";

function subscribeUnit(onChange: () => void) {
  window.addEventListener(UNIT_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(UNIT_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function readUnit(): DistanceUnit {
  return localStorage.getItem(UNIT_KEY) === "mi" ? "mi" : "km";
}

interface Fix extends LatLng {
  at: number;
}

export default function LiveTracker() {
  const [activity, setActivity] = useState<Activity>("run");
  const [phase, setPhase] = useState<Phase>("ready");
  const [finding, setFinding] = useState(false);
  const [meters, setMeters] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [points, setPoints] = useState<Fix[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const unit = useSyncExternalStore(subscribeUnit, readUnit, () => "km" as DistanceUnit);
  const router = useRouter();

  const watchId = useRef<number | null>(null);
  const lastPoint = useRef<Fix | null>(null);
  const startedAt = useRef(0);
  const pausedAt = useRef(0);
  const pausedMs = useRef(0);
  const wakeLock = useRef<{ release: () => Promise<void> } | null>(null);
  const phaseRef = useRef<Phase>("ready");
  const maxSpeed = useRef(12);
  const pauseRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    if (phase !== "recording") return;
    const timer = window.setInterval(() => {
      setElapsed(Date.now() - startedAt.current - pausedMs.current);
    }, 250);
    return () => window.clearInterval(timer);
  }, [phase]);

  useEffect(() => {
    function onHide() {
      if (document.visibilityState === "hidden" && phaseRef.current === "recording") {
        pauseRef.current();
      }
      if (document.visibilityState === "visible") void keepAwake();
    }
    function onLeave(event: BeforeUnloadEvent) {
      if (phaseRef.current === "ready") return;
      event.preventDefault();
    }
    function onClick(event: MouseEvent) {
      if (phaseRef.current === "ready") return;
      const link = (event.target as Element | null)?.closest("a");
      if (!link) return;
      const href = link.getAttribute("href") ?? "";
      if (!href || href.startsWith("/workouts/track")) return;
      const leave = window.confirm("Leave this screen? This session will not be saved.");
      if (!leave) {
        event.preventDefault();
        event.stopPropagation();
      }
    }
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("beforeunload", onLeave);
    document.addEventListener("click", onClick, true);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("beforeunload", onLeave);
      document.removeEventListener("click", onClick, true);
      stopWatch();
      void wakeLock.current?.release().catch(() => undefined);
    };
  }, []);

  const selected = ACTIVITIES.find((item) => item.id === activity) ?? ACTIVITIES[0];
  maxSpeed.current = selected.maxSpeed;
  const km = meters / 1000;

  function moveTo(next: Phase) {
    phaseRef.current = next;
    setPhase(next);
  }

  async function keepAwake() {
    const nav = navigator as Navigator & { wakeLock?: { request: (type: "screen") => Promise<{ release: () => Promise<void> }> } };
    if (!nav.wakeLock) return;
    try {
      wakeLock.current = await nav.wakeLock.request("screen");
    } catch {
      wakeLock.current = null;
    }
  }

  function stopWatch() {
    if (watchId.current != null) {
      navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null;
    }
  }

  function takePoint(position: GeolocationPosition) {
    const next: Fix & { accuracy: number } = {
      lat: position.coords.latitude,
      lng: position.coords.longitude,
      at: position.timestamp || Date.now(),
      accuracy: position.coords.accuracy,
    };
    if (!acceptPoint(lastPoint.current, next, maxSpeed.current)) return;
    const previous = lastPoint.current;
    lastPoint.current = next;
    if (previous) setMeters((current) => current + distanceMeters(previous, next));
    setPoints((current) => (current.length > 2000 ? current.slice(-2000).concat(next) : current.concat(next)));
  }

  function beginWatch() {
    watchId.current = navigator.geolocation.watchPosition(takePoint, () => undefined, {
      enableHighAccuracy: true,
      maximumAge: 1000,
      timeout: 20000,
    });
  }

  function start() {
    if (!navigator.geolocation) {
      setError("This browser cannot share your location. On iPhone, open Daily Hub in Safari.");
      return;
    }
    setError(null);
    setFinding(true);
    void keepAwake();
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setFinding(false);
        lastPoint.current = null;
        setMeters(0);
        setPoints([]);
        takePoint(position);
        startedAt.current = Date.now();
        pausedMs.current = 0;
        setElapsed(0);
        moveTo("recording");
        beginWatch();
      },
      (positionError) => {
        setFinding(false);
        void wakeLock.current?.release().catch(() => undefined);
        setError(locationMessage(positionError));
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
    );
  }

  function pause() {
    if (phaseRef.current !== "recording") return;
    pausedAt.current = Date.now();
    setElapsed(pausedAt.current - startedAt.current - pausedMs.current);
    moveTo("paused");
    stopWatch();
  }
  pauseRef.current = pause;

  function resume() {
    pausedMs.current += Date.now() - pausedAt.current;
    moveTo("recording");
    void keepAwake();
    beginWatch();
  }

  function finish() {
    if (phaseRef.current === "recording") {
      pausedAt.current = Date.now();
      setElapsed(pausedAt.current - startedAt.current - pausedMs.current);
    }
    stopWatch();
    void wakeLock.current?.release().catch(() => undefined);
    moveTo("review");
  }

  function discard() {
    stopWatch();
    void wakeLock.current?.release().catch(() => undefined);
    lastPoint.current = null;
    setMeters(0);
    setPoints([]);
    setElapsed(0);
    setNotes("");
    moveTo("ready");
  }

  async function save() {
    if (elapsed < 5000) {
      setError("Keep going for a few seconds before saving.");
      return;
    }
    setSaving(true);
    setError(null);
    const started = new Date(startedAt.current);
    const noteText = activity === "stairs" ? (notes.trim() ? `Stair climbing. ${notes.trim()}` : "Stair climbing") : notes.trim() || null;
    const payload = {
      type: selected.type,
      duration_min: Math.round((elapsed / 60000) * 10) / 10,
      distance_km: km >= 0.01 ? Math.round(km * 1000) / 1000 : null,
      calories: null,
      avg_heart_rate: null,
      notes: noteText,
      source: "manual" as const,
    };
    const supabase = createClient();
    let result = await supabase.from("workouts").insert({ ...payload, started_at: started.toISOString() });
    if (result.error?.code === "23505") {
      started.setMinutes(started.getMinutes() + 1);
      result = await supabase.from("workouts").insert({ ...payload, started_at: started.toISOString() });
    }
    setSaving(false);
    if (result.error) {
      setError(result.error.message);
      return;
    }
    router.push("/workouts");
    router.refresh();
  }

  return (
    <section>
      <div className="mb-5 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Track</h1>
        <Link href="/workouts" className="min-h-11 px-2 text-sm font-medium text-accent">
          Workouts
        </Link>
      </div>

      {phase === "ready" ? (
        <>
          <p className="mb-4 text-sm text-muted">
            Keep this screen open. The timer pauses if you leave the app or lock the phone.
            {activity === "stairs" ? " Stairs records time. It cannot count floors." : ""}
          </p>
          <div className="grid grid-cols-2 gap-2">
            {ACTIVITIES.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-pressed={activity === item.id}
                onClick={() => setActivity(item.id)}
                className={`min-h-12 rounded-xl text-base font-semibold ${
                  activity === item.id ? "bg-accent text-white dark:text-neutral-950" : "bg-card"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={start}
            disabled={finding}
            className="mt-4 min-h-14 w-full rounded-xl bg-accent text-lg font-semibold text-white disabled:opacity-60 dark:text-neutral-950"
          >
            {finding ? "Finding you…" : "Start"}
          </button>
        </>
      ) : (
        <>
          <p className="text-sm font-medium text-muted">{selected.label}</p>
          <p className="mt-1 font-mono text-6xl font-bold tabular-nums">{formatElapsed(elapsed)}</p>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <Stat label="Distance" value={formatDistance(km, unit)} />
            <Stat label="Pace" value={formatPace(km, elapsed, unit)} />
          </div>
          <RouteLine points={points} />
          {phase === "review" ? (
            <label className="mt-4 block text-sm font-medium" htmlFor="track-notes">
              Note
              <textarea
                id="track-notes"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                rows={2}
                maxLength={1000}
                placeholder="Optional"
                className="mt-1 w-full rounded-xl bg-card px-4 py-3 text-base outline-none focus:ring-2 focus:ring-accent"
              />
            </label>
          ) : (
            <p className="mt-3 text-sm text-muted">Leave this screen and the timer pauses.</p>
          )}
          <div className="mt-4 grid grid-cols-2 gap-2">
            {phase === "recording" ? (
              <button type="button" onClick={pause} className="min-h-14 rounded-xl bg-card text-base font-semibold">
                Pause
              </button>
            ) : null}
            {phase === "paused" ? (
              <button type="button" onClick={resume} className="min-h-14 rounded-xl bg-card text-base font-semibold">
                Resume
              </button>
            ) : null}
            {phase === "recording" || phase === "paused" ? (
              <button
                type="button"
                onClick={finish}
                className="min-h-14 rounded-xl bg-accent text-base font-semibold text-white dark:text-neutral-950"
              >
                Finish
              </button>
            ) : null}
            {phase === "review" ? (
              <>
                <button type="button" onClick={discard} className="min-h-14 rounded-xl bg-card text-base font-semibold">
                  Discard
                </button>
                <button
                  type="button"
                  onClick={() => void save()}
                  disabled={saving}
                  className="min-h-14 rounded-xl bg-accent text-base font-semibold text-white disabled:opacity-60 dark:text-neutral-950"
                >
                  {saving ? "Saving…" : "Save"}
                </button>
              </>
            ) : null}
          </div>
        </>
      )}

      {error ? <p className="mt-4 text-sm text-red-600 dark:text-red-400">{error}</p> : null}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-card px-3 py-4">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 text-xl font-semibold">{value}</p>
    </div>
  );
}

function RouteLine({ points }: { points: LatLng[] }) {
  if (points.length < 2) {
    return <p className="mt-4 text-sm text-muted">Waiting for a steady location signal.</p>;
  }
  const lats = points.map((point) => point.lat);
  const lngs = points.map((point) => point.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const width = Math.max(maxLng - minLng, 0.00002);
  const height = Math.max(maxLat - minLat, 0.00002);
  const path = points
    .map((point, index) => {
      const x = ((point.lng - minLng) / width) * 100;
      const y = (1 - (point.lat - minLat) / height) * 100;
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg viewBox="0 0 100 100" className="mt-4 h-40 w-full rounded-2xl bg-card" role="img" aria-label="Your path">
      <path d={path} fill="none" className="stroke-accent" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function locationMessage(error: GeolocationPositionError): string {
  if (error.code === error.PERMISSION_DENIED) {
    return "Allow location for this site, then tap Start again. On iPhone, open the page in Safari and choose Allow.";
  }
  if (error.code === error.TIMEOUT) return "The phone could not find you in time. Step outside or wait, then tap Start again.";
  return "The phone could not find your location.";
}
