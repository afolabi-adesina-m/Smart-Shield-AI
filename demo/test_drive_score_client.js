/* Drive Score phase 1. Sample trips are built here, not stored as JSON. */
const assert = require("assert");
const { spawnSync } = require("child_process");
const path = require("path");

const ready = process.execArgv.includes("--experimental-strip-types")
  && process.execArgv.some((flag) => String(flag).includes("drive_score_loader"));
if (!ready) {
  const child = spawnSync(process.execPath, [
    "--experimental-strip-types",
    "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
    "--import",
    path.join(__dirname, "drive_score_loader.mjs"),
    __filename,
  ], { stdio: "inherit" });
  process.exit(child.status === null ? 1 : child.status);
}

const HZ = 50;
const LAT0 = 43.65;
const LON = -79.38;
const M_PER_DEG = 111320;
const KEYS = ["hardBrakes", "harshBrakes", "unconfirmedBrakes", "sharpTurns", "speedingSeconds", "speedingEpisodes", "lightsPassed", "fullStops"];

function held(t, marks) {
  let speed = marks[0][1];
  for (const [at, value] of marks) if (at <= t + 1e-9) speed = value;
  return speed;
}

function device(x, y, z, mount) {
  if (mount === "upright") return [y, z, x];
  if (mount === "sideways") return [z, x, y];
  return [x, y, z];
}

/** Rest, three speed-ups, cruise, then an optional brake or turn. Spec §7.1 shape, built in memory. */
function trip(options) {
  const mount = options.mount || "flat";
  const end = options.end ?? 20;
  const motion = [];
  const gps = [];
  let metres = 0;
  for (let i = 0; i <= end * HZ; i += 1) {
    const t = i / HZ;
    const speed = held(t, options.speeds);
    let forward = t >= 5 && t < 8 ? 0.15 : 0;
    if (options.brake && t >= options.brake.start && t < options.brake.end) forward = -options.brake.g;
    const yaw = options.turn && t >= options.turn.start && t < options.turn.end ? options.turn.yaw : 0;
    const [ax, ay, az] = device(forward, 0, 1, mount);
    const [gx, gy, gz] = device(0, 0, yaw, mount);
    motion.push({ t: Math.round(t * 100) / 100, ax, ay, az, gx, gy, gz });
    if (i % HZ === 0) {
      if (i > 0) metres += speed / 3.6;
      const accuracy = typeof options.accuracy === "function" ? options.accuracy(t) : (options.accuracy ?? 5);
      gps.push({ t, lat: LAT0 + metres / M_PER_DEG, lon: LON, speed, accuracy, posted_kmh: options.posted === undefined ? 50 : options.posted });
    }
  }
  return { motion, gps };
}

function speeding(seconds, speed, posted) {
  const gps = [];
  let metres = 0;
  for (let t = 0; t <= seconds; t += 1) {
    if (t > 0) metres += speed / 3.6;
    gps.push({ t, lat: LAT0 + metres / M_PER_DEG, lon: LON, speed, accuracy: 5, posted_kmh: posted });
  }
  return { motion: [], gps };
}

const climb = [[0, 30], [5, 30], [6, 38], [7, 46], [8, 54]];
const drop = [...climb, [14, 54], [16, 34], [18, 34]];
const none = { hardBrakes: 0, harshBrakes: 0, unconfirmedBrakes: 0, sharpTurns: 0, speedingSeconds: 0, speedingEpisodes: 0, lightsPassed: 0, fullStops: 0 };

function check(detectors, label, vehicle, built, lights, expected) {
  const actual = detectors.detectTrip({ vehicle, motion: built.motion, gps: built.gps, lights });
  for (const key of KEYS) assert.strictEqual(actual[key], expected[key], `${label} ${key}`);
}

async function main() {
  const detectors = await import("../mobile/src/driveScore/detectors.ts");
  const score = await import("../mobile/src/driveScore/score.ts");
  const thresholds = await import("../mobile/src/driveScore/thresholds.ts");

  function walk(value) {
    if (value && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, "source")) {
      assert.strictEqual(value.source, "Initial estimate, to be calibrated");
      return;
    }
    if (value && typeof value === "object") Object.values(value).forEach(walk);
  }
  walk(thresholds.VEHICLE_ESTIMATES);
  walk(thresholds.SHARED_ESTIMATES);
  assert.ok(thresholds.TRUCK_PLACEHOLDER.includes("no truck travel mode"));
  assert.strictEqual(thresholds.VEHICLE_ESTIMATES.truck.brakeHardG.value, 0.25);
  assert.strictEqual(thresholds.limitsFor("motorcycle").turnG, 0.3);

  check(detectors, "cruise", "car", trip({ speeds: [...climb, [20, 60]], posted: 80 }), [], none);
  check(detectors, "hard", "car", trip({ speeds: drop, brake: { start: 14, end: 15.4, g: 0.35 } }), [], { ...none, hardBrakes: 1 });
  check(detectors, "harsh", "car", trip({ speeds: drop, brake: { start: 14, end: 15.4, g: 0.5 } }), [], { ...none, harshBrakes: 1 });
  check(detectors, "spike", "car", trip({ speeds: drop, brake: { start: 14, end: 14.2, g: 0.5 } }), [], none);
  check(detectors, "unconfirmed", "car", trip({ speeds: [...climb, [20, 54]], brake: { start: 14, end: 15.4, g: 0.4 } }), [], { ...none, unconfirmedBrakes: 1 });

  const yaw = (g) => g * 9.81 / (54 / 3.6);
  const cruiseSpeed = [...climb, [20, 54]];
  check(detectors, "turn", "car", trip({ speeds: cruiseSpeed, turn: { start: 14, end: 15.4, yaw: yaw(0.4) } }), [], { ...none, sharpTurns: 1 });
  check(detectors, "turn-car", "car", trip({ speeds: cruiseSpeed, turn: { start: 14, end: 15.6, yaw: yaw(0.32) } }), [], none);
  check(detectors, "turn-moto", "motorcycle", trip({ speeds: cruiseSpeed, turn: { start: 14, end: 15.6, yaw: yaw(0.32) } }), [], { ...none, sharpTurns: 1 });
  for (const mount of ["flat", "upright", "sideways"]) {
    check(detectors, mount, "car", trip({ mount, speeds: drop, brake: { start: 14, end: 15.4, g: 0.35 } }), [], { ...none, hardBrakes: 1 });
  }

  check(detectors, "speed60", "car", speeding(60, 60, 50), [], { ...none, speedingSeconds: 60, speedingEpisodes: 1 });
  check(detectors, "speed10", "car", speeding(10, 60, 50), [], { ...none, speedingSeconds: 10, speedingEpisodes: 1 });
  check(detectors, "speed9", "car", speeding(9, 60, 50), [], { ...none, speedingSeconds: 9, speedingEpisodes: 0 });
  check(detectors, "at-margin", "car", speeding(15, 55, 50), [], none);
  check(detectors, "just-over", "car", speeding(15, 56, 50), [], { ...none, speedingSeconds: 15, speedingEpisodes: 1 });
  check(detectors, "no-limit", "car", speeding(15, 90, null), [], none);

  const lightSpeeds = [...climb, [14, 36], [15, 18], [16, 4], [17, 0], [18, 0], [19, 0], [20, 0], [21, 12], [22, 20], [26, 20]];
  const lightTrip = trip({ speeds: lightSpeeds, brake: { start: 14, end: 16.5, g: 0.2 }, end: 26 });
  const stopped = lightTrip.gps.find((fix) => fix.t === 18);
  const light = [{ lat: stopped.lat, lon: stopped.lon }];
  check(detectors, "light", "car", lightTrip, light, { ...none, lightsPassed: 1, fullStops: 1 });
  check(detectors, "bad-accuracy", "car", { motion: lightTrip.motion, gps: lightTrip.gps.map((fix) => ({ ...fix, accuracy: 40 })) }, light, none);

  const worked = {
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
  };
  const scored = score.scoreTrip(worked);
  assert.strictEqual(scored.score, 76);
  assert.strictEqual(scored.band, "Good");
  assert.strictEqual(scored.lightsShown, "9 lights passed, stopped at 4");
  assert.ok(Math.abs(scored.pBrake - (40 / 3)) < 1e-9);
  assert.ok(Math.abs(scored.pTurn - 7.5) < 1e-9);
  assert.ok(Math.abs(scored.pSpeed - (1.5 + 5 / 3)) < 1e-9);
  assert.strictEqual(score.scoreTrip({ ...worked, lightsPassed: 0, fullStops: 0 }).score, 76);

  const clear = score.scoreTrip({ ...worked, hardBrakes: 0, harshBrakes: 0, sharpTurns: 0, speedingSeconds: 0, speedingEpisodes: 0, lightsPassed: 0, fullStops: 0, tripKm: 5, tripMinutes: 10, movingSeconds: 400 });
  assert.strictEqual(clear.score, 100);
  assert.strictEqual(clear.band, "Excellent");

  const capped = score.scoreTrip({ ...worked, tripKm: 10, tripMinutes: 30, movingSeconds: 600, hardBrakes: 0, harshBrakes: 6, sharpTurns: 10, speedingSeconds: 600, speedingEpisodes: 20, lightsPassed: 0, fullStops: 0 });
  assert.strictEqual(capped.score, 10);
  assert.strictEqual(capped.band, "Needs work");
  assert.strictEqual(capped.pBrake, 40);
  assert.strictEqual(capped.pTurn, 20);
  assert.strictEqual(capped.pSpeed, 30);

  const zeroKm = score.scoreTrip({ ...worked, tripKm: 0, tripMinutes: 0, movingSeconds: 0 });
  assert.strictEqual(zeroKm.scorable, false);
  assert.strictEqual(zeroKm.score, null);

  const car = thresholds.limitsFor("car");
  assert.strictEqual(detectors.classifyBrake(0.3, 0.5, 15, car), "hard_brake");
  assert.strictEqual(detectors.classifyBrake(0.299, 0.5, 15, car), null);
  assert.strictEqual(detectors.classifyBrake(0.3, 0.49, 15, car), null);
  assert.strictEqual(detectors.classifyBrake(0.45, 0.5, 15, car), "harsh_brake");
  assert.strictEqual(detectors.classifyBrake(0.5, 0.5, 14.9, car), null);
  assert.strictEqual(detectors.classifyTurn(0.35, 0.5, 15, car), true);
  assert.strictEqual(detectors.classifyTurn(0.349, 0.5, 15, car), false);
  assert.strictEqual(detectors.isSpeeding(55, 50, 5), false);
  assert.strictEqual(detectors.isSpeeding(55.1, 50, 5), true);
  assert.strictEqual(score.bandFor(90), "Excellent");
  assert.strictEqual(score.bandFor(89), "Good");
  assert.strictEqual(score.bandFor(75), "Good");
  assert.strictEqual(score.bandFor(74), "Fair");
  assert.strictEqual(score.bandFor(50), "Fair");
  assert.strictEqual(score.bandFor(49), "Needs work");
  assert.strictEqual(detectors.acceptFixes([
    { t: 0, lat: LAT0, lon: LON, speed: 40, accuracy: 20, posted_kmh: 50 },
    { t: 1, lat: LAT0 + 0.0001, lon: LON, speed: 40, accuracy: 21, posted_kmh: 50 },
  ], car).length, 1);

  console.log("drive score tests ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
