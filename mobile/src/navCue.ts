import { haversineM } from "./fleetLogic";

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

export function projectAlong(line: LatLon[], lat: number, lon: number): { alongM: number; offM: number } {
  if (!line.length) return { alongM: 0, offM: Infinity };
  if (line.length === 1) return { alongM: 0, offM: haversineM(lat, lon, line[0][0], line[0][1]) };
  let along = 0;
  let best = { alongM: 0, offM: Infinity };
  for (let index = 1; index < line.length; index += 1) {
    const start = line[index - 1];
    const end = line[index];
    const length = haversineM(start[0], start[1], end[0], end[1]);
    const t = segmentT(start, end, lat, lon);
    const latP = start[0] + (end[0] - start[0]) * t;
    const lonP = start[1] + (end[1] - start[1]) * t;
    const off = haversineM(lat, lon, latP, lonP);
    if (off < best.offM) best = { alongM: along + length * t, offM: off };
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

export function navZoom(speedKmh: number | null, maneuverM: number | null): number {
  const speed = speedKmh == null ? 40 : speedKmh;
  let zoom = speed >= 80 ? 15 : speed >= 50 ? 16 : 17;
  if (maneuverM != null && maneuverM < 200) zoom = Math.max(zoom, 18);
  return zoom;
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
): { current: Maneuver | null; then: Maneuver | null; match: AlongMatch } {
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
  return { current, then: thenManeuver, match: user };
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
  const subtitle = arriving
    ? shortPlace(destination)
    : `${minutesLabel} · ${distanceLabel}`;
  return { title, subtitle, arriving, arrival, minutesLabel, distanceLabel };
}
