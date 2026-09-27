import {
  warningFor,
  type Hazard,
  type RoadSample,
  type StreetRules,
} from "./fleetLogic";
import { SAMPLE_ROUTE, type SampleRoute } from "./sampleRoute";

export type PlayableRoute = SampleRoute;

function speedAt(route: PlayableRoute, distance: number): number {
  for (const band of route.speed_profile) {
    if (distance < band.to_m) return band.kmh;
  }
  const last = route.speed_profile[route.speed_profile.length - 1];
  return last ? last.kmh : 50;
}

function pointAt(route: PlayableRoute, distance: number): [number, number] {
  const coords = route.coordinates;
  const cum = route.cumulative_m;
  if (!coords.length) return [0, 0];
  if (distance <= 0 || !cum.length) return [coords[0][1], coords[0][0]];
  if (distance >= cum[cum.length - 1]) {
    const last = coords[coords.length - 1];
    return [last[1], last[0]];
  }
  let index = 1;
  while (index < cum.length && cum[index] < distance) index += 1;
  const span = cum[index] - cum[index - 1] || 1;
  const t = (distance - cum[index - 1]) / span;
  const lon = coords[index - 1][0] + t * (coords[index][0] - coords[index - 1][0]);
  const lat = coords[index - 1][1] + t * (coords[index][1] - coords[index - 1][1]);
  return [lat, lon];
}

function modeFor(highway: string, rules: StreetRules): string {
  const key = highway.split(";")[0].trim().toLowerCase();
  const modes = rules.modes || {
    HIGHWAY: ["motorway", "trunk"],
    EXIT: ["motorway_link"],
    STREET: ["primary", "secondary", "tertiary", "residential"],
  };
  if ((modes.HIGHWAY || []).includes(key)) return "HIGHWAY";
  if ((modes.EXIT || []).includes(key)) return "EXIT";
  return "STREET";
}

function segmentAt(route: PlayableRoute, distance: number) {
  return route.segments.find((segment) => distance >= segment.from_m && distance < segment.to_m) || route.segments[route.segments.length - 1];
}

function aheadHazards(route: PlayableRoute, along: number, rules: StreetRules): Hazard[] {
  return route.hazards.flatMap((hazard) => {
    let best = 1e12;
    let hazardAlong = 0;
    route.coordinates.forEach((pair, index) => {
      const dLat = (pair[1] - hazard.lat) * 111320;
      const dLon = (pair[0] - hazard.lon) * 111320 * Math.cos((hazard.lat * Math.PI) / 180);
      const dist = Math.hypot(dLat, dLon);
      if (dist < best) {
        best = dist;
        hazardAlong = route.cumulative_m[index] || 0;
      }
    });
    const distance = hazardAlong - along;
    const cap = rules.caps[hazard.kind];
    const windowM = cap?.within_m ?? 80;
    if (distance < -15 || distance > windowM) return [];
    return [{
      id: hazard.id,
      kind: hazard.kind,
      label: hazard.label,
      lat: hazard.lat,
      lon: hazard.lon,
      distance_m: Math.max(0, Math.round(distance)),
    }];
  });
}

function safeFor(posted: number, mode: string, hazards: Hazard[], rules: StreetRules): number {
  if (mode === "HIGHWAY") return posted;
  let safe = posted;
  hazards.forEach((hazard) => {
    const cap = rules.caps[hazard.kind];
    if (!cap || cap.safe_kmh == null) return;
    const near = cap.within_m ?? cap.pass_m;
    if ((hazard.distance_m ?? 1e9) <= near) safe = Math.min(safe, cap.safe_kmh);
  });
  return safe;
}

/** One sample per second of the baked drive, using the published speed profile. */
export function buildSampleFrames(route: PlayableRoute, rules: StreetRules, startedMs: number): RoadSample[] {
  const frames: RoadSample[] = [];
  const exitAt = route.segments.find((segment) => segment.highway === "motorway_link")?.from_m;
  const warnMax = rules.exit_warning?.max_m ?? 500;
  let along = 0;
  let tick = 0;
  const total = route.total_m;
  while (along < total && tick < 400) {
    const kmh = speedAt(route, along);
    const [lat, lon] = pointAt(route, along);
    const segment = segmentAt(route, along);
    const mode = modeFor(segment?.highway || "residential", rules);
    const posted = segment?.maxspeed ?? 50;
    const hazards = aheadHazards(route, along, rules);
    const safe = safeFor(posted, mode, hazards, rules);
    const exitOn = exitAt != null && mode === "HIGHWAY" && along >= exitAt - warnMax && along < exitAt;
    frames.push({
      lat,
      lon,
      current_kmh: kmh,
      posted_kmh: posted,
      safe_kmh: safe,
      road_mode: mode,
      warning: warningFor(kmh, posted, safe),
      school_active: false,
      exit_warning: exitOn ? { text: rules.exit_warning?.text || "Slow down: exit ahead" } : null,
      hazards,
      sim_ms: startedMs + tick * 1000,
      source: "fleet-demo",
    });
    along += Math.max(8, kmh / 3.6);
    tick += 1;
  }
  return frames;
}

export { SAMPLE_ROUTE };
