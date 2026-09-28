/** Enforcement cameras and variable speed zones. Keep in sync with demo/static/js/cameras.js. */

import AsyncStorage from "@react-native-async-storage/async-storage";

export type CameraKind = "red_light" | "speed_camera" | "variable";

export type CameraFeature = {
  id: string;
  kind: CameraKind;
  lat: number;
  lon: number;
  limit_kmh: number | null;
  source?: string;
  road_class?: string | null;
  name?: string;
  points?: number[][];
};

export const CAMERA_DISCLAIMER = "Camera locations from OpenStreetMap and City of Toronto open data; may be incomplete.";

const CAMERA_KEY = "smartshield.cameraAlerts.v1";
const OVERPASS = "https://overpass-api.de/api/interpreter";
const HIGHWAY_ROADS = new Set(["motorway", "trunk", "motorway_link", "trunk_link"]);
const HIGHWAY_MODES = new Set(["HIGHWAY", "highway", "motorway", "trunk"]);
const CITY_M = 250;
const HIGHWAY_M = 400;
const DEDUPE_M = 30;
const ROUTE_CORRIDOR_M = 60;
const AHEAD_DEG = 60;

const osmMemory = new Map<string, { at: number; features: CameraFeature[] }>();
let torontoCache: { at: number; features: CameraFeature[] } | null = null;

export async function loadCameraAlerts(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(CAMERA_KEY)) !== "0";
  } catch {
    return true;
  }
}

export async function saveCameraAlerts(enabled: boolean): Promise<void> {
  await AsyncStorage.setItem(CAMERA_KEY, enabled ? "1" : "0");
}

function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const radius = 6371000;
  const p1 = lat1 * Math.PI / 180;
  const p2 = lat2 * Math.PI / 180;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dLon / 2) ** 2;
  return 2 * radius * Math.asin(Math.min(1, Math.sqrt(a)));
}

function headingDelta(heading: number, bearing: number): number {
  return (bearing - heading + 540) % 360 - 180;
}

function bearingDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const p1 = lat1 * Math.PI / 180;
  const p2 = lat2 * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const y = Math.sin(dLon) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dLon);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function parseLimit(...values: unknown[]): number | null {
  for (const value of values) {
    if (value == null || value === "") continue;
    const text = String(value).trim().toLowerCase();
    if (!text || ["signals", "variable", "yes", "no", "none", "walk", "urban", "rural"].includes(text)) continue;
    const match = text.match(/(\d+(?:\.\d+)?)/);
    if (!match) continue;
    let number = Number(match[1]);
    if (text.includes("mph")) number *= 1.60934;
    if (number >= 5 && number <= 200) return Math.round(number);
  }
  return null;
}

function kindFromTags(tags: Record<string, string>): CameraKind | null {
  const highway = String(tags.highway || "").toLowerCase();
  const enforcement = String(tags.enforcement || "").toLowerCase();
  const signal = enforcement === "traffic_signals" || enforcement === "red_light" || enforcement === "traffic_signal"
    || enforcement.includes("signal") || enforcement.includes("red");
  if (highway === "speed_camera" || ["maxspeed", "average_speed", "speed"].includes(enforcement) || enforcement.includes("speed")) {
    if (signal) return "red_light";
    if (highway === "speed_camera" || enforcement) return "speed_camera";
  }
  if (signal && enforcement) return "red_light";
  if ((tags["maxspeed:variable"] != null && tags["maxspeed:variable"] !== "") || String(tags.maxspeed || "").toLowerCase() === "signals") {
    return "variable";
  }
  const sign = String(tags.traffic_sign || "").toLowerCase();
  if (sign.includes("variable") && (sign.includes("speed") || sign.includes("maxspeed"))) return "variable";
  if (enforcement) return "speed_camera";
  return null;
}

type OsmElement = {
  type?: string;
  id?: number | string;
  lat?: number;
  lon?: number;
  center?: { lat?: number; lon?: number };
  geometry?: { lat?: number; lon?: number }[];
  members?: { role?: string; ref?: number; lat?: number; lon?: number }[];
  tags?: Record<string, string>;
};

function elementPoints(element: OsmElement, nodes: Map<number | string, number[]>): number[][] {
  if (element.lat != null && element.lon != null) return [[Number(element.lat), Number(element.lon)]];
  if (element.center?.lat != null && element.center.lon != null) return [[Number(element.center.lat), Number(element.center.lon)]];
  const geometry = (element.geometry || [])
    .filter((point) => point.lat != null && point.lon != null)
    .map((point) => [Number(point.lat), Number(point.lon)]);
  if (geometry.length > 40) {
    const step = geometry.length / 40;
    return Array.from({ length: 40 }, (_, index) => geometry[Math.floor(index * step)]);
  }
  if (geometry.length) return geometry;
  if (element.type === "relation") {
    const ranked: { rank: number; point: number[] }[] = [];
    (element.members || []).forEach((member) => {
      const role = String(member.role || "").toLowerCase();
      if (role !== "device" && role !== "from") return;
      let lat = member.lat;
      let lon = member.lon;
      if (lat == null || lon == null) {
        const found = member.ref != null ? nodes.get(member.ref) : undefined;
        if (!found) return;
        [lat, lon] = found;
      }
      ranked.push({ rank: role === "device" ? 0 : 1, point: [Number(lat), Number(lon)] });
    });
    ranked.sort((a, b) => a.rank - b.rank);
    if (ranked.length) return [ranked[0].point];
  }
  return [];
}

export function parseOverpass(elements: OsmElement[] | null | undefined): CameraFeature[] {
  const nodes = new Map<number | string, number[]>();
  (elements || []).forEach((element) => {
    if (element.type === "node" && element.id != null && element.lat != null && element.lon != null) {
      nodes.set(element.id, [Number(element.lat), Number(element.lon)]);
    }
  });
  const found: CameraFeature[] = [];
  (elements || []).forEach((element) => {
    const tags = element.tags || {};
    if (element.type === "relation" && String(tags.type || "").toLowerCase() !== "enforcement") return;
    if (element.type === "relation") {
      const enforcement = String(tags.enforcement || "").toLowerCase();
      if (enforcement !== "maxspeed" && enforcement !== "traffic_signals" && !enforcement.includes("speed") && !enforcement.includes("signal")) return;
    }
    const kind = kindFromTags(tags);
    if (!kind) return;
    const points = elementPoints(element, nodes);
    if (!points.length) return;
    const midpoint = points[Math.floor(points.length / 2)];
    const highway = String(tags.highway || "").toLowerCase();
    found.push({
      id: `osm:${element.type || "node"}:${element.id}`,
      kind,
      lat: midpoint[0],
      lon: midpoint[1],
      limit_kmh: parseLimit(tags["maxspeed:variable"], tags.maxspeed, tags["maxspeed:forward"]),
      source: "osm",
      road_class: HIGHWAY_ROADS.has(highway) ? highway : null,
      name: tags.name || tags.description || "",
      points,
    });
  });
  return collapse(found, 20);
}

function collapse(features: CameraFeature[], metres: number): CameraFeature[] {
  const kept: CameraFeature[] = [];
  features.forEach((item) => {
    const match = kept.find((other) => other.kind === item.kind && haversineM(item.lat, item.lon, other.lat, other.lon) <= metres);
    if (!match) {
      kept.push(item);
      return;
    }
    if (match.limit_kmh == null && item.limit_kmh != null) match.limit_kmh = item.limit_kmh;
  });
  return kept;
}

export function dedupeCameras(osm: CameraFeature[], toronto: CameraFeature[], metres = DEDUPE_M): CameraFeature[] {
  const kept = (osm || []).map((item) => ({
    ...item,
    points: item.points && item.points.length ? item.points.slice() : [[item.lat, item.lon]],
  }));
  (toronto || []).forEach((item) => {
    const duplicate = kept.find((other) => other.kind === item.kind && haversineM(item.lat, item.lon, other.lat, other.lon) <= metres);
    if (duplicate) {
      if (duplicate.limit_kmh == null && item.limit_kmh != null) duplicate.limit_kmh = item.limit_kmh;
      return;
    }
    kept.push(item);
  });
  return kept;
}

function featurePoints(feature: CameraFeature): number[][] {
  if (feature.points && feature.points.length) return feature.points;
  return [[feature.lat, feature.lon]];
}

function distanceTo(feature: CameraFeature, lat: number, lon: number): number {
  return Math.min(...featurePoints(feature).map((point) => haversineM(lat, lon, point[0], point[1])));
}

function onRoute(feature: CameraFeature, route: number[][]): boolean {
  if (!route.length) return false;
  return featurePoints(feature).some((point) => route.some((stop) => haversineM(point[0], point[1], stop[0], stop[1]) <= ROUTE_CORRIDOR_M));
}

function aheadOfHeading(feature: CameraFeature, lat: number, lon: number, heading: number | null | undefined): boolean {
  if (heading == null || Number.isNaN(Number(heading))) return false;
  let nearest = featurePoints(feature)[0];
  let best = Infinity;
  featurePoints(feature).forEach((point) => {
    const distance = haversineM(lat, lon, point[0], point[1]);
    if (distance < best) {
      best = distance;
      nearest = point;
    }
  });
  return Math.abs(headingDelta(Number(heading), bearingDeg(lat, lon, nearest[0], nearest[1]))) <= AHEAD_DEG;
}

export function alertPhrase(feature: CameraFeature, postedKmh?: number | null): string {
  let limit = feature.limit_kmh;
  if (limit == null && postedKmh != null) {
    const number = Math.round(Number(postedKmh));
    if (!Number.isNaN(number)) limit = number;
  }
  if (feature.kind === "red_light") return "Red light camera at the next intersection";
  if (feature.kind === "speed_camera") return limit ? `Speed camera ahead, limit ${Number(limit)}` : "Speed camera ahead";
  return limit ? `Variable speed limit zone, usually posted ${Number(limit)}` : "Variable speed limit zone";
}

export function alertsAhead(
  features: CameraFeature[],
  lat: number,
  lon: number,
  options: {
    heading?: number | null;
    route?: number[][];
    roadMode?: string | null;
    postedKmh?: number | null;
    spoken?: Record<string, boolean> | Set<string>;
  } = {},
): { id: string; kind: CameraKind; phrase: string; distance_m: number }[] {
  const route = options.route || [];
  const useRoute = route.length >= 2;
  const spoken = options.spoken;
  const chosen: { distance: number; feature: CameraFeature }[] = [];
  (features || []).forEach((feature) => {
    if (!feature.id) return;
    if (spoken instanceof Set ? spoken.has(feature.id) : !!spoken?.[feature.id]) return;
    const distance = distanceTo(feature, lat, lon);
    const onHighway = (feature.road_class != null && HIGHWAY_ROADS.has(feature.road_class))
      || (options.roadMode != null && HIGHWAY_MODES.has(options.roadMode));
    const limit = onHighway ? HIGHWAY_M : CITY_M;
    if (distance > limit || distance < 15) return;
    if (useRoute) {
      if (!onRoute(feature, route)) return;
    } else if (!aheadOfHeading(feature, lat, lon, options.heading)) return;
    chosen.push({ distance, feature });
  });
  chosen.sort((a, b) => a.distance - b.distance);
  return chosen.map((item) => ({
    id: item.feature.id,
    kind: item.feature.kind,
    phrase: alertPhrase(item.feature, options.postedKmh),
    distance_m: Math.round(item.distance * 10) / 10,
  }));
}

export function overpassQuery(lat: number, lon: number): string {
  const around = `(around:1400,${Number(lat)},${Number(lon)})`;
  return `[out:json][timeout:18];(node["highway"="speed_camera"]${around};node["enforcement"]${around};way["maxspeed:variable"]${around};way["maxspeed"="signals"]${around};node["traffic_sign"~"variable",i]${around};way["traffic_sign"~"variable",i]${around};);out tags center;rel["type"="enforcement"]["enforcement"~"maxspeed|traffic_signals"]${around};out geom;`;
}

export async function loadEnforcement(lat: number, lon: number, apiBase: string): Promise<CameraFeature[]> {
  const cell = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  const cached = osmMemory.get(cell);
  let osm: CameraFeature[] = [];
  if (cached && Date.now() - cached.at < 6 * 60 * 60 * 1000) {
    osm = cached.features;
  } else {
    osm = await fetchOsm(lat, lon);
    osmMemory.set(cell, { at: Date.now(), features: osm });
  }
  const toronto = await fetchToronto(apiBase);
  return dedupeCameras(osm, toronto);
}

async function fetchOsm(lat: number, lon: number): Promise<CameraFeature[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(OVERPASS, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: `data=${encodeURIComponent(overpassQuery(lat, lon))}`,
      signal: controller.signal,
    });
    if (!response.ok) return [];
    const data = await response.json();
    return parseOverpass(data.elements || []);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

async function fetchToronto(apiBase: string): Promise<CameraFeature[]> {
  if (torontoCache && Date.now() - torontoCache.at < 6 * 60 * 60 * 1000) return torontoCache.features;
  try {
    const response = await fetch(`${apiBase.replace(/\/$/, "")}/api/cameras`, { headers: { Accept: "application/json" } });
    if (!response.ok) return torontoCache?.features || [];
    const data = await response.json();
    const features = Array.isArray(data.features) ? data.features as CameraFeature[] : [];
    torontoCache = { at: Date.now(), features };
    return features;
  } catch {
    return torontoCache?.features || [];
  }
}
