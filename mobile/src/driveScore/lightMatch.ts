/** Spec §2. Lights passed and full stops. score.ts does not penalise these. */

export type LightNode = { lat: number; lon: number };

type Fix = { t: number; lat: number; lon: number; speedKmh: number | null };

export function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const radius = 6371000;
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * radius * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Passed = enter the radius, then leave it. A full stop is slow inside the radius before that. */
export function matchLights(
  fixes: Fix[],
  lights: LightNode[],
  radiusM: number,
  stopSpeedKmh: number,
  stopHoldS: number,
): { passed: number; fullStops: number } {
  let passed = 0;
  let fullStops = 0;
  const ordered = [...fixes].sort((a, b) => a.t - b.t);
  for (const light of lights) {
    let inside = false;
    let didPass = false;
    let stopRun = 0;
    let countedStop = false;
    let wasStopped = false;
    let prevT: number | null = null;
    for (const fix of ordered) {
      const dt = prevT == null ? 0 : fix.t - prevT;
      const near = haversineM(fix.lat, fix.lon, light.lat, light.lon) <= radiusM;
      const stopped = !didPass && near && fix.speedKmh != null && fix.speedKmh <= stopSpeedKmh;
      stopRun = stopped && wasStopped ? stopRun + dt : 0;
      if (stopped && stopRun + 1e-9 >= stopHoldS && !countedStop) {
        countedStop = true;
        fullStops += 1;
      }
      if (near) inside = true;
      if (inside && !didPass && !near) {
        didPass = true;
        passed += 1;
      }
      wasStopped = stopped;
      prevT = fix.t;
    }
  }
  return { passed, fullStops };
}
