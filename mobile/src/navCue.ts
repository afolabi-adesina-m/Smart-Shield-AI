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

export type Maneuver = {
  kind: ManeuverKind;
  distanceM: number;
  street: string;
  shield: string | null;
  atLat: number;
  atLon: number;
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

export function progressAlong(line: LatLon[], lat: number, lon: number): RouteProgress {
  if (!line.length) {
    return { traveled: [], ahead: [[lat, lon]], aheadM: 0, bearing: 0 };
  }
  let best = 0;
  let bestD = Infinity;
  for (let index = 0; index < line.length; index += 1) {
    const distance = haversineM(lat, lon, line[index][0], line[index][1]);
    if (distance < bestD) {
      bestD = distance;
      best = index;
    }
  }
  const ahead: LatLon[] = [[lat, lon], ...line.slice(best)];
  const traveled: LatLon[] = best === 0 ? [] : [...line.slice(0, best), [lat, lon]];
  let bearing = 0;
  if (line.length >= 2) {
    const next = line[Math.min(best + 1, line.length - 1)];
    const prev = line[Math.max(best - 1, 0)];
    const from = best + 1 < line.length ? line[best] : prev;
    const to = best + 1 < line.length ? next : line[best];
    if (from !== to) bearing = bearingDeg(from[0], from[1], to[0], to[1]);
  }
  return { traveled, ahead, aheadM: pathLength(ahead), bearing };
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
  if (total < 280) {
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
const PASSED_M = 35;

export type RoadStepLike = {
  name?: string;
  type?: string;
  modifier?: string;
  location?: [number, number] | null;
  geometry?: [number, number][];
};

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

export function upcomingManeuvers(
  steps: RoadStepLike[],
  line: LatLon[],
  lat: number,
  lon: number,
): { current: Maneuver | null; then: Maneuver | null } {
  const user = projectAlong(line, lat, lon);
  const placed = steps.map((step) => {
    const point = stepPoint(step);
    if (!point) return null;
    const alongM = line.length >= 2 ? projectAlong(line, point.lat, point.lon).alongM : 0;
    return { step, point, alongM };
  }).filter((item): item is { step: RoadStepLike; point: { lat: number; lon: number }; alongM: number } => item != null);
  placed.sort((a, b) => a.alongM - b.alongM);
  const upcoming = placed.filter((item) => item.alongM - user.alongM >= -PASSED_M);
  while (
    upcoming.length > 1
    && upcoming[0].alongM - user.alongM < 40
    && (upcoming[0].step.type || "").toLowerCase() === "depart"
  ) {
    upcoming.shift();
  }
  const toManeuver = (item: typeof placed[number]): Maneuver => ({
    kind: maneuverKindFromStep(item.step),
    distanceM: Math.max(0, item.alongM - user.alongM),
    street: item.step.name || "Unnamed road",
    shield: shieldFrom(item.step.name),
    atLat: item.point.lat,
    atLon: item.point.lon,
  });
  if (!upcoming.length) return { current: null, then: null };
  return {
    current: toManeuver(upcoming[0]),
    then: upcoming[1] ? toManeuver(upcoming[1]) : null,
  };
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
} {
  const fraction = totalM > 1 ? Math.min(1, Math.max(0, remainingM / totalM)) : 1;
  const seconds = Math.max(0, totalS * fraction);
  const arriving = remainingM < 350;
  const minutes = Math.max(1, Math.round(seconds / 60));
  const title = arriving
    ? "Arriving soon"
    : minutes < 60
      ? `${minutes} min`
      : `${Math.floor(minutes / 60)} hr ${minutes % 60 ? `${minutes % 60} min` : ""}`.trim();
  const distance = remainingM < 950
    ? `${Math.max(1, Math.round(remainingM))} m`
    : `${(remainingM / 1000).toFixed(remainingM < 10000 ? 1 : 0)} km`;
  const subtitle = arriving
    ? shortPlace(destination)
    : `${distance} · ${formatClock(new Date(Date.now() + seconds * 1000))}`;
  return { title, subtitle, arriving };
}
