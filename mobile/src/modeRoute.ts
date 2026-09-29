import type { ModeSummary, OsrmRoute, Place, TransitItinerary, TransitLeg, TravelMode, TravelPlan } from "./types";

/** Keep these in step with demo/travel_modes.py. */
export const CYCLE_KMH = 16.5;
export const WALK_KMH = 4.8;
const CYCLE_FAST_KMH = 25;
const WALK_FAST_KMH = 7;

export const ROUTER_USER_AGENT = "SmartShieldCapstone/1.0 (Sheridan PAIDA academic demo)";

const BIKE_HOSTS = [
  "https://routing.openstreetmap.de/routed-bike/route/v1/bike",
  "https://router.project-osrm.org/route/v1/bike",
];
const FOOT_HOSTS = [
  "https://routing.openstreetmap.de/routed-foot/route/v1/foot",
  "https://router.project-osrm.org/route/v1/foot",
];
const TRANSIT_URL = "https://api.transitous.org/api/v1/plan";

const CACHE_OK_MS = 10 * 60 * 1000;
const CACHE_FAIL_MS = 45 * 1000;
const cache = new Map<string, { until: number; plan: TravelPlan | null }>();

const MODE_LABELS: Record<string, string> = {
  BUS: "Bus",
  TRAM: "Streetcar",
  SUBWAY: "Subway",
  RAIL: "Train",
  REGIONAL_RAIL: "Train",
  FERRY: "Ferry",
  WALK: "Walk",
};

export function realisticSeconds(
  mode: "cycle" | "walk",
  distanceM: number | null | undefined,
  durationS: number | null | undefined,
): { seconds: number | null; estimated: boolean } {
  if (distanceM == null || distanceM <= 0) return { seconds: durationS ?? null, estimated: false };
  const limit = mode === "cycle" ? CYCLE_FAST_KMH : WALK_FAST_KMH;
  const pace = mode === "cycle" ? CYCLE_KMH : WALK_KMH;
  if (durationS != null && durationS > 0) {
    const speed = (distanceM / durationS) * 3.6;
    if (speed <= limit) return { seconds: durationS, estimated: false };
  }
  return { seconds: distanceM / (pace * 1000 / 3600), estimated: true };
}

/** A non-drive chip may use this body only when the server named that mode. */
export function echoesMode(plan: TravelPlan, mode: TravelMode): boolean {
  if (mode === "drive") return !plan.mode || plan.mode === "drive";
  if (mode === "motorcycle") return plan.mode === "motorcycle" || plan.mode === "drive" || !plan.mode;
  if (plan.mode !== mode) return false;
  if (mode === "transit") return transitSeconds(plan.itineraries?.[0]) != null;
  return true;
}

export function transitSeconds(item?: { duration_s?: number | null; start?: string | null; end?: string | null } | null): number | null {
  if (!item) return null;
  if (typeof item.duration_s === "number" && item.duration_s > 0) return item.duration_s;
  if (item.start && item.end) {
    const span = Date.parse(item.end) - Date.parse(item.start);
    if (span > 0) return span / 1000;
  }
  return null;
}

export function summaryOf(plan: TravelPlan, mode: TravelMode): ModeSummary {
  if (mode === "motorcycle") {
    const drive = summaryOf({ ...plan, mode: "drive" }, "drive");
    return drive.durationS == null ? drive : { ...drive, via: "car" };
  }
  if (mode === "transit") {
    if (!echoesMode(plan, "transit")) return { durationS: null, distanceM: null, failed: true };
    const item = plan.itineraries?.[0];
    return { durationS: transitSeconds(item), distanceM: item?.distance_m ?? null };
  }
  if ((mode === "cycle" || mode === "walk") && !echoesMode(plan, mode)) {
    return { durationS: null, distanceM: null, failed: true };
  }
  const head = plan.routes[0];
  if (!head || head.duration == null) return { durationS: null, distanceM: null, failed: true };
  return { durationS: head.duration, distanceM: head.distance };
}

export function adjustPlan(plan: TravelPlan, mode: TravelMode): TravelPlan {
  if (mode !== "cycle" && mode !== "walk") return plan;
  let estimated = false;
  const routes = (plan.routes || []).map((route) => {
    const paced = realisticSeconds(mode, route.distance, route.duration);
    if (!paced.estimated || paced.seconds == null) return route;
    estimated = true;
    return {
      ...route,
      duration: paced.seconds,
      summary: relabel(route.summary, route.distance, paced.seconds),
    };
  });
  if (!estimated) return plan;
  const pace = mode === "cycle" ? CYCLE_KMH : WALK_KMH;
  const kind = mode === "cycle" ? "Bicycle" : "Walking";
  return {
    ...plan,
    mode,
    routes,
    note: `${kind} time is estimated at ${pace} km/h from the route distance. The router returned a driving-like duration.`,
  };
}

function relabel(summary: string | undefined, distanceM: number | null, durationS: number): string {
  const prefix = (summary || "Route").split(" · ")[0] || "Route";
  const km = distanceM == null ? 0 : distanceM / 1000;
  return `${prefix} · ${km.toFixed(0)} km · ${Math.round(durationS / 60)} min`;
}

export function decodePolyline(encoded: string, precision = 5): [number, number][] {
  if (!encoded) return [];
  const factor = 10 ** precision;
  const points: [number, number][] = [];
  let index = 0;
  let lat = 0;
  let lon = 0;
  while (index < encoded.length) {
    const latStep = delta(encoded, index);
    index = latStep.index;
    const lonStep = delta(encoded, index);
    index = lonStep.index;
    lat += latStep.value;
    lon += lonStep.value;
    points.push([lon / factor, lat / factor]);
  }
  return points;
}

function delta(encoded: string, index: number): { value: number; index: number } {
  let shift = 0;
  let result = 0;
  while (index < encoded.length) {
    const byte = encoded.charCodeAt(index) - 63;
    index += 1;
    result |= (byte & 0x1f) << shift;
    shift += 5;
    if (byte < 0x20) break;
  }
  const value = result & 1 ? ~(result >> 1) : result >> 1;
  return { value, index };
}

export function decodePolylineAuto(encoded: string): [number, number][] {
  if (!encoded) return [];
  for (const precision of [5, 6, 7]) {
    const points = decodePolyline(encoded, precision);
    if (points.length && points[0][0] >= -180 && points[0][0] <= 180 && points[0][1] >= -90 && points[0][1] <= 90) {
      return points;
    }
  }
  return [];
}

export async function fetchDirectPlan(from: Place, to: Place, mode: TravelMode, summary: boolean): Promise<TravelPlan> {
  if (from.lat == null || from.lon == null || to.lat == null || to.lon == null) {
    throw new Error("Need a start and a destination.");
  }
  const key = `${mode}:${summary ? "s" : "f"}:${from.lat.toFixed(4)}:${from.lon.toFixed(4)}:${to.lat.toFixed(4)}:${to.lon.toFixed(4)}`;
  const fullKey = key.replace(":s:", ":f:");
  const now = Date.now();
  const hit = cache.get(key) || (summary ? cache.get(fullKey) : undefined);
  if (hit && hit.until > now) {
    if (!hit.plan) throw new Error(unavailable(mode));
    return summary ? presentSummary(hit.plan) : hit.plan;
  }
  try {
    const plan = mode === "transit"
      ? await fetchTransit(from.lat, from.lon, to.lat, to.lon)
      : await fetchProfile(mode === "cycle" ? "cycle" : "walk", from.lat, from.lon, to.lat, to.lon, summary);
    if (mode === "transit" || !summary) cache.set(fullKey, { until: now + CACHE_OK_MS, plan });
    if (summary) cache.set(key, { until: now + CACHE_OK_MS, plan });
    return summary && mode !== "transit" ? presentSummary(plan) : plan;
  } catch (error) {
    cache.set(key, { until: now + CACHE_FAIL_MS, plan: null });
    throw error instanceof Error ? error : new Error(unavailable(mode));
  }
}

function presentSummary(plan: TravelPlan): TravelPlan {
  return {
    ...plan,
    routes: (plan.routes || []).map((route) => ({
      distance: route.distance,
      duration: route.duration,
      summary: route.summary,
      geometry: [],
      mid_lat: null,
      mid_lon: null,
      steps: [],
    })),
  };
}

function unavailable(mode: TravelMode): string {
  if (mode === "cycle") return "Bicycle routing is unavailable right now.";
  if (mode === "walk") return "Walking routing is unavailable right now.";
  return "Transit routing is unavailable right now.";
}

async function fetchProfile(
  mode: "cycle" | "walk",
  fromLat: number,
  fromLon: number,
  toLat: number,
  toLon: number,
  summary: boolean,
): Promise<TravelPlan> {
  const hosts = mode === "cycle" ? BIKE_HOSTS : FOOT_HOSTS;
  const coords = `${fromLon},${fromLat};${toLon},${toLat}`;
  let last = unavailable(mode);
  for (const base of hosts) {
    try {
      const data = await getJson(`${base}/${coords}`, {
        alternatives: "false",
        overview: summary ? "false" : "full",
        geometries: "geojson",
        steps: summary ? "false" : "true",
      });
      const routes = Array.isArray(data.routes) ? data.routes : [];
      if (data.code !== "Ok" || !routes.length) {
        last = String(data.message || last);
        continue;
      }
      return adjustPlan({
        mode,
        routes: routes.slice(0, 3).map((route, index) => osrmRoute(index, route as OsrmRaw)),
      }, mode);
    } catch (error) {
      last = error instanceof Error ? error.message : last;
    }
  }
  throw new Error(last);
}

type OsrmRaw = {
  distance?: number;
  duration?: number;
  geometry?: { coordinates?: [number, number][] };
  legs?: { steps?: OsrmStep[] }[];
};

type OsrmStep = {
  name?: string;
  ref?: string;
  distance?: number;
  geometry?: { coordinates?: [number, number][] };
  maneuver?: { type?: string; modifier?: string; location?: [number, number] };
};

function osrmRoute(index: number, route: OsrmRaw): OsrmRoute {
  const geometry = route.geometry?.coordinates || [];
  const mid = geometry.length ? geometry[Math.floor(geometry.length / 2)] : null;
  const distance = typeof route.distance === "number" ? route.distance : null;
  const duration = typeof route.duration === "number" ? route.duration : null;
  const labels = ["Fastest route", "Alternate route", "Scenic / longer route"];
  const km = (distance || 0) / 1000;
  const minutes = (duration || 0) / 60;
  return {
    distance,
    duration,
    summary: `${labels[index] || `Route ${index + 1}`} · ${km.toFixed(0)} km · ${minutes.toFixed(0)} min`,
    geometry,
    mid_lon: mid ? mid[0] : null,
    mid_lat: mid ? mid[1] : null,
    steps: stepsFromRoute(route),
  };
}

function stepsFromRoute(route: OsrmRaw): OsrmRoute["steps"] {
  const steps: NonNullable<OsrmRoute["steps"]> = [];
  for (const leg of route.legs || []) {
    for (const step of leg.steps || []) {
      const maneuver = step.maneuver || {};
      const geometry = step.geometry?.coordinates || [];
      const location = maneuver.location && maneuver.location.length >= 2 ? maneuver.location : geometry[0] || null;
      if (!location && !geometry.length) continue;
      const name = roadLabel(step.name, step.ref);
      steps.push({
        name,
        ref: (step.ref || "").trim(),
        distance: step.distance || 0,
        location,
        geometry,
        type: maneuver.type || "",
        modifier: maneuver.modifier || "",
        instruction: name,
      });
    }
  }
  return steps;
}

function roadLabel(name?: string, ref?: string): string {
  const cleaned = (name || "").trim();
  if (cleaned) return cleaned;
  const token = (ref || "").trim();
  if (/^\d{1,4}[A-Z]?$/.test(token)) return `Hwy ${token}`;
  return token || "Unnamed road";
}

async function fetchTransit(fromLat: number, fromLon: number, toLat: number, toLon: number): Promise<TravelPlan> {
  const data = await getJson(TRANSIT_URL, {
    fromPlace: `${fromLat},${fromLon}`,
    toPlace: `${toLat},${toLon}`,
    numItineraries: "3",
  });
  const itineraries: TransitItinerary[] = [];
  for (const raw of (data.itineraries || []).slice(0, 3)) {
    const built = buildItinerary(raw);
    if (built) itineraries.push(built);
  }
  if (!itineraries.length) throw new Error("No transit itinerary was returned for these places.");
  const scheduled = itineraries.some((item) => item.scheduled);
  return {
    mode: "transit",
    scheduled,
    note: scheduled ? "Scheduled times from Transitous. Not live departures." : null,
    itineraries,
    routes: itineraries.map(itineraryRoute),
  };
}

function buildItinerary(raw: Record<string, unknown>): TransitItinerary | null {
  const legs = ((raw.legs as Record<string, unknown>[]) || []).map(buildLeg).filter((leg): leg is TransitLeg => !!leg);
  const duration = transitSeconds({
    duration_s: typeof raw.duration === "number" ? raw.duration : null,
    start: typeof raw.startTime === "string" ? raw.startTime : null,
    end: typeof raw.endTime === "string" ? raw.endTime : null,
  });
  if (!legs.length || duration == null) return null;
  const distances = legs.map((leg) => leg.distance_m).filter((value): value is number => typeof value === "number");
  const distanceKnown = legs.every((leg) => leg.mode === "WALK" || typeof leg.distance_m === "number");
  const walk = legs.filter((leg) => leg.mode === "WALK" && typeof leg.duration_s === "number").map((leg) => leg.duration_s as number);
  return {
    duration_s: duration,
    start: typeof raw.startTime === "string" ? raw.startTime : null,
    end: typeof raw.endTime === "string" ? raw.endTime : null,
    transfers: typeof raw.transfers === "number" ? raw.transfers : null,
    walk_min: walk.length ? Math.round(walk.reduce((sum, value) => sum + value, 0) / 60) : null,
    distance_m: distanceKnown && distances.length ? distances.reduce((sum, value) => sum + value, 0) : null,
    summary: transitSummary(legs),
    scheduled: legs.some((leg) => !leg.realtime),
    legs,
  };
}

function buildLeg(raw: Record<string, unknown>): TransitLeg | null {
  const mode = String(raw.mode || "").toUpperCase();
  if (!mode) return null;
  const geometry = decodePolylineAuto(String((raw.legGeometry as { points?: string } | undefined)?.points || ""));
  const colour = hexColour(raw.routeColor);
  const stops = ((raw.intermediateStops as { name?: string; lat?: number; lon?: number }[]) || []).flatMap((stop) => {
    const name = (stop.name || "").trim();
    if (!name && stop.lat == null) return [];
    return [{ name, lat: stop.lat ?? null, lon: stop.lon ?? null }];
  });
  const origin = (raw.from as { name?: string; departure?: string }) || {};
  const dest = (raw.to as { name?: string; arrival?: string }) || {};
  const duration = typeof raw.duration === "number" ? raw.duration : null;
  const distance = typeof raw.distance === "number" ? raw.distance : null;
  const line = String(raw.routeShortName || "").trim() || null;
  return {
    mode,
    line,
    long_name: String(raw.routeLongName || "").trim() || null,
    color: colour,
    color_missing: colour == null && mode !== "WALK",
    draw_color: colour || (mode === "WALK" ? "#1a73e8" : "#5f6368"),
    headsign: String(raw.headsign || "").trim() || null,
    agency: String(raw.agencyName || "").trim() || null,
    from_name: (origin.name || "").trim() || null,
    to_name: (dest.name || "").trim() || null,
    departure: origin.departure || (typeof raw.startTime === "string" ? raw.startTime : null),
    arrival: dest.arrival || (typeof raw.endTime === "string" ? raw.endTime : null),
    stop_count: stops.length,
    stops,
    duration_s: duration,
    distance_m: distance,
    walk_min: mode === "WALK" && duration != null ? (duration >= 30 ? Math.max(1, Math.round(duration / 60)) : 0) : null,
    realtime: Boolean(raw.realTime),
    geometry,
  };
}

function itineraryRoute(item: TransitItinerary): OsrmRoute {
  const geometry: [number, number][] = [];
  for (const leg of item.legs) {
    for (const point of leg.geometry || []) {
      if (geometry.length && geometry[geometry.length - 1][0] === point[0] && geometry[geometry.length - 1][1] === point[1]) continue;
      geometry.push(point);
    }
  }
  const mid = geometry.length ? geometry[Math.floor(geometry.length / 2)] : null;
  return {
    distance: item.distance_m ?? null,
    duration: item.duration_s,
    summary: item.summary || "Transit",
    geometry,
    mid_lon: mid ? mid[0] : null,
    mid_lat: mid ? mid[1] : null,
    steps: [],
    legs: item.legs,
  };
}

function transitSummary(legs: TransitLeg[]): string {
  const parts = legs.filter((leg) => leg.mode !== "WALK").map((leg) => {
    const label = MODE_LABELS[leg.mode] || leg.mode.replace(/_/g, " ");
    return leg.line ? `${label} ${leg.line}` : label;
  });
  return parts.length ? parts.join(" · ") : "Walk";
}

function hexColour(raw: unknown): string | null {
  const text = String(raw || "").trim().replace(/^#/, "");
  if (text.length === 6 && /^[0-9a-fA-F]+$/.test(text)) return `#${text.toLowerCase()}`;
  return null;
}

async function getJson(url: string, params: Record<string, string>): Promise<Record<string, any>> {
  const query = new URLSearchParams(params).toString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(`${url}?${query}`, {
      headers: { Accept: "application/json", "User-Agent": ROUTER_USER_AGENT },
      signal: controller.signal,
    });
    if (response.status === 429 || response.status >= 500) {
      throw new Error("The routing service is busy.");
    }
    if (!response.ok) throw new Error("The routing service rejected the request.");
    return await response.json() as Record<string, any>;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("The routing service")) throw error;
    throw new Error("The routing service did not respond.");
  } finally {
    clearTimeout(timer);
  }
}
