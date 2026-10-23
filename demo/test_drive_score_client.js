/* Drive Score phase 1. Pure functions, JSON fixtures, no network and no sensors. */
const assert = require("assert");
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const loaderFlag = process.execArgv.some((flag) => String(flag).includes("drive_score_loader"));
const strip = process.execArgv.includes("--experimental-strip-types");
if (!loaderFlag || !strip) {
  const child = spawnSync(process.execPath, [
    "--experimental-strip-types",
    "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
    "--import",
    path.join(__dirname, "drive_score_loader.mjs"),
    __filename,
  ], { stdio: "inherit" });
  process.exit(child.status === null ? 1 : child.status);
}

const FIXTURES = path.join(__dirname, "fixtures", "drive_score");
const COUNT_KEYS = [
  "hardBrakes",
  "harshBrakes",
  "unconfirmedBrakes",
  "sharpTurns",
  "speedingSeconds",
  "speedingEpisodes",
  "lightsPassed",
  "fullStops",
];

function assertCounts(actual, expected, label) {
  for (const key of COUNT_KEYS) {
    assert.strictEqual(actual[key], expected[key], `${label} ${key}: ${actual[key]} !== ${expected[key]}`);
  }
  const peaks = [
    ...actual.brakes.filter((event) => event.confirmed).map((event) => event.peakG),
    ...actual.turns.map((event) => event.peakG),
  ];
  if (expected.minPeakG != null) {
    assert.ok(peaks.some((peak) => peak + 1e-9 >= expected.minPeakG && peak <= expected.maxPeakG + 1e-9), `${label} peak ${peaks}`);
  }
}

function walkEstimates(value, trail) {
  if (value && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, "source")) {
    assert.strictEqual(value.source, "Initial estimate, to be calibrated", trail);
    assert.strictEqual(typeof value.value, "number", trail);
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) walkEstimates(child, `${trail}.${key}`);
  }
}

async function main() {
  const detectors = await import("../mobile/src/driveScore/detectors.ts");
  const score = await import("../mobile/src/driveScore/score.ts");
  const thresholds = await import("../mobile/src/driveScore/thresholds.ts");

  walkEstimates(thresholds.VEHICLE_ESTIMATES, "vehicle");
  walkEstimates(thresholds.SHARED_ESTIMATES, "shared");
  assert.ok(thresholds.TRUCK_PLACEHOLDER.includes("no truck travel mode"));
  assert.deepStrictEqual(thresholds.ACTIVE_VEHICLES, ["car", "motorcycle"]);
  assert.strictEqual(thresholds.VEHICLE_ESTIMATES.car.brakeHardG.value, 0.3);
  assert.strictEqual(thresholds.VEHICLE_ESTIMATES.motorcycle.turnG.value, 0.3);
  assert.strictEqual(thresholds.VEHICLE_ESTIMATES.truck.brakeHardG.value, 0.25);
  assert.strictEqual(thresholds.VEHICLE_ESTIMATES.truck.lightRadiusM.value, 35);
  assert.strictEqual(thresholds.limitsFor("car").weightHard, 4);
  assert.strictEqual(thresholds.limitsFor("car").capSpeed, 30);

  const files = fs.readdirSync(FIXTURES).filter((name) => name.endsWith(".json")).sort();
  assert.ok(files.includes("worked_example.json"));
  let detectCases = 0;
  for (const name of files) {
    const fixture = JSON.parse(fs.readFileSync(path.join(FIXTURES, name), "utf8"));
    if (fixture.kind === "detect") {
      const actual = detectors.detectTrip({
        vehicle: fixture.vehicle,
        motion: fixture.motion,
        gps: fixture.gps,
        lights: fixture.lights,
      });
      assertCounts(actual, fixture.expected, name);
      detectCases += 1;
    } else if (fixture.kind === "detect-vehicles") {
      for (const item of fixture.cases) {
        const actual = detectors.detectTrip({
          vehicle: item.vehicle,
          motion: fixture.motion,
          gps: fixture.gps,
          lights: fixture.lights,
        });
        assertCounts(actual, item.expected, `${name}:${item.vehicle}`);
        detectCases += 1;
      }
    } else if (fixture.kind === "mounts") {
      const totals = [];
      for (const item of fixture.mounts) {
        const actual = detectors.detectTrip({
          vehicle: item.vehicle,
          motion: item.motion,
          gps: item.gps,
          lights: item.lights,
        });
        assertCounts(actual, item.expected, `${name}:${item.mount}`);
        totals.push(actual.hardBrakes);
        detectCases += 1;
      }
      assert.deepStrictEqual(totals, [1, 1, 1]);
    } else if (fixture.kind === "score") {
      const actual = score.scoreTrip(fixture.input);
      assert.strictEqual(actual.scorable, fixture.expected.scorable, name);
      assert.strictEqual(actual.score, fixture.expected.score, name);
      assert.strictEqual(actual.band, fixture.expected.band, name);
      if (fixture.expected.lightsShown) assert.strictEqual(actual.lightsShown, fixture.expected.lightsShown);
      if (fixture.expected.pBrake != null) {
        assert.strictEqual(actual.pBrake, fixture.expected.pBrake, name);
        assert.strictEqual(actual.pTurn, fixture.expected.pTurn, name);
        assert.strictEqual(actual.pSpeed, fixture.expected.pSpeed, name);
      }
    } else if (fixture.kind === "score-pair") {
      const withLights = score.scoreTrip({ ...fixture.trip, ...fixture.withLights });
      const without = score.scoreTrip({ ...fixture.trip, ...fixture.withoutLights });
      assert.strictEqual(withLights.score, fixture.expectedScore, name);
      assert.strictEqual(without.score, fixture.expectedScore, name);
      assert.strictEqual(withLights.score, without.score);
      assert.notStrictEqual(withLights.lightsPassed, without.lightsPassed);
    } else {
      throw new Error(`Unknown fixture kind in ${name}`);
    }
  }

  const worked = JSON.parse(fs.readFileSync(path.join(FIXTURES, "worked_example.json"), "utf8"));
  const scored = score.scoreTrip(worked.input);
  assert.ok(Math.abs(scored.pBrake - (40 / 3)) < 1e-9);
  assert.ok(Math.abs(scored.pTurn - 7.5) < 1e-9);
  assert.ok(Math.abs(scored.pSpeed - (1.5 + 5 / 3)) < 1e-9);
  assert.strictEqual(scored.score, 76);
  const hiddenLights = score.scoreTrip({ ...worked.input, lightsPassed: 0, fullStops: 0 });
  assert.strictEqual(hiddenLights.score, 76);

  const zero = score.scoreTrip({ ...worked.input, tripKm: 0, tripMinutes: 10 });
  assert.strictEqual(zero.scorable, false);
  assert.strictEqual(zero.score, null);
  assert.notStrictEqual(zero.score, 100);

  const car = thresholds.limitsFor("car");
  assert.strictEqual(detectors.classifyBrake(0.3, 0.5, 15, car), "hard_brake");
  assert.strictEqual(detectors.classifyBrake(0.299, 0.5, 15, car), null);
  assert.strictEqual(detectors.classifyBrake(0.3, 0.49, 15, car), null);
  assert.strictEqual(detectors.classifyBrake(0.45, 0.5, 15, car), "harsh_brake");
  assert.strictEqual(detectors.classifyBrake(0.449, 0.5, 40, car), "hard_brake");
  assert.strictEqual(detectors.classifyBrake(0.5, 0.5, 14.9, car), null);
  assert.strictEqual(detectors.classifyTurn(0.35, 0.5, 15, car), true);
  assert.strictEqual(detectors.classifyTurn(0.349, 0.5, 15, car), false);
  assert.strictEqual(detectors.isSpeeding(55, 50, 5), false);
  assert.strictEqual(detectors.isSpeeding(55.1, 50, 5), true);
  assert.strictEqual(detectors.isSpeeding(80, null, 5), false);

  const kept = detectors.acceptFixes([
    { t: 0, lat: 43.65, lon: -79.38, speed: 40, accuracy: 20, posted_kmh: 50 },
    { t: 1, lat: 43.6501, lon: -79.38, speed: 40, accuracy: 21, posted_kmh: 50 },
  ], car);
  assert.strictEqual(kept.length, 1);
  assert.strictEqual(kept[0].accuracy, 20);

  assert.strictEqual(score.bandFor(100), "Excellent");
  assert.strictEqual(score.bandFor(90), "Excellent");
  assert.strictEqual(score.bandFor(89), "Good");
  assert.strictEqual(score.bandFor(76), "Good");
  assert.strictEqual(score.bandFor(75), "Good");
  assert.strictEqual(score.bandFor(74), "Fair");
  assert.strictEqual(score.bandFor(50), "Fair");
  assert.strictEqual(score.bandFor(49), "Needs work");
  assert.strictEqual(score.scoreTrip({ ...worked.input, tripKm: 1, tripMinutes: 3 }).scorable, true);
  assert.strictEqual(score.scoreTrip({ ...worked.input, tripKm: 1, tripMinutes: 2.9 }).scorable, false);
  assert.strictEqual(score.scoreTrip({ ...worked.input, vehicle: "truck" }).score, 76);

  console.log(`drive score fixtures ok (${files.length} files, ${detectCases} detector cases)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
