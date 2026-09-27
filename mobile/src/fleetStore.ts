import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  driverScore,
  emptyFleet,
  finishFleet,
  observeFleet,
  type FleetEvent,
  type FleetMemory,
  type RoadSample,
  type StreetRules,
} from "./fleetLogic";
import { buildSampleFrames, SAMPLE_ROUTE, type PlayableRoute } from "./samplePlayback";

const STORAGE_KEY = "smartshield.fleetTrips.v1";

export type TracePoint = {
  t: string;
  lat: number;
  lon: number;
  speed_kmh: number;
  posted_kmh: number | null;
};

export type StoredTrip = {
  id: string;
  title: string;
  started_at: string;
  ended_at: string;
  score: number;
  distance_m: number;
  samples: number;
  events: FleetEvent[];
  trace: TracePoint[];
  source: "gps" | "simulate" | "sample";
};

type Snapshot = {
  running: boolean;
  status: string;
  memory: FleetMemory;
  score: number;
  trace: TracePoint[];
  startedAt: string | null;
  trips: StoredTrip[];
  line: [number, number][];
  rules: StreetRules | null;
};

let snapshot: Snapshot = {
  running: false,
  status: "No trip yet. Start one, or play the sample.",
  memory: emptyFleet(),
  score: 100,
  trace: [],
  startedAt: null,
  trips: [],
  line: [],
  rules: null,
};

const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let readLive: () => RoadSample | null = () => null;
let tripSource: StoredTrip["source"] = "gps";

function emit(): void {
  listeners.forEach((listener) => listener());
}

function publish(patch: Partial<Snapshot>): void {
  snapshot = { ...snapshot, ...patch };
  emit();
}

export function getFleetSnapshot(): Snapshot {
  return snapshot;
}

export function subscribeFleet(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setStreetRules(rules: StreetRules): void {
  publish({ rules });
}

export function setLiveReader(reader: () => RoadSample | null): void {
  readLive = reader;
}

export async function loadFleetHistory(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    const trips = raw ? (JSON.parse(raw) as StoredTrip[]) : [];
    publish({ trips: Array.isArray(trips) ? trips : [] });
  } catch {
    publish({ trips: [] });
  }
}

async function persist(trip: StoredTrip): Promise<void> {
  const trips = [trip, ...snapshot.trips].slice(0, 20);
  publish({ trips });
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(trips));
  } catch {
    /* The list still shows for this session. */
  }
}

function applySample(sample: RoadSample): void {
  const rules = snapshot.rules;
  if (!rules) return;
  const memory = observeFleet(snapshot.memory, sample, rules);
  const trace = snapshot.trace.length > 500
    ? snapshot.trace
    : snapshot.trace.concat({
      t: new Date(sample.sim_ms ?? Date.now()).toISOString(),
      lat: sample.lat,
      lon: sample.lon,
      speed_kmh: sample.current_kmh,
      posted_kmh: sample.posted_kmh,
    });
  const line = trace.map((point) => [point.lat, point.lon] as [number, number]);
  publish({
    memory,
    score: driverScore(memory.events, rules),
    trace,
    line,
  });
}

export function startTrip(source: StoredTrip["source"]): void {
  if (snapshot.running) return;
  if (timer) clearInterval(timer);
  tripSource = source;
  publish({
    running: true,
    status: source === "gps" ? "Trip recording from GPS." : "Trip recording in simulate mode.",
    memory: emptyFleet(),
    score: snapshot.rules ? snapshot.rules.score.start : 100,
    trace: [],
    line: [],
    startedAt: new Date().toISOString(),
  });
  timer = setInterval(() => {
    const sample = readLive();
    if (!sample) return;
    applySample({ ...sample, sim_ms: Date.now(), source: tripSource === "gps" ? "gps" : "simulate" });
  }, 1000);
}

export async function stopTrip(): Promise<void> {
  if (timer) clearInterval(timer);
  timer = null;
  const rules = snapshot.rules;
  const memory = rules ? finishFleet(snapshot.memory, rules) : snapshot.memory;
  const score = rules ? driverScore(memory.events, rules) : snapshot.score;
  const started = snapshot.startedAt || new Date().toISOString();
  const ended = new Date().toISOString();
  let distance = 0;
  for (let index = 1; index < snapshot.trace.length; index += 1) {
    const prev = snapshot.trace[index - 1];
    const point = snapshot.trace[index];
    const dLat = (point.lat - prev.lat) * 111320;
    const dLon = (point.lon - prev.lon) * 111320 * Math.cos((point.lat * Math.PI) / 180);
    distance += Math.hypot(dLat, dLon);
  }
  const trip: StoredTrip = {
    id: started,
    title: tripSource === "sample" ? "Highway 403 sample" : "Recorded trip",
    started_at: started,
    ended_at: ended,
    score,
    distance_m: Math.round(distance),
    samples: snapshot.trace.length,
    events: memory.events,
    trace: snapshot.trace,
    source: tripSource,
  };
  publish({
    running: false,
    memory,
    score,
    startedAt: null,
    status: `Trip saved on this phone. Score ${score}.`,
  });
  if (snapshot.trace.length) await persist(trip);
}

export function playSample(route?: PlayableRoute): void {
  const rules = snapshot.rules;
  if (!rules) {
    publish({ status: "Still loading the street rules." });
    return;
  }
  if (timer) clearInterval(timer);
  timer = null;
  const chosen = route && route.coordinates?.length ? route : SAMPLE_ROUTE;
  const started = Date.parse("2026-09-27T18:00:00Z");
  const frames = buildSampleFrames(chosen, rules, started);
  let memory = emptyFleet();
  const trace: TracePoint[] = [];
  frames.forEach((frame) => {
    memory = observeFleet(memory, frame, rules);
    if (trace.length < 500) {
      trace.push({
        t: new Date(frame.sim_ms || started).toISOString(),
        lat: frame.lat,
        lon: frame.lon,
        speed_kmh: frame.current_kmh,
        posted_kmh: frame.posted_kmh,
      });
    }
  });
  memory = finishFleet(memory, rules);
  const score = driverScore(memory.events, rules);
  const line = chosen.coordinates.map((pair) => [pair[1], pair[0]] as [number, number]);
  tripSource = "sample";
  publish({
    running: false,
    memory,
    score,
    trace,
    line,
    startedAt: null,
    status: `Sample trip complete. Score ${score}.`,
  });
  const trip: StoredTrip = {
    id: new Date().toISOString(),
    title: chosen.name || "Highway 403 sample",
    started_at: new Date(started).toISOString(),
    ended_at: new Date(started + frames.length * 1000).toISOString(),
    score,
    distance_m: Math.round(chosen.total_m || 0),
    samples: frames.length,
    events: memory.events,
    trace,
    source: "sample",
  };
  persist(trip).catch(() => undefined);
}
