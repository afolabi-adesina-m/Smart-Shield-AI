/** Spec §2.1. ax/ay/az are g including gravity. gx/gy/gz are rad/s. */

export type MotionSample = {
  t: number;
  ax: number;
  ay: number;
  az: number;
  gx: number;
  gy: number;
  gz: number;
};

export type PoseSample = {
  t: number;
  /** Negative is braking, once forward is known. Null while calibrating. */
  longG: number | null;
  yawRadPerS: number | null;
  calibrated: boolean;
};

type V = { x: number; y: number; z: number };
type SpeedMark = { t: number; speedKmh: number | null };
type Config = {
  gravityWindowS: number;
  gravityResetDeg: number;
  calibrationSpeedUps: number;
  calibrationAccelMps2: number;
};

const add = (a: V, b: V): V => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const sub = (a: V, b: V): V => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const scale = (a: V, k: number): V => ({ x: a.x * k, y: a.y * k, z: a.z * k });
const dot = (a: V, b: V) => a.x * b.x + a.y * b.y + a.z * b.z;
const len = (a: V) => Math.hypot(a.x, a.y, a.z);

function unit(a: V): V | null {
  const m = len(a);
  return m < 1e-6 ? null : scale(a, 1 / m);
}

function flat(vector: V, down: V): V | null {
  const axis = unit(down);
  return axis ? sub(vector, scale(axis, dot(vector, axis))) : null;
}

function angleDeg(a: V, b: V): number {
  const ua = unit(a);
  const ub = unit(b);
  if (!ua || !ub) return 0;
  const c = Math.min(1, Math.max(-1, dot(ua, ub)));
  return (Math.acos(c) * 180) / Math.PI;
}

/** Spec §2.1: forward comes from the first GPS speed-ups. A 30° gravity swing resets it. */
export function orientTrip(motion: MotionSample[], speeds: SpeedMark[], config: Config): PoseSample[] {
  const samples = [...motion].sort((a, b) => a.t - b.t);
  const raw = samples.map((sample) => ({ x: sample.ax, y: sample.ay, z: sample.az }));
  const times = samples.map((sample) => sample.t);
  const gravity: V[] = [];
  let start = 0;
  let sum: V = { x: 0, y: 0, z: 0 };
  for (let i = 0; i < raw.length; i += 1) {
    sum = add(sum, raw[i]);
    while (times[i] - times[start] > config.gravityWindowS + 1e-9) {
      sum = sub(sum, raw[start]);
      start += 1;
    }
    gravity.push(scale(sum, 1 / (i - start + 1)));
  }

  const marks = speeds.filter((mark) => mark.speedKmh != null && Number.isFinite(mark.speedKmh));
  const windows: { t0: number; t1: number }[] = [];
  for (let i = 1; i < marks.length; i += 1) {
    const dt = marks[i].t - marks[i - 1].t;
    if (dt <= 0) continue;
    const accel = ((marks[i].speedKmh as number) - (marks[i - 1].speedKmh as number)) / dt / 3.6;
    if (accel > config.calibrationAccelMps2) windows.push({ t0: marks[i - 1].t, t1: marks[i].t });
  }

  const directionBetween = (t0: number, t1: number): V | null => {
    const bits: V[] = [];
    for (let i = 0; i < samples.length; i += 1) {
      if (samples[i].t <= t0 || samples[i].t > t1 + 1e-9) continue;
      const side = flat(sub(raw[i], gravity[i]), gravity[i]);
      const direction = side && len(side) >= 0.02 ? unit(side) : null;
      if (direction) bits.push(direction);
    }
    if (!bits.length) return null;
    const mean = bits.reduce((acc, bit) => add(acc, bit), { x: 0, y: 0, z: 0 });
    return unit(mean);
  };

  let forward: V | null = null;
  let lockedDown: V | null = null;
  const forwardBits: V[] = [];
  let windowIndex = 0;
  const poses: PoseSample[] = [];

  for (let i = 0; i < samples.length; i += 1) {
    const down = gravity[i];
    if (lockedDown && angleDeg(down, lockedDown) > config.gravityResetDeg) {
      forward = null;
      lockedDown = null;
      forwardBits.length = 0;
    }
    while (!forward && windowIndex < windows.length && windows[windowIndex].t1 <= samples[i].t + 1e-9) {
      const window = windows[windowIndex];
      windowIndex += 1;
      const direction = directionBetween(window.t0, window.t1);
      if (!direction) continue;
      forwardBits.push(direction);
      if (forwardBits.length >= config.calibrationSpeedUps) {
        const mean = forwardBits.reduce((acc, bit) => add(acc, bit), { x: 0, y: 0, z: 0 });
        forward = unit(mean);
        lockedDown = down;
      }
    }
    const axis = unit(down);
    const gyro = { x: samples[i].gx, y: samples[i].gy, z: samples[i].gz };
    poses.push({
      t: samples[i].t,
      longG: forward ? dot(sub(raw[i], down), forward) : null,
      yawRadPerS: axis ? dot(gyro, axis) : null,
      calibrated: forward != null,
    });
  }
  return poses;
}
