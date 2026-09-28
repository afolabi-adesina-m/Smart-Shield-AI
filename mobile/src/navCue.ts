import { haversineM } from "./fleetLogic";

export type LatLon = [number, number];

export type ManeuverKind =
  | "straight"
  | "left"
  | "right"
  | "slight-left"
  | "slight-right"
  | "uturn"
  | "arrive";

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
  }[maneuver.kind];
  return `${lead}${turn} onto ${maneuver.street}`.trim();
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
