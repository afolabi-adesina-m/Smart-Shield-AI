/** Spec §2. Hard/harsh braking, sharp turns, speeding against posted_kmh. */

import { haversineM, matchLights, type LightNode } from "./lightMatch";
import { orientTrip, type MotionSample } from "./orientation";
import { G_MPS2, limitsFor, type Limits, type VehicleKind } from "./thresholds";

export type { MotionSample } from "./orientation";
export type { LightNode } from "./lightMatch";

export type GpsSample = {
  t: number;
  lat: number;
  lon: number;
  speed: number | null;
  accuracy: number | null;
  posted_kmh?: number | null;
};

type Fix = GpsSample & { speed: number | null };

function ok(value: number | null | undefined): value is number {
  return value != null && Number.isFinite(value);
}

/** Spec §2: drop a fix worse than the accuracy cut-off, or a jump over 1.5× max speed. */
export function acceptFixes(gps: GpsSample[], limits: Limits): Fix[] {
  const kept: Fix[] = [];
  for (const fix of [...gps].sort((a, b) => a.t - b.t)) {
    if (ok(fix.accuracy) && fix.accuracy > limits.gpsAccuracyM) continue;
    let speed = ok(fix.speed) ? fix.speed : null;
    const prev = kept[kept.length - 1];
    const dt = prev ? fix.t - prev.t : 0;
    if (prev && dt > 0) {
      const implied = (haversineM(prev.lat, prev.lon, fix.lat, fix.lon) / dt) * 3.6;
      if (implied > limits.maxSpeedKmh * limits.jumpFactor) continue;
      if (speed == null) speed = implied;
    }
    kept.push({ ...fix, speed });
  }
  return kept;
}

function smooth(values: number[], times: number[], windowS: number): number[] {
  const out: number[] = [];
  let start = 0;
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) {
    sum += values[i];
    while (times[i] - times[start] > windowS + 1e-9) {
      sum -= values[start];
      start += 1;
    }
    out.push(sum / (i - start + 1));
  }
  return out;
}

/** Spec §2 brake rule. Exactly at the threshold counts; just below does not. */
export function classifyBrake(peakG: number, aboveS: number, speedKmh: number | null, limits: Limits) {
  if (speedKmh == null || speedKmh + 1e-9 < limits.minEventSpeedKmh) return null;
  if (aboveS + 1e-9 < limits.minEventS || peakG + 1e-9 < limits.brakeHardG) return null;
  return peakG + 1e-9 >= limits.brakeHarshG ? "harsh_brake" : "hard_brake";
}

/** Spec §2 sharp-turn rule. */
export function classifyTurn(peakG: number, aboveS: number, speedKmh: number | null, limits: Limits): boolean {
  if (speedKmh == null || speedKmh + 1e-9 < limits.minEventSpeedKmh) return false;
  return aboveS + 1e-9 >= limits.minEventS && peakG + 1e-9 >= limits.turnG;
}

/** Spec §2: speeding is strictly over posted_kmh plus the margin. */
export function isSpeeding(speedKmh: number | null, postedKmh: number | null | undefined, marginKmh: number): boolean {
  return ok(speedKmh) && ok(postedKmh) && speedKmh > postedKmh + marginKmh;
}

type Pulse = { t: number; end: number; peak: number; aboveS: number; speed: number | null };

function pulses(times: number[], values: number[], speeds: Array<number | null>, level: number, endBelow: number, endHoldS: number, minSpeed: number): Pulse[] {
  const found: Pulse[] = [];
  let open = false;
  let start = 0;
  let peak = 0;
  let above = 0;
  let below = 0;
  let speed: number | null = null;
  const close = (end: number) => {
    if (open) found.push({ t: start, end, peak, aboveS: above, speed });
    open = false;
  };
  for (let i = 0; i < values.length; i += 1) {
    const dt = i === 0 ? 0 : times[i] - times[i - 1];
    const value = values[i];
    if (!open && value >= level) {
      open = true;
      start = times[i];
      peak = 0;
      above = 0;
      below = 0;
      speed = null;
    }
    if (!open) continue;
    peak = Math.max(peak, value);
    if (value >= level && speeds[i] != null && speeds[i]! + 1e-9 >= minSpeed) {
      above += dt;
      if (speed == null || speeds[i]! < speed) speed = speeds[i];
    }
    below = value < endBelow ? below + dt : 0;
    if (endHoldS <= 0 ? value < endBelow : below + 1e-9 >= endHoldS) close(times[i]);
  }
  if (open) close(times[times.length - 1] ?? start);
  return found;
}

function speedAt(fixes: Fix[], t: number): number | null {
  let speed: number | null = null;
  for (const fix of fixes) {
    if (fix.t <= t + 1e-9) speed = fix.speed;
    else break;
  }
  return speed;
}

function gpsConfirms(fixes: Fix[], start: number, end: number, rate: number): boolean {
  for (let i = 0; i < fixes.length; i += 1) {
    for (let j = i + 1; j < fixes.length; j += 1) {
      const dt = fixes[j].t - fixes[i].t;
      const overlaps = dt >= 1.5 && dt <= 2.5 && fixes[j].t >= start - 0.5 && fixes[i].t <= end + 0.5;
      if (overlaps && ((fixes[i].speed ?? 0) - (fixes[j].speed ?? 0)) / dt + 1e-9 >= rate) return true;
    }
  }
  return false;
}

/** Count speeding seconds and episodes. Spec §2. */
function speedingOf(fixes: Fix[], limits: Limits) {
  let seconds = 0;
  let run = 0;
  let episodes = 0;
  let movingSeconds = 0;
  const close = () => {
    if (run + 1e-9 >= limits.speedingEpisodeS) episodes += 1;
    run = 0;
  };
  for (let i = 0; i < fixes.length - 1; i += 1) {
    const dt = fixes[i + 1].t - fixes[i].t;
    if (dt <= 0) continue;
    if ((fixes[i].speed ?? 0) > limits.stopSpeedKmh) movingSeconds += Math.min(dt, 1.5);
    if (isSpeeding(fixes[i].speed, fixes[i].posted_kmh, limits.speedMarginKmh) && dt <= 1.5) {
      seconds += dt;
      run += dt;
    } else close();
  }
  close();
  return { seconds, episodes, movingSeconds };
}

export function detectTrip(trace: { vehicle: VehicleKind; motion: MotionSample[]; gps: GpsSample[]; lights?: LightNode[] }) {
  const limits = limitsFor(trace.vehicle);
  const fixes = acceptFixes(trace.gps, limits);
  const poses = orientTrip(trace.motion, fixes.map((fix) => ({ t: fix.t, speedKmh: fix.speed })), limits);
  const times = poses.map((pose) => pose.t);
  const speeds = poses.map((pose) => speedAt(fixes, pose.t));
  const longG = smooth(poses.map((pose) => (pose.calibrated && pose.longG != null ? Math.max(0, -pose.longG) : 0)), times, limits.smoothWindowS);
  const lateral = smooth(poses.map((pose, index) => {
    const speed = speeds[index];
    if (!pose.calibrated || pose.yawRadPerS == null || speed == null) return 0;
    return (Math.abs(pose.yawRadPerS) * (speed / 3.6)) / G_MPS2;
  }), times, limits.smoothWindowS);

  const brakes = pulses(times, longG, speeds, limits.brakeHardG, limits.brakeEndG, limits.brakeEndHoldS, limits.minEventSpeedKmh)
    .flatMap((pulse) => {
      const kind = classifyBrake(pulse.peak, pulse.aboveS, pulse.speed, limits);
      if (!kind) return [];
      return [{ type: kind, t: pulse.t, peakG: pulse.peak, confirmed: gpsConfirms(fixes, pulse.t, pulse.end, limits.brakeGpsKmhPerS) }];
    });
  const turns = pulses(times, lateral, speeds, limits.turnG, limits.turnG, 0, limits.minEventSpeedKmh)
    .filter((pulse) => classifyTurn(pulse.peak, pulse.aboveS, pulse.speed, limits))
    .map((pulse) => ({ type: "sharp_turn" as const, t: pulse.t, peakG: pulse.peak }));
  const speed = speedingOf(fixes, limits);
  const lights = matchLights(
    fixes.map((fix) => ({ t: fix.t, lat: fix.lat, lon: fix.lon, speedKmh: fix.speed })),
    trace.lights ?? [],
    limits.lightRadiusM,
    limits.stopSpeedKmh,
    limits.stopHoldS,
  );
  const confirmed = brakes.filter((event) => event.confirmed);
  return {
    hardBrakes: confirmed.filter((event) => event.type === "hard_brake").length,
    harshBrakes: confirmed.filter((event) => event.type === "harsh_brake").length,
    unconfirmedBrakes: brakes.filter((event) => !event.confirmed).length,
    sharpTurns: turns.length,
    speedingSeconds: speed.seconds,
    speedingEpisodes: speed.episodes,
    movingSeconds: speed.movingSeconds,
    lightsPassed: lights.passed,
    fullStops: lights.fullStops,
    brakes,
    turns,
  };
}
