/**
 * Mount-independent direction of travel. Spec §2.1.
 * Motion samples are device-frame: ax/ay/az in g, including gravity; gx/gy/gz in rad/s.
 */

export type Vec3 = { x: number; y: number; z: number };

export type MotionSample = {
  t: number;
  ax: number;
  ay: number;
  az: number;
  gx: number;
  gy: number;
  gz: number;
};

export type SpeedMark = { t: number; speedKmh: number | null };

export type PoseSample = {
  t: number;
  /** Negative means braking, once forward is known. Null while calibrating. */
  longG: number | null;
  yawRadPerS: number | null;
  calibrated: boolean;
};

export type OrientationConfig = {
  gravityWindowS: number;
  gravityResetDeg: number;
  calibrationSpeedUps: number;
  calibrationAccelMps2: number;
};

export function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function scale(a: Vec3, k: number): Vec3 {
  return { x: a.x * k, y: a.y * k, z: a.z * k };
}

export function magnitude(a: Vec3): number {
  return Math.hypot(a.x, a.y, a.z);
}

export function unit(a: Vec3): Vec3 | null {
  const m = magnitude(a);
  if (m < 1e-6) return null;
  return scale(a, 1 / m);
}

function horizontal(vector: Vec3, down: Vec3): Vec3 | null {
  const axis = unit(down);
  if (!axis) return null;
  return sub(vector, scale(axis, dot(vector, axis)));
}

function angleDeg(a: Vec3, b: Vec3): number {
  const ua = unit(a);
  const ub = unit(b);
  if (!ua || !ub) return 0;
  const c = Math.min(1, Math.max(-1, dot(ua, ub)));
  return (Math.acos(c) * 180) / Math.PI;
}

function mean(samples: Vec3[]): Vec3 {
  const total = samples.reduce((acc, sample) => add(acc, sample), { x: 0, y: 0, z: 0 });
  return scale(total, 1 / samples.length);
}

/** Causal window average. Spec §2.1 uses 5 s for gravity. */
export function lowPass(samples: Vec3[], times: number[], windowS: number): Vec3[] {
  const out: Vec3[] = [];
  let start = 0;
  let sum = { x: 0, y: 0, z: 0 };
  for (let i = 0; i < samples.length; i += 1) {
    sum = add(sum, samples[i]);
    while (times[i] - times[start] > windowS + 1e-9) {
      sum = sub(sum, samples[start]);
      start += 1;
    }
    const count = i - start + 1;
    out.push(scale(sum, 1 / count));
  }
  return out;
}

function kmhPerSToMps2(kmhPerS: number): number {
  return kmhPerS / 3.6;
}

/**
 * Find forward from the first GPS-confirmed speed-ups, then project each sample.
 * A gravity swing past the reset angle clears calibration (spec §2.1 step 4).
 */
export function orientTrip(
  motion: MotionSample[],
  speeds: SpeedMark[],
  config: OrientationConfig,
): PoseSample[] {
  const ordered = [...motion].sort((a, b) => a.t - b.t);
  const raw = ordered.map((sample) => ({ x: sample.ax, y: sample.ay, z: sample.az }));
  const times = ordered.map((sample) => sample.t);
  const gravity = lowPass(raw, times, config.gravityWindowS);
  const speedMarks = [...speeds].filter((mark) => mark.speedKmh != null && Number.isFinite(mark.speedKmh)).sort((a, b) => a.t - b.t);

  const windows: { t0: number; t1: number }[] = [];
  for (let i = 1; i < speedMarks.length; i += 1) {
    const prev = speedMarks[i - 1];
    const next = speedMarks[i];
    const dt = next.t - prev.t;
    if (dt <= 0) continue;
    const accel = kmhPerSToMps2(((next.speedKmh as number) - (prev.speedKmh as number)) / dt);
    if (accel > config.calibrationAccelMps2) windows.push({ t0: prev.t, t1: next.t });
  }

  const directionIn = (t0: number, t1: number): Vec3 | null => {
    const bits: Vec3[] = [];
    for (let i = 0; i < ordered.length; i += 1) {
      if (ordered[i].t <= t0 || ordered[i].t > t1 + 1e-9) continue;
      const user = sub(raw[i], gravity[i]);
      const flat = horizontal(user, gravity[i]);
      if (!flat || magnitude(flat) < 0.02) continue;
      const direction = unit(flat);
      if (direction) bits.push(direction);
    }
    return bits.length ? unit(mean(bits)) : null;
  };

  let forward: Vec3 | null = null;
  let lockedDown: Vec3 | null = null;
  const forwardBits: Vec3[] = [];
  let windowIndex = 0;

  const poses: PoseSample[] = [];
  for (let i = 0; i < ordered.length; i += 1) {
    const down = gravity[i];
    if (lockedDown && angleDeg(down, lockedDown) > config.gravityResetDeg) {
      forward = null;
      lockedDown = null;
      forwardBits.length = 0;
    }
    const downTime = ordered[i].t;
    if (!forward) {
      while (windowIndex < windows.length && windows[windowIndex].t1 <= downTime + 1e-9) {
        const window = windows[windowIndex];
        windowIndex += 1;
        const direction = directionIn(window.t0, window.t1);
        if (!direction) continue;
        forwardBits.push(direction);
        if (forwardBits.length >= config.calibrationSpeedUps) {
          forward = unit(mean(forwardBits));
          lockedDown = down;
          break;
        }
      }
    }

    const gyro = { x: ordered[i].gx, y: ordered[i].gy, z: ordered[i].gz };
    const axis = unit(down);
    const yaw = axis ? dot(gyro, axis) : null;
    let longG: number | null = null;
    if (forward) {
      const user = sub(raw[i], down);
      longG = dot(user, forward);
    }
    poses.push({
      t: ordered[i].t,
      longG,
      yawRadPerS: yaw,
      calibrated: forward != null,
    });
  }
  return poses;
}
