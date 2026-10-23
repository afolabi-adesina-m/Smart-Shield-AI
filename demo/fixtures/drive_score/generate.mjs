/**
 * Rebuilds the synthetic traces in this folder.
 * The unit test reads the JSON; it does not run this file.
 * Run: node demo/fixtures/drive_score/generate.mjs
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const HZ = 50;
const LAT0 = 43.65;
const LON0 = -79.38;
const M_PER_DEG = 111320;

function round(value, places) {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

function speedAt(t, marks) {
  let value = marks[0].speed;
  for (const mark of marks) {
    if (mark.t <= t + 1e-9) value = mark.speed;
  }
  return value;
}

function userForward(t, brake) {
  if (t >= 5 && t < 8) return 0.15;
  if (brake && t >= brake.start && t < brake.end) return -brake.g;
  return 0;
}

function toDevice(world, mount) {
  const [x, y, z] = world;
  if (mount === "flat") return [x, y, z];
  if (mount === "upright") return [y, z, x];
  if (mount === "sideways") return [z, x, y];
  throw new Error(mount);
}

/** Rest, three GPS speed-ups, a clean cruise, then the event. Same shape for every mount. */
function trace(options) {
  const mount = options.mount || "flat";
  const end = options.end ?? 20;
  const marks = options.speeds;
  const motion = [];
  const gps = [];
  let metres = 0;
  for (let i = 0; i <= end * HZ; i += 1) {
    const t = i / HZ;
    const speed = speedAt(t, marks);
    const yaw = options.turn && t >= options.turn.start && t < options.turn.end ? options.turn.yaw : 0;
    const [ax, ay, az] = toDevice([userForward(t, options.brake), 0, 1], mount);
    const [gx, gy, gz] = toDevice([0, 0, yaw], mount);
    motion.push({
      t: round(t, 2),
      ax: round(ax, 4),
      ay: round(ay, 4),
      az: round(az, 4),
      gx: round(gx, 5),
      gy: round(gy, 5),
      gz: round(gz, 5),
    });
    if (i % HZ === 0) {
      if (i > 0) metres += speed / 3.6;
      gps.push({
        t,
        lat: round(LAT0 + metres / M_PER_DEG, 6),
        lon: LON0,
        speed,
        accuracy: options.accuracyAt ? options.accuracyAt(t) : 5,
        posted_kmh: options.posted === undefined ? 50 : options.posted,
      });
    }
  }
  return { motion, gps };
}

function calibratedSpeeds(tail) {
  return [
    { t: 0, speed: 30 },
    { t: 5, speed: 30 },
    { t: 6, speed: 38 },
    { t: 7, speed: 46 },
    { t: 8, speed: 54 },
    ...tail,
  ];
}

const confirmedDrop = calibratedSpeeds([
  { t: 14, speed: 54 },
  { t: 16, speed: 34 },
  { t: 18, speed: 34 },
]);

function write(name, body) {
  writeFileSync(join(dir, name), `${JSON.stringify(body, null, 2)}\n`);
}

const hard = trace({ brake: { start: 14, end: 15.4, g: 0.35 }, speeds: confirmedDrop });
write("hard_brake.json", {
  kind: "detect",
  note: "One 0.35 g brake for about 1.4 s, confirmed by a 20 km/h GPS drop over 2 s. Spec §7.1.",
  vehicle: "car",
  ...hard,
  lights: [],
  expected: { hardBrakes: 1, harshBrakes: 0, unconfirmedBrakes: 0, sharpTurns: 0, speedingSeconds: 0, speedingEpisodes: 0, lightsPassed: 0, fullStops: 0, minPeakG: 0.3, maxPeakG: 0.45 },
});

write("harsh_brake.json", {
  kind: "detect",
  note: "One 0.5 g brake. Harsh replaces hard, so the hard count stays 0. Spec §7.1.",
  vehicle: "car",
  ...trace({ brake: { start: 14, end: 15.4, g: 0.5 }, speeds: confirmedDrop }),
  lights: [],
  expected: { hardBrakes: 0, harshBrakes: 1, unconfirmedBrakes: 0, sharpTurns: 0, speedingSeconds: 0, speedingEpisodes: 0, lightsPassed: 0, fullStops: 0, minPeakG: 0.45, maxPeakG: 0.55 },
});

write("short_spike.json", {
  kind: "detect",
  note: "0.2 s spike at 0.5 g. Too short to score. Spec §7.1.",
  vehicle: "car",
  ...trace({ brake: { start: 14, end: 14.2, g: 0.5 }, speeds: confirmedDrop }),
  lights: [],
  expected: { hardBrakes: 0, harshBrakes: 0, unconfirmedBrakes: 0, sharpTurns: 0, speedingSeconds: 0, speedingEpisodes: 0, lightsPassed: 0, fullStops: 0 },
});

write("steady_cruise.json", {
  kind: "detect",
  note: "Steady cruise under the posted limit. Spec §7.1 expects 0 events.",
  vehicle: "car",
  ...trace({
    speeds: calibratedSpeeds([{ t: 20, speed: 60 }]),
    posted: 80,
  }),
  lights: [],
  expected: { hardBrakes: 0, harshBrakes: 0, unconfirmedBrakes: 0, sharpTurns: 0, speedingSeconds: 0, speedingEpisodes: 0, lightsPassed: 0, fullStops: 0 },
});

const yaw04 = 0.4 * 9.81 / (54 / 3.6);
write("sharp_turn.json", {
  kind: "detect",
  note: "Lateral 0.4 g for about 1.4 s at 54 km/h. Spec §7.1 expects 1 sharp turn.",
  vehicle: "car",
  ...trace({
    turn: { start: 14, end: 15.4, yaw: yaw04 },
    speeds: calibratedSpeeds([{ t: 20, speed: 54 }]),
  }),
  lights: [],
  expected: { hardBrakes: 0, harshBrakes: 0, unconfirmedBrakes: 0, sharpTurns: 1, speedingSeconds: 0, speedingEpisodes: 0, lightsPassed: 0, fullStops: 0, minPeakG: 0.35, maxPeakG: 0.45 },
});

write("unconfirmed_brake.json", {
  kind: "detect",
  note: "0.4 g brake with flat GPS speed, so it is logged and not scored. Spec §2.",
  vehicle: "car",
  ...trace({
    brake: { start: 14, end: 15.4, g: 0.4 },
    speeds: calibratedSpeeds([{ t: 20, speed: 54 }]),
  }),
  lights: [],
  expected: { hardBrakes: 0, harshBrakes: 0, unconfirmedBrakes: 1, sharpTurns: 0, speedingSeconds: 0, speedingEpisodes: 0, lightsPassed: 0, fullStops: 0 },
});

const yaw032 = 0.32 * 9.81 / (54 / 3.6);
const midTurn = trace({
  turn: { start: 14, end: 15.6, yaw: yaw032 },
  speeds: calibratedSpeeds([{ t: 20, speed: 54 }]),
});
write("motorcycle_turn.json", {
  kind: "detect-vehicles",
  note: "0.32 g lateral. Above the motorcycle turn threshold (0.30) and below the car threshold (0.35).",
  motion: midTurn.motion,
  gps: midTurn.gps,
  lights: [],
  cases: [
    { vehicle: "car", expected: { hardBrakes: 0, harshBrakes: 0, unconfirmedBrakes: 0, sharpTurns: 0, speedingSeconds: 0, speedingEpisodes: 0, lightsPassed: 0, fullStops: 0 } },
    { vehicle: "motorcycle", expected: { hardBrakes: 0, harshBrakes: 0, unconfirmedBrakes: 0, sharpTurns: 1, speedingSeconds: 0, speedingEpisodes: 0, lightsPassed: 0, fullStops: 0, minPeakG: 0.3, maxPeakG: 0.35 } },
  ],
});

write("three_mounts.json", {
  kind: "mounts",
  note: "The same 0.35 g brake with the phone flat, upright, and sideways. Spec §7.1.",
  mounts: ["flat", "upright", "sideways"].map((mount) => ({
    mount,
    vehicle: "car",
    ...trace({ mount, brake: { start: 14, end: 15.4, g: 0.35 }, speeds: confirmedDrop }),
    lights: [],
    expected: { hardBrakes: 1, harshBrakes: 0, unconfirmedBrakes: 0, sharpTurns: 0, speedingSeconds: 0, speedingEpisodes: 0, lightsPassed: 0, fullStops: 0 },
  })),
});

function speedingGps(seconds, speed, posted) {
  const gps = [];
  let metres = 0;
  for (let t = 0; t <= seconds; t += 1) {
    if (t > 0) metres += speed / 3.6;
    gps.push({
      t,
      lat: round(LAT0 + metres / M_PER_DEG, 6),
      lon: LON0,
      speed,
      accuracy: 5,
      posted_kmh: posted,
    });
  }
  return gps;
}

function speedingFixture(name, note, seconds, speed, posted, expected) {
  write(name, {
    kind: "detect",
    note,
    vehicle: "car",
    motion: [],
    gps: speedingGps(seconds, speed, posted),
    lights: [],
    expected,
  });
}

const none = { hardBrakes: 0, harshBrakes: 0, unconfirmedBrakes: 0, sharpTurns: 0, lightsPassed: 0, fullStops: 0 };
speedingFixture("speeding_minute.json", "60 s at posted+10 (60 in a 50 zone). One speeding episode. Spec §7.1.", 60, 60, 50, { ...none, speedingSeconds: 60, speedingEpisodes: 1 });
speedingFixture("speeding_10s.json", "Exactly 10 continuous speeding seconds is one episode.", 10, 60, 50, { ...none, speedingSeconds: 10, speedingEpisodes: 1 });
speedingFixture("speeding_9s.json", "9 continuous speeding seconds are not an episode.", 9, 60, 50, { ...none, speedingSeconds: 9, speedingEpisodes: 0 });
speedingFixture("speeding_at_margin.json", "Speed equal to posted_kmh + margin is not speeding.", 15, 55, 50, { ...none, speedingSeconds: 0, speedingEpisodes: 0 });
speedingFixture("speeding_just_over.json", "1 km/h over the margin counts.", 15, 56, 50, { ...none, speedingSeconds: 15, speedingEpisodes: 1 });
speedingFixture("speeding_no_limit.json", "No posted_kmh, so speeding is ignored.", 15, 90, null, { ...none, speedingSeconds: 0, speedingEpisodes: 0 });

const lightSpeeds = [
  { t: 0, speed: 30 }, { t: 5, speed: 30 }, { t: 6, speed: 38 }, { t: 7, speed: 46 }, { t: 8, speed: 54 },
  { t: 14, speed: 36 }, { t: 15, speed: 18 }, { t: 16, speed: 4 }, { t: 17, speed: 0 }, { t: 18, speed: 0 },
  { t: 19, speed: 0 }, { t: 20, speed: 0 }, { t: 21, speed: 12 }, { t: 22, speed: 20 }, { t: 26, speed: 20 },
];
const lightTrace = trace({
  brake: { start: 14, end: 16.5, g: 0.2 },
  speeds: lightSpeeds,
  end: 26,
});
const stopped = lightTrace.gps.find((fix) => fix.t === 18);
write("stop_at_light.json", {
  kind: "detect",
  note: "Gentle arrival, a 3 s stop inside the light radius, then the track leaves. Spec §7.1: 1 passed, 1 stop. The 0.2 g slowdown is under the hard-brake threshold.",
  vehicle: "car",
  ...lightTrace,
  lights: [{ lat: stopped.lat, lon: stopped.lon }],
  expected: { hardBrakes: 0, harshBrakes: 0, unconfirmedBrakes: 0, sharpTurns: 0, speedingSeconds: 0, speedingEpisodes: 0, lightsPassed: 1, fullStops: 1 },
});

write("bad_accuracy.json", {
  kind: "detect",
  note: "The same stop, but every fix is worse than 20 m and must be ignored. Spec §7.1.",
  vehicle: "car",
  motion: lightTrace.motion,
  gps: lightTrace.gps.map((fix) => ({ ...fix, accuracy: 40 })),
  lights: [{ lat: stopped.lat, lon: stopped.lon }],
  expected: { hardBrakes: 0, harshBrakes: 0, unconfirmedBrakes: 0, sharpTurns: 0, speedingSeconds: 0, speedingEpisodes: 0, lightsPassed: 0, fullStops: 0 },
});

write("worked_example.json", {
  kind: "score",
  note: "Spec §4 worked example. 12 km, 2 hard, 1 harsh, 3 turns, 54 s speeding, 1 episode, 9 lights, 4 stops.",
  input: {
    vehicle: "car",
    tripKm: 12,
    tripMinutes: 20,
    movingSeconds: 1080,
    hardBrakes: 2,
    harshBrakes: 1,
    sharpTurns: 3,
    speedingSeconds: 54,
    speedingEpisodes: 1,
    lightsPassed: 9,
    fullStops: 4,
  },
  expected: { score: 76, band: "Good", scorable: true, lightsShown: "9 lights passed, stopped at 4" },
});

write("zero_km.json", {
  kind: "score",
  note: "Under the 1 km and 3 min minimum. Not a perfect 100.",
  input: {
    vehicle: "car",
    tripKm: 0,
    tripMinutes: 0,
    movingSeconds: 0,
    hardBrakes: 2,
    harshBrakes: 0,
    sharpTurns: 0,
    speedingSeconds: 0,
    speedingEpisodes: 0,
    lightsPassed: 1,
    fullStops: 1,
  },
  expected: { score: null, band: null, scorable: false },
});

write("all_caps.json", {
  kind: "score",
  note: "Each penalty is past its cap: brake 40, turn 20, speed 30. Score 10.",
  input: {
    vehicle: "car",
    tripKm: 10,
    tripMinutes: 30,
    movingSeconds: 600,
    hardBrakes: 0,
    harshBrakes: 6,
    sharpTurns: 10,
    speedingSeconds: 600,
    speedingEpisodes: 20,
    lightsPassed: 0,
    fullStops: 0,
  },
  expected: { score: 10, band: "Needs work", scorable: true, pBrake: 40, pTurn: 20, pSpeed: 30 },
});

write("no_events.json", {
  kind: "score",
  note: "A scorable trip with no events scores 100.",
  input: {
    vehicle: "motorcycle",
    tripKm: 5,
    tripMinutes: 10,
    movingSeconds: 400,
    hardBrakes: 0,
    harshBrakes: 0,
    sharpTurns: 0,
    speedingSeconds: 0,
    speedingEpisodes: 0,
    lightsPassed: 0,
    fullStops: 0,
  },
  expected: { score: 100, band: "Excellent", scorable: true },
});

write("stops_do_not_score.json", {
  kind: "score-pair",
  note: "Full stops and lights passed are information only.",
  trip: {
    vehicle: "car",
    tripKm: 12,
    tripMinutes: 20,
    movingSeconds: 1080,
    hardBrakes: 2,
    harshBrakes: 1,
    sharpTurns: 3,
    speedingSeconds: 54,
    speedingEpisodes: 1,
  },
  withLights: { lightsPassed: 9, fullStops: 4 },
  withoutLights: { lightsPassed: 0, fullStops: 0 },
  expectedScore: 76,
});

console.log("wrote drive score fixtures");
