/**
 * Hard and harsh braking, sharp turns, and speeding. Spec §2.
 * Lights are counted by lightMatch.ts and are not score events.
 */

import { haversineM, matchLights, type LightNode } from "./lightMatch";
import { orientTrip, type MotionSample } from "./orientation";
import { G_MPS2, limitsFor, type Limits, type VehicleKind } from "./thresholds";

export type { MotionSample } from "./orientation";

export type GpsSample = {
  t: number;
  lat: number;
  lon: number;
  /** Kilometres per hour. Null when coords.speed was missing; distance/time is used instead. */
  speed: number | null;
  /** Metres. Fixes worse than the accuracy cut-off are dropped. */
  accuracy: number | null;
  posted_kmh?: number | null;
};

export type TripTrace = {
  vehicle: VehicleKind;
  motion: MotionSample[];
  gps: GpsSample[];
  lights?: LightNode[];
};

export type BrakeEvent = {
  type: "hard_brake" | "harsh_brake";
  t: number;
  peakG: number;
  confirmed: boolean;
};

export type TurnEvent = {
  type: "sharp_turn";
  t: number;
  peakG: number;
};

export type Detection = {
  hardBrakes: number;
  harshBrakes: number;
  unconfirmedBrakes: number;
  sharpTurns: number;
  speedingSeconds: number;
  speedingEpisodes: number;
  movingSeconds: number;
  lightsPassed: number;
  fullStops: number;
  brakes: BrakeEvent[];
  turns: TurnEvent[];
};

type AcceptedFix = GpsSample & { speed: number | null };

function finite(value: number | null | undefined): value is number {
  return value != null && Number.isFinite(value);
}

/** Drop poor fixes and impossible jumps. Fill a missing speed from the previous good fix. Spec §2 speed row. */
export function acceptFixes(gps: GpsSample[], limits: Limits): AcceptedFix[] {
  const ordered = [...gps].sort((a, b) => a.t - b.t);
  const kept: AcceptedFix[] = [];
  for (const fix of ordered) {
    if (finite(fix.accuracy) && fix.accuracy > limits.gpsAccuracyM) continue;
    let speed = finite(fix.speed) ? fix.speed : null;
    if (kept.length > 0) {
      const prev = kept[kept.length - 1];
      const dt = fix.t - prev.t;
      if (dt > 0) {
        const implied = (haversineM(prev.lat, prev.lon, fix.lat, fix.lon) / dt) * 3.6;
        if (implied > limits.maxSpeedKmh * limits.jumpFactor) continue;
        if (speed == null) speed = implied;
      }
    }
    kept.push({ ...fix, speed });
  }
  return kept;
}

export function smooth(values: number[], times: number[], windowS: number): number[] {
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

/** Exactly the threshold counts; just below does not. Speed must also clear the minimum. */
export function classifyBrake(
  peakG: number,
  aboveHardS: number,
  speedKmh: number | null,
  limits: Limits,
): "harsh_brake" | "hard_brake" | null {
  if (speedKmh == null || speedKmh + 1e-9 < limits.minEventSpeedKmh) return null;
  if (aboveHardS + 1e-9 < limits.minEventS) return null;
  if (peakG + 1e-9 < limits.brakeHardG) return null;
  if (peakG + 1e-9 >= limits.brakeHarshG) return "harsh_brake";
  return "hard_brake";
}

export function classifyTurn(peakG: number, aboveS: number, speedKmh: number | null, limits: Limits): boolean {
  if (speedKmh == null || speedKmh + 1e-9 < limits.minEventSpeedKmh) return false;
  if (aboveS + 1e-9 < limits.minEventS) return false;
  return peakG + 1e-9 >= limits.turnG;
}

/** Speeding second: strictly over posted_kmh plus the margin. A missing limit is ignored. */
export function isSpeeding(speedKmh: number | null, postedKmh: number | null | undefined, marginKmh: number): boolean {
  if (!finite(speedKmh) || !finite(postedKmh)) return false;
  return speedKmh > postedKmh + marginKmh;
}

function speedAt(fixes: AcceptedFix[], t: number): number | null {
  let speed: number | null = null;
  for (const fix of fixes) {
    if (fix.t <= t + 1e-9) speed = fix.speed;
    else break;
  }
  return speed;
}

function gpsConfirms(fixes: AcceptedFix[], start: number, end: number, rateKmhPerS: number): boolean {
  for (let i = 0; i < fixes.length; i += 1) {
    for (let j = i + 1; j < fixes.length; j += 1) {
      const dt = fixes[j].t - fixes[i].t;
      if (dt < 1.5 || dt > 2.5) continue;
      if (fixes[j].t < start - 0.5 || fixes[i].t > end + 0.5) continue;
      const drop = (fixes[i].speed ?? 0) - (fixes[j].speed ?? 0);
      if (drop / dt + 1e-9 >= rateKmhPerS) return true;
    }
  }
  return false;
}

type Pulse = { t: number; peak: number; aboveS: number; end: number; speed: number | null };

function collectPulses(
  times: number[],
  values: number[],
  speeds: Array<number | null>,
  threshold: number,
  endBelow: number,
  endHoldS: number,
  minSpeed: number,
): Pulse[] {
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
    peak = 0;
    above = 0;
    below = 0;
    speed = null;
  };
  for (let i = 0; i < values.length; i += 1) {
    const dt = i === 0 ? 0 : times[i] - times[i - 1];
    const value = values[i];
    if (!open && value >= threshold) {
      open = true;
      start = times[i];
      peak = value;
      above = 0;
      below = 0;
      speed = null;
    }
    if (!open) continue;
    peak = Math.max(peak, value);
    if (value >= threshold && speeds[i] != null && speeds[i]! + 1e-9 >= minSpeed) {
      above += dt;
      if (speed == null || speeds[i]! < speed) speed = speeds[i];
    }
    if (value < endBelow) below += dt;
    else below = 0;
    if (endHoldS <= 0 ? value < endBelow : below + 1e-9 >= endHoldS) close(times[i]);
  }
  if (open) close(times[times.length - 1] ?? start);
  return found;
}

function speedingTotals(fixes: AcceptedFix[], limits: Limits): { seconds: number; episodes: number; movingSeconds: number } {
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
    const held = Math.min(dt, 1.5);
    if ((fixes[i].speed ?? 0) > limits.stopSpeedKmh) movingSeconds += held;
    if (isSpeeding(fixes[i].speed, fixes[i].posted_kmh, limits.speedMarginKmh) && dt <= 1.5) {
      seconds += dt;
      run += dt;
    } else close();
  }
  close();
  return { seconds, episodes, movingSeconds };
}

export function detectTrip(trace: TripTrace): Detection {
  const limits = limitsFor(trace.vehicle);
  const fixes = acceptFixes(trace.gps, limits);
  const poses = orientTrip(trace.motion, fixes.map((fix) => ({ t: fix.t, speedKmh: fix.speed })), {
    gravityWindowS: limits.gravityWindowS,
    gravityResetDeg: limits.gravityResetDeg,
    calibrationSpeedUps: limits.calibrationSpeedUps,
    calibrationAccelMps2: limits.calibrationAccelMps2,
  });
  const times = poses.map((pose) => pose.t);
  const longRaw = poses.map((pose) => (pose.calibrated && pose.longG != null ? Math.max(0, -pose.longG) : 0));
  const longG = smooth(longRaw, times, limits.smoothWindowS);
  const speeds = poses.map((pose) => speedAt(fixes, pose.t));
  const lateralRaw = poses.map((pose, index) => {
    if (!pose.calibrated || pose.yawRadPerS == null) return 0;
    const speed = speeds[index];
    if (speed == null) return 0;
    return (Math.abs(pose.yawRadPerS) * (speed / 3.6)) / G_MPS2;
  });
  const lateral = smooth(lateralRaw, times, limits.smoothWindowS);

  const brakePulses = collectPulses(
    times, longG, speeds, limits.brakeHardG, limits.brakeEndG, limits.brakeEndHoldS, limits.minEventSpeedKmh,
  );
  const brakes: BrakeEvent[] = [];
  for (const pulse of brakePulses) {
    const kind = classifyBrake(pulse.peak, pulse.aboveS, pulse.speed, limits);
    if (!kind) continue;
    const confirmed = gpsConfirms(fixes, pulse.t, pulse.end, limits.brakeGpsKmhPerS);
    brakes.push({ type: kind, t: pulse.t, peakG: pulse.peak, confirmed });
  }

  const turnPulses = collectPulses(
    times, lateral, speeds, limits.turnG, limits.turnG, 0, limits.minEventSpeedKmh,
  );
  const turns: TurnEvent[] = [];
  for (const pulse of turnPulses) {
    if (!classifyTurn(pulse.peak, pulse.aboveS, pulse.speed, limits)) continue;
    turns.push({ type: "sharp_turn", t: pulse.t, peakG: pulse.peak });
  }

  const speed = speedingTotals(fixes, limits);
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
