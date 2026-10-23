/** Spec §3 and §4. Each number is an initial estimate, to be calibrated. */

export const ESTIMATE_LABEL = "Initial estimate, to be calibrated";

export type Estimate = { readonly value: number; readonly source: typeof ESTIMATE_LABEL };

function est(value: number): Estimate {
  return { value, source: ESTIMATE_LABEL };
}

export type VehicleKind = "car" | "motorcycle" | "truck";

/** Car is Drive. Motorcycle is the Motorcycle mode. Truck has no mode yet. */
export const TRUCK_PLACEHOLDER =
  "Placeholder: there is no truck travel mode yet. These truck thresholds are initial estimates, to be calibrated.";

const car = {
  brakeHardG: est(0.3),
  brakeHarshG: est(0.45),
  brakeGpsKmhPerS: est(10),
  turnG: est(0.35),
  speedMarginKmh: est(5),
  lightRadiusM: est(30),
  stopSpeedKmh: est(3),
  minEventSpeedKmh: est(15),
  gpsAccuracyM: est(20),
  minTripKm: est(1),
  minTripMinutes: est(3),
  /** §2 drops jumps above 1.5× this. The table does not give a maximum, so this is an estimate. */
  maxSpeedKmh: est(200),
};

export const VEHICLE_ESTIMATES = {
  car,
  motorcycle: { ...car, turnG: est(0.3) },
  truck: {
    ...car,
    brakeHardG: est(0.25),
    brakeHarshG: est(0.35),
    brakeGpsKmhPerS: est(8),
    turnG: est(0.25),
    lightRadiusM: est(35),
    maxSpeedKmh: est(140),
  },
};

/** Shared rules from §2 and the §4 weights. */
export const SHARED_ESTIMATES = {
  brakeEndG: est(0.1),
  brakeEndHoldS: est(1),
  minEventS: est(0.5),
  smoothWindowS: est(0.5),
  speedingEpisodeS: est(10),
  stopHoldS: est(2),
  gravityWindowS: est(5),
  gravityResetDeg: est(30),
  calibrationSpeedUps: est(3),
  calibrationAccelMps2: est(1),
  jumpFactor: est(1.5),
  weightHard: est(4),
  weightHarsh: est(8),
  weightTurn: est(3),
  weightSpeedRatio: est(30),
  weightEpisode: est(2),
  capBrake: est(40),
  capTurn: est(20),
  capSpeed: est(30),
};

/** m/s² in the §2 lateral-g formula. Not a calibrated threshold. */
export const G_MPS2 = 9.81;

function values<T extends Record<string, Estimate>>(row: T): { [K in keyof T]: number } {
  const out = {} as { [K in keyof T]: number };
  for (const key of Object.keys(row) as (keyof T)[]) out[key] = row[key].value;
  return out;
}

/** Plain numbers for one vehicle, plus the shared rules. */
export function limitsFor(vehicle: VehicleKind) {
  return { ...values(VEHICLE_ESTIMATES[vehicle]), ...values(SHARED_ESTIMATES) };
}

export type Limits = ReturnType<typeof limitsFor>;
