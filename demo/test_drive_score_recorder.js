/* Drive Score phase 2. Recorder and retention. No sensors and no stored traces. */
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

function memoryStore(seed = {}) {
  const data = new Map(Object.entries(seed));
  return {
    getItem: async (key) => (data.has(key) ? data.get(key) : null),
    setItem: async (key, value) => { data.set(key, value); },
  };
}

/** Same shape as a phase 1 drive: rest, speed-up, cruise, one hard brake, then a long cruise. */
function drive(recorder) {
  const hz = 20;
  const speeds = [[0, 30], [5, 30], [6, 38], [7, 46], [8, 54], [14, 54], [16, 34], [40, 34]];
  const held = (t) => {
    let speed = speeds[0][1];
    for (const [at, value] of speeds) if (at <= t + 1e-9) speed = value;
    return speed;
  };
  let metres = 0;
  for (let i = 0; i <= 40 * hz; i += 1) {
    const t = i / hz;
    const speed = held(t);
    const forward = t >= 5 && t < 8 ? 0.15 : t >= 14 && t < 15.4 ? -0.35 : 0;
    recorder.addMotion({ t, ax: forward, ay: 0, az: 1, gx: 0, gy: 0, gz: 0 });
    if (i % hz === 0) {
      if (i > 0) metres += speed / 3.6;
      recorder.addGps({
        t,
        lat: 43.65 + metres / 111320,
        lon: -79.38,
        speed,
        accuracy: 5,
        posted_kmh: 50,
      });
    }
  }
}

async function main() {
  const recorder = await import("../mobile/src/driveScore/recorder.ts");

  assert.strictEqual(recorder.shouldRecord("drive", true, true), true);
  assert.strictEqual(recorder.shouldRecord("motorcycle", true, true), true);
  assert.strictEqual(recorder.shouldRecord("cycle", true, true), false);
  assert.strictEqual(recorder.shouldRecord("drive", false, true), false);
  assert.strictEqual(recorder.shouldRecord("drive", true, false), false);

  const now = Date.parse("2026-10-23T12:00:00Z");
  const day = 24 * 60 * 60 * 1000;
  const fresh = Array.from({ length: 60 }, (_, index) => ({
    date: new Date(now - index * 1000).toISOString(),
  }));
  assert.strictEqual(recorder.pruneTrips(fresh, now).length, 50);
  assert.strictEqual(recorder.pruneTrips(fresh, now)[0].date, fresh[0].date);
  const mixed = [
    { date: new Date(now - 10 * day).toISOString() },
    { date: new Date(now - 100 * day).toISOString() },
    { date: new Date(now - 89 * day).toISOString() },
  ];
  const kept = recorder.pruneTrips(mixed, now);
  assert.strictEqual(kept.length, 2);
  assert.ok(kept.every((trip) => Date.parse(trip.date) >= now - 90 * day));

  const store = memoryStore();
  assert.strictEqual(await recorder.loadScoreOn(store), true);
  await recorder.saveScoreOn(store, false);
  assert.strictEqual(await recorder.loadScoreOn(store), false);

  const trip = recorder.createRecorder("car", now - 4 * 60 * 1000);
  drive(trip);
  const summary = trip.finish(now);
  assert.ok(summary);
  assert.strictEqual(summary.hardBrakes, 1);
  assert.strictEqual(summary.harshBrakes, 0);
  assert.strictEqual(summary.vehicle, "car");
  assert.strictEqual(summary.score, null);
  assert.ok(summary.events.some((event) => event.type === "hard_brake"));
  assert.strictEqual(JSON.stringify(summary).includes("\"ax\""), false);
  const place = summary.events[0];
  assert.strictEqual(place.lat, Math.round(place.lat * 1000) / 1000);

  const saved = await recorder.saveTrip(store, summary, now);
  assert.strictEqual(saved.length, 1);
  assert.strictEqual((await recorder.loadTrips(store)).length, 1);
  for (const old of fresh) await recorder.saveTrip(store, { ...summary, date: old.date }, now);
  assert.strictEqual((await recorder.loadTrips(store)).length, 50);

  console.log("drive score recorder tests ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
