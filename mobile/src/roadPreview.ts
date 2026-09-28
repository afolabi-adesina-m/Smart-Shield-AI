import type { RoadStep } from "./types";

export const UNNAMED_ROAD = "Unnamed road";
const HIGHWAY_REF = /^\d{1,4}[A-Z]?$/;

export function roadLabel(name?: string | null, ref?: string | null): string {
  const cleaned = (name || "").trim();
  if (cleaned) return cleaned;
  const roadRef = (ref || "").trim();
  if (HIGHWAY_REF.test(roadRef)) return `Hwy ${roadRef}`;
  if (roadRef) return roadRef;
  return UNNAMED_ROAD;
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

/** Geometry points are [lon, lat], matching OSRM. */
export function nearestStep<T extends { geometry?: [number, number][] }>(
  steps: T[],
  lat: number,
  lon: number,
): T | null {
  let best: T | null = null;
  let bestDistance = Infinity;
  steps.forEach((step) => {
    (step.geometry || []).forEach((pair) => {
      if (!pair || pair.length < 2) return;
      const distance = haversineM(lat, lon, pair[1], pair[0]);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = step;
      }
    });
  });
  return best;
}

export function previewFromStep(step: RoadStep): {
  name: string;
  coords: [number, number][];
  lat: number;
  lon: number;
} {
  const coords = (step.geometry || [])
    .filter((pair) => pair && pair.length >= 2)
    .map(([lon, lat]) => [lat, lon] as [number, number]);
  const location = step.location;
  const lat = location ? location[1] : (coords[0]?.[0] ?? 0);
  const lon = location ? location[0] : (coords[0]?.[1] ?? 0);
  return { name: step.name || UNNAMED_ROAD, coords, lat, lon };
}
