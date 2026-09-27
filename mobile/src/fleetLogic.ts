/** Same trip rules as the website fleet log. Penalties come from /api/street-rules. */

export type WarningLevel = "ok" | "amber" | "red" | "unknown";

export type Hazard = {
  id: string;
  kind: string;
  label?: string;
  lat?: number;
  lon?: number;
  distance_m?: number;
};

export type RoadSample = {
  lat: number;
  lon: number;
  current_kmh: number;
  posted_kmh: number | null;
  safe_kmh: number | null;
  road_mode?: string;
  warning?: WarningLevel;
  school_active?: boolean;
  exit_warning?: { text?: string } | null;
  hazards?: Hazard[];
  sim_ms?: number;
  source?: string;
};

export type FleetEvent = {
  time_iso: string;
  lat: number;
  lon: number;
  kind: string;
  detail: string;
  speed_kmh: number;
  posted_kmh: number | null;
  safe_kmh: number | null;
  road_mode: string;
  duration_s?: number;
};

export type Cap = {
  label?: string;
  pass_m: number;
  slow_below_kmh: number;
  safe_kmh?: number;
  within_m?: number;
};

export type StreetRules = {
  score: {
    start: number;
    formula?: string;
    harsh_brake_kmh_per_s: number;
    harsh_accel_kmh_per_s: number;
    penalties: Record<string, number>;
  };
  caps: Record<string, Cap>;
  exit_warning?: { slow_below_kmh?: number; text?: string; min_m?: number; max_m?: number };
  modes?: Record<string, string[]>;
};

export type FleetMemory = {
  events: FleetEvent[];
  open: Record<string, boolean>;
  logged: Record<string, boolean>;
  track: Record<string, { tooFast: boolean; min: number }>;
  trackKind: Record<string, string>;
  exitFast: boolean;
  prevExit: boolean;
  lastSim: number | null;
  lastSpeed: number | null;
  lastSample: RoadSample | null;
};

export const FLEET_LABELS: Record<string, string> = {
  over_posted: "Over posted limit",
  above_safe: "Above safe speed",
  school_speeding: "School zone speeding",
  missed_bump: "Did not slow for bump",
  missed_signal: "Did not slow for signal",
  missed_stop: "Did not slow for stop",
  missed_exit: "Did not slow for exit",
  missed_crosswalk: "Did not slow for crosswalk",
  harsh_brake: "Harsh braking",
  harsh_accel: "Harsh acceleration",
};

/** Used only when /api/street-rules does not answer. Matches the published formula. */
export const FALLBACK_RULES: StreetRules = {
  score: {
    start: 100,
    formula:
      "Start at 100. Each distinct event subtracts once until that condition clears.",
    harsh_brake_kmh_per_s: 12,
    harsh_accel_kmh_per_s: 10,
    penalties: {
      above_safe: 3,
      harsh_accel: 4,
      harsh_brake: 6,
      missed_bump: 10,
      missed_crosswalk: 10,
      missed_exit: 10,
      missed_signal: 10,
      missed_stop: 10,
      over_posted: 8,
      school_speeding: 15,
    },
  },
  caps: {
    crosswalk: { label: "Crosswalk", pass_m: 22, safe_kmh: 30, slow_below_kmh: 35, within_m: 25 },
    school_zone: { label: "School zone", pass_m: 40, safe_kmh: 40, slow_below_kmh: 40, within_m: 80 },
    speed_bump: { label: "Speed bump", pass_m: 35, safe_kmh: 20, slow_below_kmh: 25, within_m: 40 },
    stop_sign: { label: "Stop sign", pass_m: 28, safe_kmh: 15, slow_below_kmh: 20, within_m: 30 },
    traffic_signal: { label: "Traffic signal", pass_m: 40, safe_kmh: 30, slow_below_kmh: 35, within_m: 50 },
  },
  exit_warning: { max_m: 500, min_m: 300, slow_below_kmh: 80, text: "Slow down: exit ahead" },
};

export function emptyFleet(): FleetMemory {
  return {
    events: [],
    open: {},
    logged: {},
    track: {},
    trackKind: {},
    exitFast: false,
    prevExit: false,
    lastSim: null,
    lastSpeed: null,
    lastSample: null,
  };
}

export function warningFor(
  current: number | null,
  posted: number | null,
  safe: number | null,
): WarningLevel {
  if (current == null || posted == null) return "unknown";
  if (current > posted) return "red";
  if (safe != null && current > safe) return "amber";
  return "ok";
}

export function driverScore(events: FleetEvent[], rules: StreetRules): number {
  let score = rules.score.start;
  events.forEach((event) => {
    score -= rules.score.penalties[event.kind] || 0;
  });
  return Math.max(0, Math.min(100, score));
}

function cloneMemory(memory: FleetMemory): FleetMemory {
  return {
    events: memory.events.map((event) => ({ ...event })),
    open: { ...memory.open },
    logged: { ...memory.logged },
    track: Object.fromEntries(Object.entries(memory.track).map(([key, value]) => [key, { ...value }])),
    trackKind: { ...memory.trackKind },
    exitFast: memory.exitFast,
    prevExit: memory.prevExit,
    lastSim: memory.lastSim,
    lastSpeed: memory.lastSpeed,
    lastSample: memory.lastSample,
  };
}

function whenOf(sample: RoadSample): number {
  return sample.sim_ms != null ? sample.sim_ms : Date.now();
}

function makeEvent(kind: string, detail: string, sample: RoadSample): FleetEvent {
  return {
    time_iso: new Date(whenOf(sample)).toISOString(),
    lat: Number(sample.lat.toFixed(6)),
    lon: Number(sample.lon.toFixed(6)),
    kind,
    detail,
    speed_kmh: sample.current_kmh,
    posted_kmh: sample.posted_kmh,
    safe_kmh: sample.safe_kmh,
    road_mode: sample.road_mode || "",
  };
}

function stampDuration(memory: FleetMemory, kind: string, nowMs: number): void {
  for (let index = memory.events.length - 1; index >= 0; index -= 1) {
    const event = memory.events[index];
    if (event.kind !== kind || event.duration_s != null) continue;
    const start = Date.parse(event.time_iso);
    const seconds = Number.isNaN(start) ? 1 : Math.max(1, Math.round((nowMs - start) / 1000));
    memory.events[index] = { ...event, duration_s: seconds };
    return;
  }
}

function missKind(kind: string): string | null {
  if (kind === "speed_bump") return "missed_bump";
  if (kind === "traffic_signal") return "missed_signal";
  if (kind === "stop_sign") return "missed_stop";
  if (kind === "crosswalk") return "missed_crosswalk";
  return null;
}

function pulse(
  memory: FleetMemory,
  key: string,
  on: boolean,
  sample: RoadSample,
  make: () => FleetEvent,
): void {
  if (on) {
    if (!memory.open[key]) {
      memory.open[key] = true;
      memory.events.push(make());
    }
    return;
  }
  if (memory.open[key]) stampDuration(memory, key, whenOf(sample));
  memory.open[key] = false;
}

function logOnce(memory: FleetMemory, key: string, event: FleetEvent): void {
  if (memory.logged[key]) return;
  memory.logged[key] = true;
  memory.events.push(event);
}

function finishPassing(memory: FleetMemory, rules: StreetRules, sample: RoadSample | null): void {
  const at = sample || memory.lastSample;
  Object.keys(memory.track).forEach((id) => {
    const state = memory.track[id];
    if (!state || !state.tooFast) return;
    const kind = missKind(memory.trackKind[id] || "");
    const cap = rules.caps[memory.trackKind[id] || ""];
    if (!kind || !cap || !at) return;
    logOnce(memory, `miss:${id}`, makeEvent(kind, `Passed ${cap.label || kind} without slowing`, at));
    state.tooFast = false;
  });
  if (memory.exitFast && at) {
    logOnce(memory, "missed_exit", makeEvent("missed_exit", "Did not slow for the exit ramp", at));
    memory.exitFast = false;
  }
}

export function observeFleet(memory: FleetMemory, sample: RoadSample, rules: StreetRules): FleetMemory {
  if (sample.posted_kmh == null || sample.current_kmh == null) return memory;
  if (sample.sim_ms != null && sample.sim_ms === memory.lastSim && sample.current_kmh === memory.lastSpeed) {
    return memory;
  }
  const next = cloneMemory(memory);
  const speed = Number(sample.current_kmh);
  const dt = next.lastSim != null && sample.sim_ms != null ? (sample.sim_ms - next.lastSim) / 1000 : null;
  const harshOk = sample.source === "fleet-demo" || sample.source === "gps" || sample.source === "simulate";
  if (harshOk && dt != null && dt > 0 && dt <= 5 && next.lastSpeed != null) {
    const rate = (speed - next.lastSpeed) / dt;
    const brakeAt = rules.score.harsh_brake_kmh_per_s;
    const accelAt = rules.score.harsh_accel_kmh_per_s;
    pulse(next, "harsh_brake", rate <= -brakeAt, sample, () => {
      const event = makeEvent("harsh_brake", `Speed dropped ${Math.abs(Math.round(rate))} km/h in 1 s`, sample);
      event.duration_s = Math.max(1, Math.round(dt));
      return event;
    });
    pulse(next, "harsh_accel", rate >= accelAt, sample, () => {
      const event = makeEvent("harsh_accel", `Speed rose ${Math.round(rate)} km/h in 1 s`, sample);
      event.duration_s = Math.max(1, Math.round(dt));
      return event;
    });
  }

  const schoolCap = rules.caps.school_zone;
  const school = !!(sample.school_active && schoolCap && speed > schoolCap.safe_kmh!);
  const warning = sample.warning || warningFor(speed, sample.posted_kmh, sample.safe_kmh);
  pulse(next, "over_posted", warning === "red", sample, () =>
    makeEvent("over_posted", `${speed} km/h in a ${sample.posted_kmh} zone`, sample));
  pulse(next, "school_speeding", school, sample, () =>
    makeEvent("school_speeding", `${speed} km/h in a school zone`, sample));
  pulse(next, "above_safe", warning === "amber" && !school, sample, () =>
    makeEvent("above_safe", `${speed} km/h above safe ${sample.safe_kmh}`, sample));

  const exitOn = !!(sample.exit_warning && sample.exit_warning.text);
  const slowBelow = rules.exit_warning?.slow_below_kmh ?? 80;
  if (exitOn && speed > slowBelow) next.exitFast = true;
  if (!exitOn && next.prevExit && next.exitFast) {
    logOnce(next, "missed_exit", makeEvent("missed_exit", "Did not slow for the exit ramp", sample));
    next.exitFast = false;
  }
  next.prevExit = exitOn;

  const seen = new Set<string>();
  (sample.hazards || []).forEach((hazard) => {
    if (!hazard || !hazard.id) return;
    seen.add(hazard.id);
    const cap = rules.caps[hazard.kind];
    if (!cap) return;
    const state = next.track[hazard.id] || { tooFast: false, min: 1e9 };
    state.min = Math.min(state.min, Number(hazard.distance_m ?? 1e9));
    if (Number(hazard.distance_m ?? 1e9) <= cap.pass_m && speed > cap.slow_below_kmh) state.tooFast = true;
    next.track[hazard.id] = state;
    next.trackKind[hazard.id] = hazard.kind;
  });
  Object.keys(next.track).forEach((id) => {
    if (seen.has(id) || !next.track[id].tooFast) return;
    const kind = missKind(next.trackKind[id] || "");
    const cap = rules.caps[next.trackKind[id] || ""];
    if (!kind || !cap) return;
    logOnce(next, `miss:${id}`, makeEvent(kind, `Passed ${cap.label || kind} without slowing`, sample));
    next.track[id].tooFast = false;
  });

  next.lastSim = sample.sim_ms != null ? sample.sim_ms : null;
  next.lastSpeed = speed;
  next.lastSample = sample;
  return next;
}

export function finishFleet(memory: FleetMemory, rules: StreetRules): FleetMemory {
  const next = cloneMemory(memory);
  const now = next.lastSample ? whenOf(next.lastSample) : Date.now();
  Object.keys(next.open).forEach((key) => {
    if (!next.open[key]) return;
    stampDuration(next, key, now);
    next.open[key] = false;
  });
  finishPassing(next, rules, next.lastSample);
  return next;
}

export function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = 6371000;
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.min(1, Math.sqrt(a)));
}
