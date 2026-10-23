/**
 * Trip score. Spec §4. Traffic-light counts are echoed and do not change the score.
 */

import { limitsFor, type Limits, type VehicleKind } from "./thresholds";

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

export type TripScore = {
  scorable: boolean;
  score: number | null;
  band: Band | null;
  km10: number;
  pBrake: number;
  pTurn: number;
  pSpeed: number;
  lightsPassed: number;
  fullStops: number;
  /** Spec §4 worked example display, for example "9 lights passed, stopped at 4". */
  lightsShown: string;
};

export function bandFor(score: number): Band {
  if (score >= 90) return "Excellent";
  if (score >= 75) return "Good";
  if (score >= 50) return "Fair";
  return "Needs work";
}

export function lightsShown(passed: number, stops: number): string {
  return `${passed} lights passed, stopped at ${stops}`;
}

function nonNegative(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return value;
}

/** Spec §4 formula, caps, and rounding. */
export function penalties(input: TripScoreInput, limits: Limits): { km10: number; pBrake: number; pTurn: number; pSpeed: number } {
  const km10 = Math.max(nonNegative(input.tripKm), 1) / 10;
  const hard = nonNegative(input.hardBrakes);
  const harsh = nonNegative(input.harshBrakes);
  const turns = nonNegative(input.sharpTurns);
  const speeding = nonNegative(input.speedingSeconds);
  const episodes = nonNegative(input.speedingEpisodes);
  const moving = nonNegative(input.movingSeconds);
  const ratio = moving > 0 ? speeding / moving : 0;
  const pBrake = Math.min(limits.capBrake, (limits.weightHard * hard + limits.weightHarsh * harsh) / km10);
  const pTurn = Math.min(limits.capTurn, (limits.weightTurn * turns) / km10);
  const pSpeed = Math.min(limits.capSpeed, limits.weightSpeedRatio * ratio + (limits.weightEpisode * episodes) / km10);
  return { km10, pBrake, pTurn, pSpeed };
}

export function scoreTrip(input: TripScoreInput): TripScore {
  const limits = limitsFor(input.vehicle);
  const parts = penalties(input, limits);
  const raw = 100 - parts.pBrake - parts.pTurn - parts.pSpeed;
  const clamped = Math.min(100, Math.max(0, raw));
  const rounded = Math.round(clamped);
  const passed = nonNegative(input.lightsPassed ?? 0);
  const stops = nonNegative(input.fullStops ?? 0);
  const scorable = nonNegative(input.tripKm) + 1e-9 >= limits.minTripKm
    && nonNegative(input.tripMinutes) + 1e-9 >= limits.minTripMinutes;
  return {
    scorable,
    score: scorable ? rounded : null,
    band: scorable ? bandFor(rounded) : null,
    km10: parts.km10,
    pBrake: parts.pBrake,
    pTurn: parts.pTurn,
    pSpeed: parts.pSpeed,
    lightsPassed: passed,
    fullStops: stops,
    lightsShown: lightsShown(passed, stops),
  };
}
