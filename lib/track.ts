export interface LatLng {
  lat: number;
  lng: number;
}

const EARTH_METERS = 6371000;

/** Distance between two GPS points, in meters. */
export function distanceMeters(a: LatLng, b: LatLng): number {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLat = lat2 - lat1;
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Ignore GPS jumps and the small drift that happens while standing still. */
export function acceptPoint(
  previous: (LatLng & { at: number }) | null,
  next: LatLng & { accuracy: number; at: number },
  maxSpeed: number,
): boolean {
  if (!Number.isFinite(next.lat) || !Number.isFinite(next.lng)) return false;
  if (next.accuracy > 40) return false;
  if (!previous) return true;
  const meters = distanceMeters(previous, next);
  const seconds = Math.max((next.at - previous.at) / 1000, 0.1);
  if (meters < 8) return false;
  if (meters / seconds > maxSpeed) return false;
  return true;
}

export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const clock = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  return hours > 0 ? `${hours}:${clock}` : clock;
}

export function formatPace(km: number, elapsedMs: number, unit: "km" | "mi"): string {
  const distance = unit === "mi" ? km / 1.609344 : km;
  if (distance < 0.05 || elapsedMs < 1000) return "—";
  const totalSeconds = Math.round(elapsedMs / 1000 / distance);
  const minutes = Math.floor(totalSeconds / 60);
  const remain = totalSeconds % 60;
  return `${minutes}:${String(remain).padStart(2, "0")} /${unit}`;
}
