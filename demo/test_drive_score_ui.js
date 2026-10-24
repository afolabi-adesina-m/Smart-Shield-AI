/* Drive Score phase 3. Card text and history labels. No UI runner. */
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

function memoryStore() {
  const data = new Map();
  return {
    getItem: async (key) => (data.has(key) ? data.get(key) : null),
    setItem: async (key, value) => { data.set(key, value); },
  };
}

/** Spec §4 worked example: 12 km, score 76 Good. */
function worked(extra = {}) {
  return {
    date: "2026-10-23T15:04:00Z",
    vehicle: "car",
    km: 12,
    minutes: 20,
    score: 76,
    band: "Good",
    hardBrakes: 2,
    harshBrakes: 1,
    sharpTurns: 3,
    speedingSeconds: 54,
    speedingEpisodes: 1,
    lightsPassed: 9,
    fullStops: 4,
    movingSeconds: 1080,
    ...extra,
  };
}

async function main() {
  const format = await import("../mobile/src/driveScore/format.ts");
  const recorder = await import("../mobile/src/driveScore/recorder.ts");

  const lines = format.scoreLines(worked());
  assert.strictEqual(lines.score, "76");
  assert.strictEqual(lines.band, "Good");
  assert.strictEqual(lines.meta, "12 km · 20 min");
  assert.strictEqual(lines.brake.points, "-13.3");
  assert.strictEqual(lines.brake.detail, "2 hard, 1 harsh");
  assert.strictEqual(lines.turn.points, "-7.5");
  assert.strictEqual(lines.turn.detail, "3 turns");
  assert.strictEqual(lines.speed.points, "-3.2");
  assert.strictEqual(lines.speed.detail, "54 s, 1 episode");
  assert.strictEqual(lines.lights, "9 lights passed, stopped at 4");
  assert.strictEqual(lines.lights.includes("-"), false);

  const quiet = format.scoreLines(worked({
    score: 100,
    band: "Excellent",
    hardBrakes: 0,
    harshBrakes: 0,
    sharpTurns: 0,
    speedingSeconds: 0,
    speedingEpisodes: 0,
    lightsPassed: 0,
    fullStops: 0,
  }));
  assert.strictEqual(quiet.score, "100");
  assert.strictEqual(quiet.brake.points, "0");
  assert.strictEqual(quiet.turn.points, "0");
  assert.strictEqual(quiet.speed.points, "0");

  const stops = format.scoreLines(worked({ fullStops: 0, lightsPassed: 0 }));
  assert.strictEqual(stops.score, lines.score);
  assert.strictEqual(stops.brake.points, lines.brake.points);
  assert.strictEqual(stops.lights, "0 lights passed, stopped at 0");

  const short = format.scoreLines(worked({ score: null, band: null, km: 0.2, minutes: 1 }));
  assert.strictEqual(short.score, "—");
  assert.strictEqual(short.band, "Too short");
  assert.strictEqual(short.brake.points, "—");

  assert.strictEqual(format.bandColor("Excellent"), "#188038");
  assert.strictEqual(format.bandColor("Good"), "#1a73e8");
  assert.strictEqual(format.bandColor("Fair"), "#e37400");
  assert.strictEqual(format.bandColor("Needs work"), "#d93025");
  assert.strictEqual(format.bandColor(null), "#526072");

  const at = new Date("2026-10-23T15:04:00Z");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const hour24 = at.getHours();
  const expected = `${months[at.getMonth()]} ${at.getDate()}, ${hour24 % 12 || 12}:${String(at.getMinutes()).padStart(2, "0")} ${hour24 < 12 ? "AM" : "PM"}`;
  assert.strictEqual(format.formatWhen("2026-10-23T15:04:00Z"), expected);
  assert.strictEqual(format.formatWhen("nope"), "nope");
  const bits = format.historyBits(worked());
  assert.strictEqual(bits.when, expected);
  assert.strictEqual(bits.distance, "12 km");
  assert.strictEqual(bits.score, "76");
  assert.strictEqual(bits.band, "Good");

  const store = memoryStore();
  await recorder.saveTrip(store, worked(), Date.parse("2026-10-23T15:04:00Z"));
  assert.strictEqual((await recorder.loadTrips(store)).length, 1);
  await recorder.clearTrips(store);
  assert.deepStrictEqual(await recorder.loadTrips(store), []);

  console.log("drive score ui tests ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
