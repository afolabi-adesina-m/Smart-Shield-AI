/**
 * Traffic lights passed, and full stops before them. Spec §2.
 * Counts are information only; score.ts does not penalise them.
 */

export type TrackFix = {
  t: number;
  lat: number;
  lon: number;
  speedKmh: number | null;
};

export type LightNode = { lat: number; lon: number };

export type LightMatch = {
  passed: number;
  fullStops: number;
};

export function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const radius = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * radius * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * A light is passed when the track enters its radius and later moves outside it.
 * A full stop is speed at or under the stop threshold for the hold time, inside
 * the radius, before that pass.
 */
export function matchLights(
  fixes: TrackFix[],
  lights: LightNode[],
  radiusM: number,
  stopSpeedKmh: number,
  stopHoldS: number,
): LightMatch {
  let passed = 0;
  let fullStops = 0;
  const ordered = [...fixes].sort((a, b) => a.t - b.t);
  for (const light of lights) {
    let inside = false;
    let didPass = false;
    let stopRun = 0;
    let countedStop = false;
    let prevStopping = false;
    let prevT: number | null = null;
    for (const fix of ordered) {
      const dt = prevT == null ? 0 : fix.t - prevT;
      const distance = haversineM(fix.lat, fix.lon, light.lat, light.lon);
      const inRadius = distance <= radiusM;
      const slow = fix.speedKmh != null && fix.speedKmh <= stopSpeedKmh;
      const stopping = !didPass && inRadius && slow;
      if (stopping && prevStopping) stopRun += dt;
      else stopRun = 0;
      if (stopping && stopRun + 1e-9 >= stopHoldS && !countedStop) {
        countedStop = true;
        fullStops += 1;
      }
      if (inRadius) inside = true;
      if (inside && !didPass && !inRadius) {
        didPass = true;
        passed += 1;
      }
      prevStopping = stopping;
      prevT = fix.t;
    }
  }
  return { passed, fullStops };
}
