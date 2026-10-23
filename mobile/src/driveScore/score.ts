/** Spec §4. Light counts are shown and do not change the score. */

import { limitsFor, type VehicleKind } from "./thresholds";

export type Band = "Excellent" | "Good" | "Fair" | "Needs work";

export type TripScoreInput = {
  vehicle: VehicleKind;
  tripKm: number;
  tripMinutes: number;
  movingSeconds: number;
  hardBrakes: number;
  harshBrakes: number;
  sharpTurns: number;
  speedingSeconds: number;
  speedingEpisodes: number;
  lightsPassed?: number;
  fullStops?: number;
};

function zero(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/** Spec §4 bands. */
export function bandFor(score: number): Band {
  if (score >= 90) return "Excellent";
  if (score >= 75) return "Good";
  if (score >= 50) return "Fair";
  return "Needs work";
}

export function scoreTrip(input: TripScoreInput) {
  const limits = limitsFor(input.vehicle);
  const km10 = Math.max(zero(input.tripKm), 1) / 10;
  const moving = zero(input.movingSeconds);
  const ratio = moving > 0 ? zero(input.speedingSeconds) / moving : 0;
  const pBrake = Math.min(limits.capBrake, (limits.weightHard * zero(input.hardBrakes) + limits.weightHarsh * zero(input.harshBrakes)) / km10);
  const pTurn = Math.min(limits.capTurn, (limits.weightTurn * zero(input.sharpTurns)) / km10);
  const pSpeed = Math.min(limits.capSpeed, limits.weightSpeedRatio * ratio + (limits.weightEpisode * zero(input.speedingEpisodes)) / km10);
  const score = Math.round(Math.min(100, Math.max(0, 100 - pBrake - pTurn - pSpeed)));
  const lightsPassed = zero(input.lightsPassed ?? 0);
  const fullStops = zero(input.fullStops ?? 0);
  const scorable = zero(input.tripKm) + 1e-9 >= limits.minTripKm && zero(input.tripMinutes) + 1e-9 >= limits.minTripMinutes;
  return {
    scorable,
    score: scorable ? score : null,
    band: scorable ? bandFor(score) : null,
    km10,
    pBrake,
    pTurn,
    pSpeed,
    lightsPassed,
    fullStops,
    lightsShown: `${lightsPassed} lights passed, stopped at ${fullStops}`,
  };
}
