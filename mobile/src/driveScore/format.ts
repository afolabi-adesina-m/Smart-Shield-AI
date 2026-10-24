/** Spec §4. Card text. Points come from scoreTrip. Lights do not change the score. */

import { scoreTrip } from "./score";

export type ScoreTrip = {
  date: string;
  km: number;
  minutes: number;
  score: number | null;
  band: string | null;
  vehicle: "car" | "motorcycle";
  hardBrakes: number;
  harshBrakes: number;
  sharpTurns: number;
  speedingSeconds: number;
  speedingEpisodes: number;
  lightsPassed: number;
  fullStops: number;
  movingSeconds?: number;
};

export type ScoreLine = { points: string; detail: string };

export type ScoreView = {
  score: string;
  band: string;
  meta: string;
  brake: ScoreLine;
  turn: ScoreLine;
  speed: ScoreLine;
  lights: string;
};

function tenths(value: number): string {
  const n = Math.round((Number.isFinite(value) ? value : 0) * 10) / 10;
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function points(value: number, scored: boolean): string {
  if (!scored) return "—";
  const text = tenths(value);
  return text === "0" ? "0" : `-${text}`;
}

/** Spec §4 bands, matching the map colours already used in the app. */
export function bandColor(band: string | null): string {
  if (band === "Excellent") return "#188038";
  if (band === "Good") return "#1a73e8";
  if (band === "Fair") return "#e37400";
  if (band === "Needs work") return "#d93025";
  return "#526072";
}

/** Local date and time for a history row. */
export function formatWhen(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const hour24 = at.getHours();
  const hour = hour24 % 12 || 12;
  const minute = String(at.getMinutes()).padStart(2, "0");
  return `${months[at.getMonth()]} ${at.getDate()}, ${hour}:${minute} ${hour24 < 12 ? "AM" : "PM"}`;
}

export function scoreLines(trip: ScoreTrip): ScoreView {
  const scored = trip.score != null;
  const penalties = scoreTrip({
    vehicle: trip.vehicle,
    tripKm: trip.km,
    tripMinutes: trip.minutes,
    movingSeconds: trip.movingSeconds ?? 0,
    hardBrakes: trip.hardBrakes,
    harshBrakes: trip.harshBrakes,
    sharpTurns: trip.sharpTurns,
    speedingSeconds: trip.speedingSeconds,
    speedingEpisodes: trip.speedingEpisodes,
    lightsPassed: trip.lightsPassed,
    fullStops: trip.fullStops,
  });
  return {
    score: scored ? String(trip.score) : "—",
    band: trip.band ?? "Too short",
    meta: `${tenths(trip.km)} km · ${tenths(trip.minutes)} min`,
    brake: {
      points: points(penalties.pBrake, scored),
      detail: `${count(trip.hardBrakes, "hard", "hard")}, ${count(trip.harshBrakes, "harsh", "harsh")}`,
    },
    turn: {
      points: points(penalties.pTurn, scored),
      detail: count(trip.sharpTurns, "turn", "turns"),
    },
    speed: {
      points: points(penalties.pSpeed, scored),
      detail: `${Math.round(trip.speedingSeconds)} s, ${count(trip.speedingEpisodes, "episode", "episodes")}`,
    },
    lights: penalties.lightsShown,
  };
}

export function historyBits(trip: ScoreTrip): { when: string; distance: string; score: string; band: string } {
  return {
    when: formatWhen(trip.date),
    distance: `${tenths(trip.km)} km`,
    score: trip.score == null ? "—" : String(trip.score),
    band: trip.band ?? "Too short",
  };
}
