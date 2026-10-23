/**
 * Every tunable number for Drive Score lives here.
 * Spec §3. Source label on each estimate: "Initial estimate, to be calibrated".
 * Truck is a placeholder column: the app has no truck travel mode yet.
 */

export const ESTIMATE_LABEL = "Initial estimate, to be calibrated";

export type Estimate = {
  readonly value: number;
  readonly source: typeof ESTIMATE_LABEL;
};

export function estimate(value: number): Estimate {
  return { value, source: ESTIMATE_LABEL };
}

export type VehicleKind = "car" | "motorcycle" | "truck";

/** Car is the Drive travel mode. Motorcycle matches the Motorcycle mode. */
export const ACTIVE_VEHICLES = ["car", "motorcycle"] as const;

/**
 * Placeholder: there is no truck travel mode yet.
 * The truck column still holds the spec table so a later mode can use it.
 */
export const TRUCK_PLACEHOLDER =
  "Placeholder: there is no truck travel mode yet. These truck thresholds are initial estimates, to be calibrated.";

export type VehicleEstimates = {
  brakeHardG: Estimate;
  brakeHarshG: Estimate;
  brakeGpsKmhPerS: Estimate;
  turnG: Estimate;
  speedMarginKmh: Estimate;
  lightRadiusM: Estimate;
  stopSpeedKmh: Estimate;
  minEventSpeedKmh: Estimate;
  gpsAccuracyM: Estimate;
  minTripKm: Estimate;
  minTripMinutes: Estimate;
  /** Spec §2 drops jumps faster than 1.5× this. The table does not publish a max, so this one is an estimate. */
  maxSpeedKmh: Estimate;
};

export const VEHICLE_ESTIMATES: Record<VehicleKind, VehicleEstimates> = {
  car: {
    brakeHardG: estimate(0.3),
    brakeHarshG: estimate(0.45),
    brakeGpsKmhPerS: estimate(10),
    turnG: estimate(0.35),
    speedMarginKmh: estimate(5),
    lightRadiusM: estimate(30),
    stopSpeedKmh: estimate(3),
    minEventSpeedKmh: estimate(15),
    gpsAccuracyM: estimate(20),
    minTripKm: estimate(1),
    minTripMinutes: estimate(3),
    maxSpeedKmh: estimate(200),
  },
  motorcycle: {
    brakeHardG: estimate(0.3),
    brakeHarshG: estimate(0.45),
    brakeGpsKmhPerS: estimate(10),
    turnG: estimate(0.3),
    speedMarginKmh: estimate(5),
    lightRadiusM: estimate(30),
    stopSpeedKmh: estimate(3),
    minEventSpeedKmh: estimate(15),
    gpsAccuracyM: estimate(20),
    minTripKm: estimate(1),
    minTripMinutes: estimate(3),
    maxSpeedKmh: estimate(200),
  },
  truck: {
    brakeHardG: estimate(0.25),
    brakeHarshG: estimate(0.35),
    brakeGpsKmhPerS: estimate(8),
    turnG: estimate(0.25),
    speedMarginKmh: estimate(5),
    lightRadiusM: estimate(35),
    stopSpeedKmh: estimate(3),
    minEventSpeedKmh: estimate(15),
    gpsAccuracyM: estimate(20),
    minTripKm: estimate(1),
    minTripMinutes: estimate(3),
    maxSpeedKmh: estimate(140),
  },
};

/** Rules from §2 and §4 that are not split by vehicle. */
export const SHARED_ESTIMATES = {
  brakeEndG: estimate(0.1),
  brakeEndHoldS: estimate(1),
  minEventS: estimate(0.5),
  smoothWindowS: estimate(0.5),
  speedingEpisodeS: estimate(10),
  stopHoldS: estimate(2),
  gravityWindowS: estimate(5),
  gravityResetDeg: estimate(30),
  calibrationSpeedUps: estimate(3),
  calibrationAccelMps2: estimate(1),
  jumpFactor: estimate(1.5),
  weightHard: estimate(4),
  weightHarsh: estimate(8),
  weightTurn: estimate(3),
  weightSpeedRatio: estimate(30),
  weightEpisode: estimate(2),
  capBrake: estimate(40),
  capTurn: estimate(20),
  capSpeed: estimate(30),
};

/** Metres per second squared in the §2 lateral-g formula. Not a calibrated threshold. */
export const G_MPS2 = 9.81;

export type Limits = {
  brakeHardG: number;
  brakeHarshG: number;
  brakeGpsKmhPerS: number;
  turnG: number;
  speedMarginKmh: number;
  lightRadiusM: number;
  stopSpeedKmh: number;
  minEventSpeedKmh: number;
  gpsAccuracyM: number;
  minTripKm: number;
  minTripMinutes: number;
  maxSpeedKmh: number;
  brakeEndG: number;
  brakeEndHoldS: number;
  minEventS: number;
  smoothWindowS: number;
  speedingEpisodeS: number;
  stopHoldS: number;
  gravityWindowS: number;
  gravityResetDeg: number;
  calibrationSpeedUps: number;
  calibrationAccelMps2: number;
  jumpFactor: number;
  weightHard: number;
  weightHarsh: number;
  weightTurn: number;
  weightSpeedRatio: number;
  weightEpisode: number;
  capBrake: number;
  capTurn: number;
  capSpeed: number;
};

export function limitsFor(vehicle: VehicleKind): Limits {
  const row = VEHICLE_ESTIMATES[vehicle];
  const shared = SHARED_ESTIMATES;
  return {
    brakeHardG: row.brakeHardG.value,
    brakeHarshG: row.brakeHarshG.value,
    brakeGpsKmhPerS: row.brakeGpsKmhPerS.value,
    turnG: row.turnG.value,
    speedMarginKmh: row.speedMarginKmh.value,
    lightRadiusM: row.lightRadiusM.value,
    stopSpeedKmh: row.stopSpeedKmh.value,
    minEventSpeedKmh: row.minEventSpeedKmh.value,
    gpsAccuracyM: row.gpsAccuracyM.value,
    minTripKm: row.minTripKm.value,
    minTripMinutes: row.minTripMinutes.value,
    maxSpeedKmh: row.maxSpeedKmh.value,
    brakeEndG: shared.brakeEndG.value,
    brakeEndHoldS: shared.brakeEndHoldS.value,
    minEventS: shared.minEventS.value,
    smoothWindowS: shared.smoothWindowS.value,
    speedingEpisodeS: shared.speedingEpisodeS.value,
    stopHoldS: shared.stopHoldS.value,
    gravityWindowS: shared.gravityWindowS.value,
    gravityResetDeg: shared.gravityResetDeg.value,
    calibrationSpeedUps: shared.calibrationSpeedUps.value,
    calibrationAccelMps2: shared.calibrationAccelMps2.value,
    jumpFactor: shared.jumpFactor.value,
    weightHard: shared.weightHard.value,
    weightHarsh: shared.weightHarsh.value,
    weightTurn: shared.weightTurn.value,
    weightSpeedRatio: shared.weightSpeedRatio.value,
    weightEpisode: shared.weightEpisode.value,
    capBrake: shared.capBrake.value,
    capTurn: shared.capTurn.value,
    capSpeed: shared.capSpeed.value,
  };
}
