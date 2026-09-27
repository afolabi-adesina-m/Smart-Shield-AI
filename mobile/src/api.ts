import { API_BASE } from "./config";
import type { StreetRules } from "./fleetLogic";
import type { PlayableRoute } from "./samplePlayback";
import type {
  Health,
  OsrmRoute,
  Place,
  PracticeLoop,
  ScoredRoute,
  SpeedReading,
  Suggestion,
  TestCentre,
} from "./types";

const ATTEMPTS = 3;
const ATTEMPT_MS = 65000;

export class ApiError extends Error {
  status: number;

  constructor(message: string, status = 0) {
    super(message);
    this.status = status;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** One long try, then two more. Covers a Render free-plan cold start. */
export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  let last: unknown;
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ATTEMPT_MS);
    try {
      const headers = new Headers(init?.headers);
      headers.set("Accept", "application/json");
      if (init?.body && !headers.has("Content-Type")) {
        headers.set("Content-Type", "application/json");
      }
      const response = await fetch(`${API_BASE}${path}`, {
        ...init,
        headers,
        signal: controller.signal,
      });
      if (response.status >= 500 && attempt < ATTEMPTS - 1) {
        const preview = await response.clone().text();
        const rateLimited = /too many requests/i.test(preview);
        if (!rateLimited) {
          await sleep(2000 * (attempt + 1));
          continue;
        }
      }
      return response;
    } catch (error) {
      last = error;
      if (attempt < ATTEMPTS - 1) {
        await sleep(2000 * (attempt + 1));
        continue;
      }
    } finally {
      clearTimeout(timer);
    }
  }
  const message = last instanceof Error && last.name === "AbortError"
    ? "The server did not answer in time. It may still be waking up. Try again."
    : "Could not reach the Smart-Shield server.";
  throw new ApiError(message);
}

async function readJson<T>(response: Response): Promise<T> {
  const data = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) {
    const raw = data.error || `Request failed (${response.status})`;
    const message = /429|too many requests/i.test(raw)
      ? "Address lookup is busy. Pick a suggestion from the list, or try again in a moment."
      : raw;
    throw new ApiError(message, response.status);
  }
  return data as T;
}

export function fetchHealth(): Promise<Health> {
  return apiFetch("/api/health").then((response) => readJson<Health>(response));
}

export async function suggestPlaces(query: string, bias?: { lat: number; lon: number }): Promise<Suggestion[]> {
  const params = new URLSearchParams({ q: query });
  if (bias) {
    params.set("lat", String(bias.lat));
    params.set("lon", String(bias.lon));
  }
  const data = await apiFetch(`/api/suggest?${params.toString()}`).then((response) =>
    readJson<{ suggestions?: Suggestion[] }>(response),
  );
  return data.suggestions || [];
}

export function geocodePlace(query: string): Promise<Place> {
  return apiFetch(`/api/geocode?q=${encodeURIComponent(query)}`).then((response) =>
    readJson<{ lat: number; lon: number; display_name?: string }>(response).then((hit) => ({
      label: hit.display_name || query,
      lat: hit.lat,
      lon: hit.lon,
    })),
  );
}

export function fetchDirections(from: Place, to: Place): Promise<OsrmRoute[]> {
  const params = new URLSearchParams({
    from_lat: String(from.lat),
    from_lon: String(from.lon),
    to_lat: String(to.lat),
    to_lon: String(to.lon),
  });
  return apiFetch(`/api/directions?${params.toString()}`).then((response) =>
    readJson<{ routes?: OsrmRoute[] }>(response).then((data) => data.routes || []),
  );
}

export function scoreRoutes(
  routes: OsrmRoute[],
  weather: string,
): Promise<{ routes: ScoredRoute[]; best_route_index: number }> {
  const body = {
    weather,
    vision_mode: "auto",
    routes: routes.map((route, index) => ({
      route_index: index,
      distance_m: route.distance,
      duration_s: route.duration,
      summary: route.summary,
      mid_lat: route.mid_lat,
      mid_lon: route.mid_lon,
    })),
  };
  return apiFetch("/api/score-routes", {
    method: "POST",
    body: JSON.stringify(body),
  }).then((response) => readJson(response));
}

export function fetchSpeed(lat: number, lon: number, tier?: string, weather?: string): Promise<SpeedReading> {
  const params = new URLSearchParams({ lat: String(lat), lon: String(lon) });
  if (tier) params.set("tier", tier);
  if (weather) params.set("weather", weather);
  return apiFetch(`/api/speed-limit?${params.toString()}`).then((response) => readJson<SpeedReading>(response));
}

export function fetchCentres(): Promise<{ centres: TestCentre[]; disclaimer: string }> {
  return apiFetch("/api/test-centres").then((response) =>
    readJson<{ centres?: TestCentre[]; disclaimer?: string }>(response).then((data) => ({
      centres: data.centres || [],
      disclaimer: data.disclaimer || "",
    })),
  );
}

export function buildLoop(centreId: string, level: string): Promise<PracticeLoop> {
  return apiFetch("/api/test-loop", {
    method: "POST",
    body: JSON.stringify({ centre_id: centreId, level }),
  }).then((response) => readJson<PracticeLoop>(response));
}

export function fetchStreetRules(): Promise<StreetRules> {
  return apiFetch("/api/street-rules").then((response) => readJson<StreetRules>(response));
}

export function fetchRoadContext(body: {
  lat: number;
  lon: number;
  weather?: string;
  tier?: string;
  recommended_kmh?: number | null;
  bearing?: number | null;
  geometry?: [number, number][];
}): Promise<SpeedReading> {
  return apiFetch("/api/road-context", {
    method: "POST",
    body: JSON.stringify(body),
  }).then((response) => readJson<SpeedReading>(response));
}

export async function fetchFleetDemoRoute(): Promise<PlayableRoute | null> {
  try {
    const response = await fetch(`${API_BASE}/api/fleet-demo-route`, { headers: { Accept: "application/json" } });
    if (!response.ok) return null;
    const route = (await response.json()) as PlayableRoute;
    if (!route.coordinates?.length) return null;
    return route;
  } catch {
    return null;
  }
}
