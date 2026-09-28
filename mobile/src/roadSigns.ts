import AsyncStorage from "@react-native-async-storage/async-storage";
import { haversineM } from "./fleetLogic";
import type { LatLon } from "./navCue";

export type RoadSign = {
  lat: number;
  lon: number;
  kind: "signal" | "stop" | "stop-all";
};

const SIGN_KEY = "smartshield.osmSigns.v2";
const memory = new Map<string, { at: number; signs: RoadSign[] }>();
const streets = new Map<string, string | null>();
const OVERPASS = "https://overpass-api.de/api/interpreter";

function cellKey(lat: number, lon: number): string {
  return `${lat.toFixed(2)},${lon.toFixed(2)}`;
}

async function readCache(key: string): Promise<RoadSign[] | null> {
  const hit = memory.get(key);
  if (hit && Date.now() - hit.at < 6 * 60 * 60 * 1000) return hit.signs;
  try {
    const raw = await AsyncStorage.getItem(SIGN_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as { key?: string; at?: number; signs?: RoadSign[] };
    if (saved.key === key && saved.at && Date.now() - saved.at < 6 * 60 * 60 * 1000 && Array.isArray(saved.signs)) {
      memory.set(key, { at: saved.at, signs: saved.signs });
      return saved.signs;
    }
  } catch {
    /* A missed cache just means another lookup. */
  }
  return null;
}

async function overpass(query: string): Promise<{ elements?: { lat?: number; lon?: number; tags?: Record<string, string> }[] } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(OVERPASS, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: `data=${encodeURIComponent(query)}`,
      signal: controller.signal,
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function stopKind(tags: Record<string, string> | undefined): "stop" | "stop-all" {
  const stop = (tags?.stop || "").toLowerCase().replace(/-/g, "_");
  const allWay = (tags?.all_way || tags?.["all-way"] || "").toLowerCase();
  if (stop === "all" || stop === "all_way" || stop === "allway" || allWay === "yes") return "stop-all";
  return "stop";
}

/** Traffic signals and stop signs near the driver. Empty when Overpass is unavailable. */
export async function loadSignsNear(lat: number, lon: number): Promise<RoadSign[]> {
  const key = cellKey(lat, lon);
  const cached = await readCache(key);
  if (cached) return cached;
  const query = `[out:json][timeout:12];(node["highway"="traffic_signals"](around:1200,${lat},${lon});node["highway"="stop"](around:1200,${lat},${lon}););out body 50;`;
  const data = await overpass(query);
  if (!data) {
    memory.set(key, { at: Date.now() - 6 * 60 * 60 * 1000 + 2 * 60 * 1000, signs: [] });
    return [];
  }
  const signs: RoadSign[] = [];
  for (const element of data.elements || []) {
    if (element.lat == null || element.lon == null) continue;
    const highway = element.tags?.highway;
    if (highway !== "traffic_signals" && highway !== "stop") continue;
    signs.push({
      lat: element.lat,
      lon: element.lon,
      kind: highway === "stop" ? stopKind(element.tags) : "signal",
    });
  }
  const at = Date.now();
  memory.set(key, { at, signs });
  AsyncStorage.setItem(SIGN_KEY, JSON.stringify({ key, at, signs })).catch(() => undefined);
  return signs;
}

export function signsAlong(signs: RoadSign[], line: LatLon[], maxM: number): RoadSign[] {
  if (!line.length) return signs.filter(() => false);
  return signs.filter((sign) => line.some((point) => haversineM(sign.lat, sign.lon, point[0], point[1]) <= maxM));
}

/** Best-effort name of the road at a point. Null when the lookup fails. */
export async function lookupStreet(lat: number, lon: number): Promise<string | null> {
  const key = `${lat.toFixed(3)},${lon.toFixed(3)}`;
  if (streets.has(key)) return streets.get(key) ?? null;
  const query = `[out:json][timeout:10];way(around:30,${lat},${lon})["highway"]["name"];out tags 1;`;
  const data = await overpass(query);
  const name = data?.elements?.find((element) => element.tags?.name)?.tags?.name || null;
  if (data) streets.set(key, name);
  return name;
}
