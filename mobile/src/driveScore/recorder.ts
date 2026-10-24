/** Spec §5. Raw samples stay in RAM. Only the trip summary is saved. */

import { detectTrip, type GpsSample, type MotionSample } from "./detectors";
import { haversineM } from "./lightMatch";
import { scoreTrip } from "./score";

export const TRIP_KEY = "smartshield.driveScore.v1";
export const ENABLED_KEY = "smartshield.driveScoreOn.v1";

const RING_S = 10;
const PIN_S = 12;
const MAX_TRIPS = 50;
const MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

export type Store = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
};

export type TripEvent = {
  t: number;
  type: string;
  peakG: number | null;
  lat: number | null;
  lon: number | null;
};

export type TripSummary = {
  date: string;
  vehicle: "car" | "motorcycle";
  km: number;
  minutes: number;
  score: number | null;
  band: string | null;
  hardBrakes: number;
  harshBrakes: number;
  sharpTurns: number;
  speedingSeconds: number;
  speedingEpisodes: number;
  lightsPassed: number;
  fullStops: number;
  /** Spec §4. Needed so the card can show speeding points. Not a score input change. */
  movingSeconds: number;
  events: TripEvent[];
};

/** Spec §5: on for Drive and Motorcycle navigation unless driver performance is off. */
export function shouldRecord(mode: string, navigating: boolean, enabled: boolean): boolean {
  return enabled && navigating && (mode === "drive" || mode === "motorcycle");
}

/**
 * One recorder for manual Start trip and for navigation.
 * Manual and navigation together stay true, so the caller does not start a second recorder.
 * suppress is End trip while navigation is still running.
 */
export function wantsRecording(input: {
  enabled: boolean;
  navigating: boolean;
  mode: string;
  manual: boolean;
  suppress: boolean;
}): boolean {
  if (!input.enabled || input.suppress) return false;
  if (input.manual) return true;
  return shouldRecord(input.mode, input.navigating, true);
}

/** Start, stop, or keep the single recorder. "keep" must not open another one. */
export function recorderAction(running: boolean, want: boolean): "start" | "keep" | "stop" | "idle" {
  if (running && want) return "keep";
  if (!running && want) return "start";
  if (running && !want) return "stop";
  return "idle";
}

/** Spec §5: last 50 summaries or 90 days, whichever is fewer. */
export function pruneTrips<T extends { date: string }>(trips: T[], now: number): T[] {
  const cutoff = now - MAX_AGE_MS;
  return trips
    .filter((trip) => {
      const at = Date.parse(trip.date);
      return Number.isFinite(at) && at >= cutoff;
    })
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
    .slice(0, MAX_TRIPS);
}

export async function loadScoreOn(store: Store): Promise<boolean> {
  try {
    return (await store.getItem(ENABLED_KEY)) !== "0";
  } catch {
    return true;
  }
}

export async function saveScoreOn(store: Store, on: boolean): Promise<void> {
  await store.setItem(ENABLED_KEY, on ? "1" : "0");
}

export async function loadTrips(store: Store): Promise<TripSummary[]> {
  try {
    const raw = await store.getItem(TRIP_KEY);
    const parsed = raw ? JSON.parse(raw) as TripSummary[] : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function saveTrip(store: Store, trip: TripSummary, now = Date.now()): Promise<TripSummary[]> {
  const next = pruneTrips([trip, ...(await loadTrips(store))], now);
  await store.setItem(TRIP_KEY, JSON.stringify(next));
  return next;
}

/** Spec §5. Delete all saved trip summaries on this phone. */
export async function clearTrips(store: Store): Promise<void> {
  await store.setItem(TRIP_KEY, "[]");
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export type Recorder = {
  startedMs: number;
  addMotion(sample: MotionSample): void;
  addGps(fix: GpsSample): void;
  setLights(lights: { lat: number; lon: number }[]): void;
  finish(nowMs: number): TripSummary | null;
};

/**
 * Spec §2 and §6. Motion keeps the first 12 s (calibration) and the last 10 s.
 * Events are folded before older samples are dropped.
 */
export function createRecorder(vehicle: "car" | "motorcycle", startedMs: number): Recorder {
  const motion: MotionSample[] = [];
  const gps: GpsSample[] = [];
  let lights: { lat: number; lon: number }[] = [];
  const events = new Map<string, TripEvent>();
  let foldedAt = -1;

  const remember = (type: string, t: number, peakG: number) => {
    // Spec §2. Trimming the ring shifts one event's start by about a second.
    for (const prev of events.values()) {
      if (prev.type === type && Math.abs(prev.t - t) < 1.6) {
        if ((prev.peakG ?? 0) < peakG) prev.peakG = peakG;
        return;
      }
    }
    let lat: number | null = null;
    let lon: number | null = null;
    for (const fix of gps) {
      if (fix.t <= t + 1e-9) {
        lat = round3(fix.lat);
        lon = round3(fix.lon);
      }
    }
    events.set(`${type}@${t.toFixed(1)}`, { t, type, peakG, lat, lon });
  };

  const fold = () => {
    const found = detectTrip({ vehicle, motion, gps, lights });
    for (const brake of found.brakes) {
      if (brake.confirmed) remember(brake.type, brake.t, brake.peakG);
    }
    for (const turn of found.turns) remember(turn.type, turn.t, turn.peakG);
  };

  return {
    startedMs,
    addMotion(sample) {
      motion.push(sample);
      if (sample.t - foldedAt < 1) return;
      foldedAt = sample.t;
      fold();
      const cutoff = sample.t - RING_S;
      for (let i = motion.length - 1; i >= 0; i -= 1) {
        const t = motion[i].t;
        if (t > PIN_S && t < cutoff) motion.splice(i, 1);
      }
    },
    addGps(fix) {
      gps.push(fix);
    },
    setLights(next) {
      lights = next;
    },
    finish(nowMs) {
      if (!motion.length && gps.length < 2) return null;
      fold();
      const found = detectTrip({ vehicle, motion, gps, lights });
      const saved = [...events.values()];
      const hardBrakes = saved.filter((event) => event.type === "hard_brake").length;
      const harshBrakes = saved.filter((event) => event.type === "harsh_brake").length;
      const sharpTurns = saved.filter((event) => event.type === "sharp_turn").length;
      let metres = 0;
      for (let i = 1; i < gps.length; i += 1) {
        metres += haversineM(gps[i - 1].lat, gps[i - 1].lon, gps[i].lat, gps[i].lon);
      }
      const minutes = Math.max(0, (nowMs - startedMs) / 60000);
      const scored = scoreTrip({
        vehicle,
        tripKm: metres / 1000,
        tripMinutes: minutes,
        movingSeconds: found.movingSeconds,
        hardBrakes,
        harshBrakes,
        sharpTurns,
        speedingSeconds: found.speedingSeconds,
        speedingEpisodes: found.speedingEpisodes,
        lightsPassed: found.lightsPassed,
        fullStops: found.fullStops,
      });
      return {
        date: new Date(nowMs).toISOString(),
        vehicle,
        km: round3(metres / 1000),
        minutes: Math.round(minutes * 10) / 10,
        score: scored.score,
        band: scored.band,
        hardBrakes,
        harshBrakes,
        sharpTurns,
        speedingSeconds: found.speedingSeconds,
        speedingEpisodes: found.speedingEpisodes,
        lightsPassed: found.lightsPassed,
        fullStops: found.fullStops,
        movingSeconds: found.movingSeconds,
        events: saved,
      };
    },
  };
}

/** Spec §6. Phone accelerometer and gyroscope, about 50 Hz. Missing sensors are ignored. */
export function startSensors(onSample: (sample: MotionSample) => void, startedMs: number): () => void {
  let stopped = false;
  const subs: { remove(): void }[] = [];
  let gyro = { x: 0, y: 0, z: 0 };
  import("expo-sensors").then((sensors) => {
    if (stopped) return;
    sensors.Accelerometer.setUpdateInterval(20);
    sensors.Gyroscope.setUpdateInterval(20);
    subs.push(sensors.Gyroscope.addListener((value: { x: number; y: number; z: number }) => {
      gyro = value;
    }));
    subs.push(sensors.Accelerometer.addListener((value: { x: number; y: number; z: number }) => {
      onSample({
        t: (Date.now() - startedMs) / 1000,
        ax: value.x,
        ay: value.y,
        az: value.z,
        gx: gyro.x,
        gy: gyro.y,
        gz: gyro.z,
      });
    }));
  }).catch(() => undefined);
  return () => {
    stopped = true;
    for (const sub of subs) sub.remove();
  };
}
