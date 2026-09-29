import { haversineM } from "./fleetLogic";
import type { TransitLeg } from "./types";

export type LatLon = [number, number];

export type ManeuverKind =
  | "straight"
  | "left"
  | "right"
  | "slight-left"
  | "slight-right"
  | "uturn"
  | "arrive"
  | "merge"
  | "roundabout"
  | "exit";

export type LaneHint = { valid?: boolean; indications?: string[] };

export type Maneuver = {
  kind: ManeuverKind;
  distanceM: number;
  street: string;
  shield: string | null;
  atLat: number;
  atLon: number;
  lanes?: LaneHint[];
};

export type AlongMatch = {
  alongM: number;
  offM: number;
  totalM: number;
  remainingM: number;
  bearing: number;
  lat: number;
  lon: number;
  snapped: boolean;
  offRoute: boolean;
};

export type RouteProgress = {
  traveled: LatLon[];
  ahead: LatLon[];
  aheadM: number;
  bearing: number;
};

export function bearingDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const y = Math.sin(dLon) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dLon);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

export function turnDelta(from: number, to: number): number {
  let delta = to - from;
  while (delta > 180) delta -= 360;
  while (delta < -180) delta += 360;
  return delta;
}

export function kindFromDelta(delta: number): ManeuverKind {
  const amount = Math.abs(delta);
  if (amount < 25) return "straight";
  if (amount > 150) return "uturn";
  if (amount < 55) return delta < 0 ? "slight-left" : "slight-right";
  return delta < 0 ? "left" : "right";
}

export function shieldFrom(name: string | null | undefined): string | null {
  if (!name) return null;
  if (/\bQEW\b/i.test(name)) return "QEW";
  const labeled = name.match(/\b(?:Highway|Hwy|Regional Road|County Road|Route|RR)\s+(\d{1,4}[A-Z]?)\b/i);
  return labeled ? labeled[1] : null;
}

export function shortPlace(label: string): string {
  const cut = label.split(",")[0]?.trim() || label;
  return cut.length > 32 ? `${cut.slice(0, 31)}…` : cut;
}

export function formatDistance(meters: number): string {
  if (meters < 30) return "now";
  if (meters < 1000) return `${Math.max(10, Math.round(meters / 10) * 10)} m`;
  if (meters < 10000) return `${(meters / 1000).toFixed(1)} km`;
  return `${Math.round(meters / 1000)} km`;
}

function pathLength(line: LatLon[]): number {
  let total = 0;
  for (let index = 1; index < line.length; index += 1) {
    total += haversineM(line[index - 1][0], line[index - 1][1], line[index][0], line[index][1]);
  }
  return total;
}

export function cutLine(line: LatLon[], alongM: number): { traveled: LatLon[]; ahead: LatLon[] } {
  if (line.length < 2) return { traveled: [], ahead: line.slice() };
  let walked = 0;
  for (let index = 1; index < line.length; index += 1) {
    const start = line[index - 1];
    const end = line[index];
    const length = haversineM(start[0], start[1], end[0], end[1]);
    if (walked + length >= alongM || index === line.length - 1) {
      const t = length > 1 ? Math.max(0, Math.min(1, (alongM - walked) / length)) : 1;
      const mid: LatLon = [start[0] + (end[0] - start[0]) * t, start[1] + (end[1] - start[1]) * t];
      return {
        traveled: [...line.slice(0, index), mid],
        ahead: [mid, ...line.slice(index)],
      };
    }
    walked += length;
  }
  const last = line[line.length - 1];
  return { traveled: line.slice(), ahead: [last] };
}

export function progressAlong(line: LatLon[], lat: number, lon: number, previous?: { alongM: number } | null): RouteProgress {
  if (!line.length) {
    return { traveled: [], ahead: [[lat, lon]], aheadM: 0, bearing: 0 };
  }
  const matched = matchAlong(line, lat, lon, previous);
  const parts = cutLine(line, matched.alongM);
  return { traveled: parts.traveled, ahead: parts.ahead, aheadM: matched.remainingM, bearing: matched.bearing };
}

export function nextManeuver(ahead: LatLon[], streetHint: string, destLabel: string): Maneuver {
  const dest = shortPlace(destLabel);
  const hint = streetHint.trim();
  if (ahead.length < 2) {
    const point = ahead[0] || [0, 0];
    return { kind: "arrive", distanceM: 0, street: dest, shield: null, atLat: point[0], atLon: point[1] };
  }
  let walked = 0;
  let prevBearing = bearingDeg(ahead[0][0], ahead[0][1], ahead[1][0], ahead[1][1]);
  for (let index = 1; index < ahead.length - 1; index += 1) {
    walked += haversineM(ahead[index - 1][0], ahead[index - 1][1], ahead[index][0], ahead[index][1]);
    const nextBearing = bearingDeg(ahead[index][0], ahead[index][1], ahead[index + 1][0], ahead[index + 1][1]);
    const kind = kindFromDelta(turnDelta(prevBearing, nextBearing));
    if (kind !== "straight" && walked > 40) {
      const street = hint || dest;
      return {
        kind,
        distanceM: walked,
        street,
        shield: shieldFrom(street),
        atLat: ahead[index][0],
        atLon: ahead[index][1],
      };
    }
    prevBearing = nextBearing;
  }
  const total = pathLength(ahead);
  const last = ahead[ahead.length - 1];
    if (total <= ARRIVE_M) {
    return { kind: "arrive", distanceM: total, street: dest, shield: null, atLat: last[0], atLon: last[1] };
  }
  const street = hint || dest;
  return {
    kind: "straight",
    distanceM: total,
    street,
    shield: shieldFrom(street),
    atLat: last[0],
    atLon: last[1],
  };
}

const CITY_CUES = [
  { id: "far", metres: 400 },
  { id: "near", metres: 100 },
  { id: "now", metres: 35 },
] as const;
const HIGHWAY_CUES = [
  { id: "far", metres: 2000 },
  { id: "near", metres: 500 },
  { id: "now", metres: 70 },
] as const;
const SLOW_CUES = [
  { id: "near", metres: 50 },
  { id: "now", metres: 15 },
] as const;
const SPEED_COOLDOWN_MS = 20000;

export type VoiceCue = { key: string; phrase: string; mark: string[] };
export type SpeedSpeech = { spoken: boolean; at: number };

function highwayMode(roadMode?: string | null): boolean {
  const mode = (roadMode || "").toLowerCase();
  return mode === "highway" || mode === "motorway" || mode.includes("highway");
}

function cueStepKey(maneuver: Maneuver): string {
  const lat = Math.round(maneuver.atLat * 1000) / 1000;
  const lon = Math.round(maneuver.atLon * 1000) / 1000;
  return [maneuver.kind, lat, lon].join("|");
}

function verbFor(kind: ManeuverKind): string {
  return {
    left: "turn left",
    right: "turn right",
    "slight-left": "bear left",
    "slight-right": "bear right",
    uturn: "make a U-turn",
    merge: "merge",
    roundabout: "enter the roundabout",
    exit: "take the exit",
    arrive: "arrive",
    straight: "continue",
  }[kind];
}

function metresWords(metres: number): string {
  if (metres >= 1000 && metres % 1000 === 0) return `${metres / 1000} kilometres`;
  return `${metres} metres`;
}

function cuePhrase(maneuver: Maneuver, cue: { id: string; metres: number }): string {
  const street = maneuver.street && maneuver.street !== "Unnamed road" ? maneuver.street : "";
  if (cue.id === "now") {
    if (maneuver.kind === "arrive") return street ? `You are arriving at ${street}` : "You are arriving";
    if (maneuver.kind === "exit") return "Take the exit now";
    const spokenVerb = verbFor(maneuver.kind);
    return `${spokenVerb.charAt(0).toUpperCase()}${spokenVerb.slice(1)} now`;
  }
  const lead = `In ${metresWords(cue.metres)}, `;
  if (maneuver.kind === "arrive") return `${lead}you will arrive${street ? ` at ${street}` : ""}`;
  if (maneuver.kind === "exit") return `${lead}take the exit${street ? ` onto ${street}` : ""}`;
  return `${lead}${verbFor(maneuver.kind)}${street ? ` onto ${street}` : ""}`;
}

/** One announcement per maneuver threshold. Spoken flags block GPS jitter. */
export function voiceCue(
  maneuver: Maneuver | null,
  roadMode: string | null | undefined,
  spoken: Record<string, boolean>,
  travelMode?: string | null,
): VoiceCue | null {
  if (!maneuver || maneuver.kind === "straight") return null;
  const slow = travelMode === "walk" || travelMode === "cycle";
  const cues = slow ? SLOW_CUES : (highwayMode(roadMode) ? HIGHWAY_CUES : CITY_CUES);
  let chosen: { id: string; metres: number } | null = null;
  cues.forEach((cue) => {
    if (maneuver.distanceM <= cue.metres && (!chosen || cue.metres < chosen.metres)) chosen = cue;
  });
  if (!chosen) return null;
  const picked: { id: string; metres: number } = chosen;
  const step = cueStepKey(maneuver);
  const tighter = cues.some((cue) => cue.metres < picked.metres && spoken[`${step}|${cue.id}`]);
  if (tighter || spoken[`${step}|${picked.id}`]) return null;
  const mark = cues.filter((cue) => cue.metres >= picked.metres).map((cue) => `${step}|${cue.id}`);
  return { key: `${step}|${picked.id}`, phrase: cuePhrase(maneuver, picked), mark };
}

export function signAlert(
  signs: { kind: string; lat: number; lon: number }[],
  spoken: Record<string, boolean>,
  nowMs: number,
  lastAt: number,
  cooldownMs = 8000,
): { key: string; phrase: string } | null {
  if (lastAt && nowMs - lastAt < cooldownMs) return null;
  for (const sign of signs) {
    if (sign.kind !== "stop" && sign.kind !== "stop-all" && sign.kind !== "signal") continue;
    const key = `${sign.kind}|${sign.lat.toFixed(4)}|${sign.lon.toFixed(4)}`;
    if (spoken[key]) continue;
    const phrase = sign.kind === "signal"
      ? "Traffic light ahead"
      : sign.kind === "stop-all"
        ? "All-way stop ahead"
        : "Stop sign ahead";
    return { key, phrase };
  }
  return null;
}

export function speedAlert(
  warning: string,
  state: SpeedSpeech | null,
  nowMs: number,
): { speak: boolean; phrase?: string; state: SpeedSpeech } {
  const current = state || { spoken: false, at: 0 };
  if (warning === "red") {
    if (current.spoken || (current.at && nowMs - current.at < SPEED_COOLDOWN_MS)) {
      return { speak: false, state: { spoken: true, at: current.at || nowMs } };
    }
    return { speak: true, phrase: "You are over the speed limit.", state: { spoken: true, at: nowMs } };
  }
  if (current.spoken && nowMs - current.at < SPEED_COOLDOWN_MS) {
    return { speak: false, state: { spoken: true, at: current.at } };
  }
  return { speak: false, state: { spoken: false, at: current.at } };
}

export function instructionSpeech(maneuver: Maneuver): string {
  const lead = maneuver.distanceM < 40 ? "" : `In ${formatDistance(maneuver.distanceM)}, `;
  if (maneuver.kind === "arrive") return `${lead}you will arrive at ${maneuver.street}`.trim();
  if (maneuver.kind === "straight") return `${lead}continue on ${maneuver.street}`.trim();
  const turn = {
    left: "turn left",
    right: "turn right",
    "slight-left": "bear left",
    "slight-right": "bear right",
    uturn: "make a U-turn",
    merge: "merge",
    roundabout: "enter the roundabout",
    exit: "take the exit",
  }[maneuver.kind];
  return `${lead}${turn || "continue"} onto ${maneuver.street}`.trim();
}

export const ALERT_WINDOW_M = 1500;
export const ALERT_CORRIDOR_M = 80;
export const ARRIVE_M = 150;
export const THEN_M = 300;
export const SNAP_M = 25;
const PASSED_M = 35;
const ON_ROUTE_M = 60;

export type RoadStepLike = {
  name?: string;
  ref?: string;
  instruction?: string;
  type?: string;
  modifier?: string;
  location?: [number, number] | null;
  geometry?: [number, number][];
  lanes?: LaneHint[];
};

export function roadLabel(name?: string | null, ref?: string | null): string {
  const cleaned = (name || "").trim();
  if (cleaned && cleaned !== "Unnamed road") return cleaned;
  const roadRef = (ref || "").trim();
  if (/^\d{1,4}[A-Z]?$/.test(roadRef)) return `Hwy ${roadRef}`;
  if (roadRef) return roadRef;
  return "Unnamed road";
}

export function streetFromStep(step: RoadStepLike | null | undefined): string {
  const labeled = roadLabel(step?.name, step?.ref);
  if (labeled !== "Unnamed road") return labeled;
  const onto = String(step?.instruction || "").match(/\bonto\s+(.+)$/i);
  if (onto && onto[1] && onto[1].trim() && onto[1].trim() !== "Unnamed road") return onto[1].trim();
  return "Unnamed road";
}

export function maneuverKindFromStep(step: RoadStepLike): ManeuverKind {
  const type = (step.type || "").replace(/[_-]/g, " ").trim().toLowerCase();
  const modifier = (step.modifier || "").trim().toLowerCase();
  if (type === "arrive") return "arrive";
  if (type.includes("roundabout") || type === "rotary") return "roundabout";
  if (type === "merge") return "merge";
  if (type === "off ramp" || type === "fork" || type === "exit roundabout") return "exit";
  if (modifier === "uturn") return "uturn";
  if (modifier === "sharp left" || modifier === "left") return "left";
  if (modifier === "sharp right" || modifier === "right") return "right";
  if (modifier === "slight left") return "slight-left";
  if (modifier === "slight right") return "slight-right";
  return "straight";
}

function stepPoint(step: RoadStepLike): { lat: number; lon: number } | null {
  if (step.location && step.location.length >= 2) return { lat: step.location[1], lon: step.location[0] };
  const first = step.geometry && step.geometry[0];
  if (first && first.length >= 2) return { lat: first[1], lon: first[0] };
  return null;
}

function segmentT(a: LatLon, b: LatLon, lat: number, lon: number): number {
  const midLat = ((a[0] + b[0]) / 2) * Math.PI / 180;
  const lonScale = Math.cos(midLat) * 111320;
  const dx = (b[1] - a[1]) * lonScale;
  const dy = (b[0] - a[0]) * 111320;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1) return 0;
  const px = (lon - a[1]) * lonScale;
  const py = (lat - a[0]) * 111320;
  return Math.max(0, Math.min(1, (px * dx + py * dy) / len2));
}

export function projectAlong(line: LatLon[], lat: number, lon: number): { alongM: number; offM: number; lat?: number; lon?: number } {
  if (!line.length) return { alongM: 0, offM: Infinity };
  if (line.length === 1) return { alongM: 0, offM: haversineM(lat, lon, line[0][0], line[0][1]), lat: line[0][0], lon: line[0][1] };
  let along = 0;
  let best: { alongM: number; offM: number; lat?: number; lon?: number } = { alongM: 0, offM: Infinity };
  for (let index = 1; index < line.length; index += 1) {
    const start = line[index - 1];
    const end = line[index];
    const length = haversineM(start[0], start[1], end[0], end[1]);
    const t = segmentT(start, end, lat, lon);
    const latP = start[0] + (end[0] - start[0]) * t;
    const lonP = start[1] + (end[1] - start[1]) * t;
    const off = haversineM(lat, lon, latP, lonP);
    if (off < best.offM) best = { alongM: along + length * t, offM: off, lat: latP, lon: lonP };
    along += length;
  }
  return best;
}

export function matchAlong(line: LatLon[], lat: number, lon: number, previous?: { alongM: number } | null): AlongMatch {
  if (line.length < 2) {
    return {
      alongM: 0, offM: Infinity, totalM: 0, remainingM: 0, bearing: 0,
      lat, lon, snapped: false, offRoute: true,
    };
  }
  let best: { score: number; alongM: number; offM: number; lat: number; lon: number; bearing: number } | null = null;
  let along = 0;
  const prevAlong = previous && typeof previous.alongM === "number" ? previous.alongM : null;
  for (let index = 1; index < line.length; index += 1) {
    const start = line[index - 1];
    const end = line[index];
    const length = haversineM(start[0], start[1], end[0], end[1]);
    const t = segmentT(start, end, lat, lon);
    const latP = start[0] + (end[0] - start[0]) * t;
    const lonP = start[1] + (end[1] - start[1]) * t;
    const off = haversineM(lat, lon, latP, lonP);
    const alongM = along + length * t;
    let score = off;
    if (prevAlong != null) {
      const jump = alongM - prevAlong;
      if (jump < -40) score += (-jump - 40) * 5;
      else if (jump > 150 && off > 12) score += jump - 150;
    }
    const closer = !best || score < best.score - 0.5;
    const earlierTie = !!best && Math.abs(score - best.score) <= 20 && alongM < best.alongM;
    if (closer || earlierTie) {
      best = { score, alongM, offM: off, lat: latP, lon: lonP, bearing: bearingDeg(start[0], start[1], end[0], end[1]) };
    }
    along += length;
  }
  const chosen = best!;
  const snapped = chosen.offM <= SNAP_M;
  return {
    alongM: chosen.alongM,
    offM: chosen.offM,
    totalM: along,
    remainingM: Math.max(0, along - chosen.alongM),
    bearing: chosen.bearing,
    lat: snapped ? chosen.lat : lat,
    lon: snapped ? chosen.lon : lon,
    snapped,
    offRoute: chosen.offM > ON_ROUTE_M,
  };
}

export function smoothBearing(previous: number | null, target: number, maxStep = 20): number {
  if (!Number.isFinite(target)) return previous ?? 0;
  const aim = ((target % 360) + 360) % 360;
  if (previous == null || !Number.isFinite(previous)) return aim;
  const delta = turnDelta(previous, aim);
  const step = Math.max(-maxStep, Math.min(maxStep, delta));
  return (previous + step + 360) % 360;
}

export function navZoom(speedKmh: number | null, maneuverM: number | null, travelMode?: string | null): number {
  if (travelMode === "walk" || travelMode === "cycle") return 18;
  const speed = speedKmh == null ? 40 : speedKmh;
  let zoom = speed >= 80 ? 15 : speed >= 50 ? 16 : 17;
  if (maneuverM != null && maneuverM < 200) zoom = Math.max(zoom, 18);
  return zoom;
}

function lineMetres(geometry: [number, number][] | undefined): number {
  const line = geometry || [];
  let total = 0;
  for (let i = 1; i < line.length; i += 1) {
    total += haversineM(line[i - 1][1], line[i - 1][0], line[i][1], line[i][0]);
  }
  return total;
}

export function legTitle(leg: TransitLeg): string {
  if (leg.mode === "WALK") return leg.walk_min != null ? `Walk ${leg.walk_min} min` : "Walk";
  const kind = ({
    BUS: "Bus",
    TRAM: "Streetcar",
    SUBWAY: "Subway",
    RAIL: "Train",
    REGIONAL_RAIL: "Train",
    FERRY: "Ferry",
  } as Record<string, string>)[leg.mode] || leg.mode.replace(/_/g, " ");
  return leg.line ? `${kind} ${leg.line}` : kind;
}

/** Banner copy for the transit leg under the puck. Stop counts come only from the feed. */
export function transitManeuver(legs: TransitLeg[], alongM: number): Maneuver | null {
  if (!legs.length) return null;
  let cursor = 0;
  let current = legs[0];
  let start = 0;
  legs.forEach((leg) => {
    const length = lineMetres(leg.geometry);
    if (alongM + 8 >= cursor) {
      current = leg;
      start = cursor;
    }
    cursor += length;
  });
  const into = Math.max(0, alongM - start);
  const remain = Math.max(0, lineMetres(current.geometry) - into);
  const line = (current.geometry || []).map(([lon, lat]) => [lat, lon] as [number, number]);
  let remainingStops: number | null = null;
  if (current.mode !== "WALK" && current.stops && current.stops.length && line.length >= 2) {
    const ahead = current.stops.filter((stop) => {
      if (stop.lat == null || stop.lon == null) return false;
      return projectAlong(line, stop.lat, stop.lon).alongM >= into - 20;
    }).length;
    remainingStops = ahead + 1;
  }
  const title = legTitle(current);
  let street = title;
  if (current.mode !== "WALK" && remainingStops != null) street = `${title} · get off in ${remainingStops} stops`;
  else if (current.mode !== "WALK" && current.stop_count) street = `${title} · ${current.stop_count} stops`;
  const next = (current.stops || []).find((stop) => stop.name && stop.lat != null && stop.lon != null && line.length >= 2 && projectAlong(line, stop.lat as number, stop.lon as number).alongM >= into - 20);
  if (next?.name) street = `${street} · next ${next.name}`;
  else if (current.to_name) street = `${street} · next ${current.to_name}`;
  const last = legs[legs.length - 1] === current;
  return {
    kind: last && remain < 40 ? "arrive" : "straight",
    distanceM: remain,
    street,
    shield: null,
    atLat: line.length ? line[0][0] : 0,
    atLon: line.length ? line[0][1] : 0,
  };
}

type PlacedStep = { step: RoadStepLike; point: { lat: number; lon: number }; alongM: number };

function toManeuver(item: PlacedStep, userAlong: number): Maneuver {
  return {
    kind: maneuverKindFromStep(item.step),
    distanceM: Math.max(0, item.alongM - userAlong),
    street: streetFromStep(item.step),
    shield: shieldFrom(streetFromStep(item.step)),
    atLat: item.point.lat,
    atLon: item.point.lon,
    lanes: item.step.lanes || [],
  };
}

function continueOn(placed: PlacedStep[], userAlong: number, totalM: number): Maneuver | null {
  let road: PlacedStep | null = null;
  placed.forEach((item) => {
    if (maneuverKindFromStep(item.step) === "arrive") return;
    if (item.alongM <= userAlong + PASSED_M) road = item;
  });
  if (!road) return null;
  const remaining = Math.max(0, totalM - userAlong);
  const maneuver = toManeuver(road, userAlong);
  maneuver.kind = remaining <= ARRIVE_M ? "arrive" : "straight";
  maneuver.distanceM = remaining;
  return maneuver;
}

export function upcomingManeuvers(
  steps: RoadStepLike[],
  line: LatLon[],
  lat: number,
  lon: number,
  previous?: { alongM: number } | null,
): { current: Maneuver | null; then: Maneuver | null; match: AlongMatch; road: string } {
  const user = matchAlong(line, lat, lon, previous);
  const placed = steps.map((step) => {
    const point = stepPoint(step);
    if (!point) return null;
    const alongM = line.length >= 2 ? projectAlong(line, point.lat, point.lon).alongM : 0;
    return { step, point, alongM };
  }).filter((item): item is PlacedStep => item != null);
  placed.sort((a, b) => a.alongM - b.alongM);
  const upcoming = placed.filter((item) => {
    const ahead = item.alongM - user.alongM;
    if (ahead < -PASSED_M) return false;
    if (maneuverKindFromStep(item.step) === "arrive" && ahead > ARRIVE_M) return false;
    return true;
  });
  while (
    upcoming.length > 1
    && upcoming[0].alongM - user.alongM < 40
    && (upcoming[0].step.type || "").toLowerCase() === "depart"
  ) {
    upcoming.shift();
  }
  let current = upcoming.length ? toManeuver(upcoming[0], user.alongM) : continueOn(placed, user.alongM, user.totalM);
  if (current && current.kind === "arrive" && current.distanceM > ARRIVE_M) {
    current = continueOn(placed, user.alongM, user.totalM) || current;
  }
  let thenItem = upcoming.length > 1 ? upcoming[1] : null;
  if (!thenItem && current && current.kind !== "arrive") {
    const arrive = placed.find((item) => maneuverKindFromStep(item.step) === "arrive");
    if (arrive && arrive.alongM - user.alongM <= THEN_M) thenItem = arrive;
  }
  let thenManeuver = thenItem ? toManeuver(thenItem, user.alongM) : null;
  if (thenManeuver && thenManeuver.distanceM > THEN_M) thenManeuver = null;
  let onRoad = "";
  placed.forEach((item) => {
    if (maneuverKindFromStep(item.step) === "arrive") return;
    if (item.alongM <= user.alongM + PASSED_M) onRoad = streetFromStep(item.step);
  });
  return { current, then: thenManeuver, match: user, road: onRoad };
}

export function featuresAhead<T extends { lat: number; lon: number }>(
  features: T[],
  line: LatLon[],
  lat: number,
  lon: number,
  windowM = ALERT_WINDOW_M,
  corridorM = ALERT_CORRIDOR_M,
): T[] {
  if (line.length < 2) return [];
  const user = projectAlong(line, lat, lon);
  return features.filter((feature) => {
    const projected = projectAlong(line, feature.lat, feature.lon);
    if (projected.offM > corridorM) return false;
    const ahead = projected.alongM - user.alongM;
    return ahead >= -PASSED_M && ahead <= windowM;
  }).map((feature) => {
    const projected = projectAlong(line, feature.lat, feature.lon);
    if (projected.lat == null || projected.lon == null) return feature;
    return { ...feature, lat: projected.lat, lon: projected.lon };
  });
}

export function featuresAlongRoute<T extends { lat: number; lon: number }>(
  features: T[],
  line: LatLon[],
  corridorM = ALERT_CORRIDOR_M,
): T[] {
  if (line.length < 2) return [];
  return features.filter((feature) => projectAlong(line, feature.lat, feature.lon).offM <= corridorM);
}

export function pointAlong(line: LatLon[], meters: number): {
  lat: number;
  lon: number;
  bearing: number;
  alongM: number;
  done: boolean;
} {
  if (!line.length) return { lat: 0, lon: 0, bearing: 0, alongM: 0, done: true };
  const first = line[0];
  if (meters <= 0 || line.length === 1) {
    const next = line[Math.min(1, line.length - 1)];
    return {
      lat: first[0],
      lon: first[1],
      bearing: line.length > 1 ? bearingDeg(first[0], first[1], next[0], next[1]) : 0,
      alongM: 0,
      done: line.length < 2,
    };
  }
  let walked = 0;
  for (let index = 1; index < line.length; index += 1) {
    const start = line[index - 1];
    const end = line[index];
    const length = haversineM(start[0], start[1], end[0], end[1]);
    if (walked + length >= meters || index === line.length - 1) {
      const remain = Math.max(0, meters - walked);
      const t = length > 1 ? Math.min(1, remain / length) : 1;
      return {
        lat: start[0] + (end[0] - start[0]) * t,
        lon: start[1] + (end[1] - start[1]) * t,
        bearing: bearingDeg(start[0], start[1], end[0], end[1]),
        alongM: walked + length * t,
        done: t >= 1 && index === line.length - 1,
      };
    }
    walked += length;
  }
  const last = line[line.length - 1];
  return { lat: last[0], lon: last[1], bearing: 0, alongM: walked, done: true };
}

export function formatClock(date: Date): string {
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function etaCard(remainingM: number, totalM: number, totalS: number, destination: string): {
  title: string;
  subtitle: string;
  arriving: boolean;
  arrival: string;
  minutesLabel: string;
  distanceLabel: string;
  minuteValue: string;
  distanceValue: string;
  distanceUnit: "km" | "m";
} {
  const fraction = totalM > 1 ? Math.min(1, Math.max(0, remainingM / totalM)) : 1;
  const seconds = Math.max(0, totalS * fraction);
  const arriving = remainingM <= ARRIVE_M;
  const minutes = Math.max(arriving ? 0 : 1, Math.round(seconds / 60));
  const title = arriving
    ? "Arriving"
    : minutes < 60
      ? `${minutes} min`
      : `${Math.floor(minutes / 60)} hr ${minutes % 60 ? `${minutes % 60} min` : ""}`.trim();
  const distanceLabel = remainingM < 950
    ? `${Math.max(1, Math.round(remainingM))} m`
    : `${(remainingM / 1000).toFixed(remainingM < 10000 ? 1 : 0)} km`;
  const arrival = formatClock(new Date(Date.now() + seconds * 1000));
  const minutesLabel = arriving ? "Now" : title;
  const minuteValue = arriving ? "0" : minutes < 60 ? String(minutes) : `${Math.floor(minutes / 60)} hr ${minutes % 60 ? minutes % 60 : ""}`.trim();
  const distanceValue = remainingM >= 950
    ? (remainingM / 1000).toFixed(remainingM < 10000 ? 1 : 0)
    : String(Math.max(1, Math.round(remainingM)));
  const distanceUnit = remainingM >= 950 ? "km" : "m";
  const subtitle = arriving
    ? shortPlace(destination)
    : `${minutesLabel} · ${distanceLabel}`;
  return { title, subtitle, arriving, arrival, minutesLabel, distanceLabel, minuteValue, distanceValue, distanceUnit };
}
