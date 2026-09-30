/* Step progression and the upcoming-feature window. No map and no network. */
const assert = require("assert");
const progress = require("./static/js/nav-progress.js");

assert.strictEqual(progress.maneuverKind({ type: "turn", modifier: "left" }), "left");
assert.strictEqual(progress.maneuverKind({ type: "turn", modifier: "sharp left" }), "sharp-left");
assert.strictEqual(progress.maneuverKind({ type: "turn", modifier: "sharp right" }), "sharp-right");
assert.strictEqual(progress.maneuverKind({ type: "turn", modifier: "slight right" }), "slight-right");
assert.strictEqual(progress.maneuverKind({ type: "merge", modifier: "slight left" }), "merge");
assert.strictEqual(progress.maneuverKind({ type: "roundabout", modifier: "right" }), "roundabout");
assert.strictEqual(progress.maneuverKind({ type: "off ramp", modifier: "slight right" }), "exit");
assert.strictEqual(progress.maneuverKind({ type: "arrive", modifier: "" }), "arrive");
assert.strictEqual(progress.maneuverKind({ type: "continue", modifier: "straight" }), "straight");

function northLine() {
  const line = [];
  for (let index = 0; index <= 20; index += 1) line.push([43 + index * 0.002, -79]);
  return line;
}

const line = northLine();
const steps = [
  { name: "Bay Street", type: "depart", modifier: "straight", location: [-79, 43] },
  { name: "Wellesley Street West", type: "turn", modifier: "left", location: [-79, 43.004] },
  { name: "Queen Street West", type: "turn", modifier: "right", location: [-79, 43.01] },
  { name: "Barrie", type: "arrive", modifier: "", location: [-79, 43.02] },
];

const atStart = progress.upcomingManeuvers(steps, line, 43.0002, -79);
assert.strictEqual(atStart.current.street, "Wellesley Street West");
assert.strictEqual(atStart.current.kind, "left");
assert.ok(atStart.current.distanceM > 300 && atStart.current.distanceM < 500, atStart.current.distanceM);
assert.strictEqual(atStart.then, null);

const closer = progress.upcomingManeuvers(steps, line, 43.003, -79);
assert.strictEqual(closer.current.street, "Wellesley Street West");
assert.ok(closer.current.distanceM < atStart.current.distanceM);
assert.ok(closer.current.distanceM > 50);

const passed = progress.upcomingManeuvers(steps, line, 43.006, -79);
assert.strictEqual(passed.current.street, "Queen Street West");
assert.strictEqual(passed.current.kind, "right");
assert.strictEqual(passed.then, null);

const nearEnd = progress.upcomingManeuvers(steps, line, 43.018, -79);
assert.notStrictEqual(nearEnd.current.kind, "arrive");
assert.ok(nearEnd.current.distanceM > 150, nearEnd.current.distanceM);

const arriving = progress.upcomingManeuvers(steps, line, 43.0194, -79);
assert.strictEqual(arriving.current.kind, "arrive");
assert.strictEqual(arriving.current.street, "Barrie");
assert.ok(arriving.current.distanceM <= 150, arriving.current.distanceM);
assert.strictEqual(arriving.then, null);

const unnamed = progress.upcomingManeuvers(
  [{ name: "Unnamed road", type: "turn", modifier: "left", location: [-79, 43.004] }],
  line,
  43.001,
  -79,
);
assert.strictEqual(unnamed.current.street, "Unnamed road");

const ahead = progress.featuresAhead([
  { id: "soon", lat: 43.003, lon: -79 },
  { id: "far", lat: 43.02, lon: -79 },
  { id: "side", lat: 43.003, lon: -79.01 },
  { id: "behind", lat: 42.998, lon: -79 },
  { id: "pin", lat: 43.0002, lon: -79.004 },
], line, 43.001, -79, 1500, 80);

assert.deepStrictEqual(ahead.map((item) => item.id), ["soon"]);

const along = progress.featuresAlongRoute([
  { id: "soon", lat: 43.003, lon: -79 },
  { id: "far", lat: 43.02, lon: -79 },
  { id: "pin", lat: 43.0002, lon: -79.004 },
], line, 80);
assert.deepStrictEqual(along.map((item) => item.id), ["soon", "far"]);
assert.strictEqual(progress.featuresAhead([{ id: "x", lat: 43, lon: -79 }], [], 43, -79).length, 0);

assert.strictEqual(progress.roadLabel("", "401"), "Hwy 401");
assert.strictEqual(progress.roadLabel("Queen Street West", "401"), "Queen Street West");
assert.strictEqual(progress.streetFromStep({ name: "", ref: "QEW" }), "QEW");
assert.strictEqual(progress.streetFromStep({
  name: "Unnamed road",
  instruction: "Turn left onto Dundas Street West",
}), "Dundas Street West");

const named = progress.upcomingManeuvers(
  [{ name: "", ref: "401", type: "new name", modifier: "straight", location: [-79, 43.004] }],
  line,
  43.001,
  -79,
);
assert.strictEqual(named.current.street, "Hwy 401");

// A folded route whose destination sits near the start. Nearest-vertex matching
// would call this "arriving". Segment matching must stay on the outbound leg.
const folded = [[43, -79], [43.01, -79.02], [43.002, -79]];
const foldSteps = [
  { name: "King Street", type: "depart", modifier: "straight", location: [-79, 43] },
  { name: "Destination", type: "arrive", modifier: "", location: [-79, 43.002] },
];
let cursor = progress.matchAlong(folded, 43.001, -79.001, null);
assert.ok(cursor.remainingM > 1000, cursor.remainingM);
assert.ok(!cursor.offRoute);
const foldGuide = progress.upcomingManeuvers(foldSteps, folded, 43.001, -79.001, null);
assert.notStrictEqual(foldGuide.current.kind, "arrive");
const foldHeld = progress.matchAlong(folded, 43.001, -79.001, { alongM: 0 });
assert.ok(foldHeld.remainingM > 1000, foldHeld.remainingM);

const north = [];
for (let step = 0; step <= 40; step += 1) north.push([43 + step * 0.01, -79]);
const originMatch = progress.matchAlong(north, 43, -79, null);
const aheadMatch = progress.matchAlong(north, 43.02, -79, originMatch);
assert.ok(aheadMatch.alongM > 1500, aheadMatch.alongM);
assert.ok(aheadMatch.snapped);

// Walk a trace. Arriving is illegal until the last 150 m, including after a side step.
let previous = null;
const trace = [43.0002, 43.003, 43.006, 43.012, 43.016];
trace.forEach((lat) => {
  const guide = progress.upcomingManeuvers(steps, line, lat, -79, previous);
  previous = guide.match;
  assert.notStrictEqual(guide.current.kind, "arrive", `arrived too early at ${lat}`);
  assert.notStrictEqual(guide.current.street, "Unnamed road");
});
const deviated = progress.upcomingManeuvers(steps, line, 43.006, -79.004, previous);
assert.notStrictEqual(deviated.current.kind, "arrive");
assert.ok(deviated.match.offRoute || deviated.match.offM > 60);

let bearing = null;
bearing = progress.smoothBearing(bearing, 10, 20);
assert.strictEqual(bearing, 10);
bearing = progress.smoothBearing(bearing, 80, 20);
assert.strictEqual(bearing, 30);
assert.strictEqual(progress.navZoom(30, 800), 17);
assert.strictEqual(progress.navZoom(90, 800), 15);
assert.strictEqual(progress.navZoom(40, 100), 18);

function maneuver(distanceM, kind, street, atLat, atLon) {
  return {
    kind: kind || "right",
    street: street || "Queen Street",
    distanceM,
    atLat: atLat == null ? 43.65 : atLat,
    atLon: atLon == null ? -79.38 : atLon,
  };
}

function remember(cue, flags) {
  cue.mark.forEach((flag) => { flags[flag] = true; });
}

const city = {};
const cityFar = progress.voiceCue(maneuver(400), "city", city);
assert.strictEqual(cityFar.phrase, "In 400 metres, turn right onto Queen Street");
remember(cityFar, city);
assert.strictEqual(progress.voiceCue(maneuver(390), "city", city), null);
assert.strictEqual(progress.voiceCue(maneuver(450), "city", city), null);
assert.strictEqual(progress.voiceCue(maneuver(500), "residential", {}), null);
const cityNear = progress.voiceCue(maneuver(100), "city", city);
assert.strictEqual(cityNear.phrase, "In 100 metres, turn right onto Queen Street");
remember(cityNear, city);
assert.strictEqual(progress.voiceCue(maneuver(90), "city", city), null);
const cityNow = progress.voiceCue(maneuver(30), "city", city);
assert.strictEqual(cityNow.phrase, "Turn right now");
remember(cityNow, city);
assert.strictEqual(progress.voiceCue(maneuver(20), "city", city), null);
assert.strictEqual(progress.voiceCue(maneuver(80), "city", city), null);

const jumped = {};
const jumpedNow = progress.voiceCue(maneuver(20), "city", jumped);
assert.strictEqual(jumpedNow.phrase, "Turn right now");
remember(jumpedNow, jumped);
assert.strictEqual(progress.voiceCue(maneuver(90), "city", jumped), null);
assert.strictEqual(progress.voiceCue(maneuver(40, "straight", "Bay Street"), "city", {}), null);

const nextStep = progress.voiceCue(maneuver(80, "left", "King Street", 43.66, -79.39), "city", city);
assert.strictEqual(nextStep.phrase, "In 100 metres, turn left onto King Street");

const highway = {};
const exitFar = progress.voiceCue(maneuver(1800, "exit", "Highway 401", 43.7, -79.4), "highway", highway);
assert.strictEqual(exitFar.phrase, "In 2 kilometres, take the exit onto Highway 401");
remember(exitFar, highway);
assert.strictEqual(progress.voiceCue(maneuver(1900, "exit", "Highway 401", 43.7, -79.4), "motorway", highway), null);
const exitNear = progress.voiceCue(maneuver(500, "exit", "Highway 401", 43.7, -79.4), "highway", highway);
assert.strictEqual(exitNear.phrase, "In 500 metres, take the exit onto Highway 401");
remember(exitNear, highway);
const exitNow = progress.voiceCue(maneuver(40, "exit", "Highway 401", 43.7, -79.4), "highway", highway);
assert.strictEqual(exitNow.phrase, "Take the exit now");
remember(exitNow, highway);
assert.strictEqual(progress.voiceCue(maneuver(60, "exit", "Highway 401", 43.7, -79.4), "highway", highway), null);

const walkFar = progress.voiceCue(maneuver(80), "city", {}, "walk");
assert.strictEqual(walkFar, null);
const walkNear = progress.voiceCue(maneuver(50), "city", {}, "walk");
assert.strictEqual(walkNear.phrase, "In 50 metres, turn right onto Queen Street");
const walkSpoken = {};
remember(walkNear, walkSpoken);
assert.strictEqual(progress.voiceCue(maneuver(40), "city", walkSpoken, "cycle"), null);
const walkNow = progress.voiceCue(maneuver(10), "city", walkSpoken, "walk");
assert.strictEqual(walkNow.phrase, "Turn right now");
assert.strictEqual(progress.navZoom(30, 400, "walk"), 18);
assert.strictEqual(progress.navZoom(90, 800), 15);

const snappedSign = progress.featuresAhead([
  { id: "off", kind: "stop", lat: 43.003, lon: -79.0004 },
], line, 43.001, -79, 1500, 80);
assert.strictEqual(snappedSign.length, 1);
assert.ok(Math.abs(snappedSign[0].lon + 79) < 0.00001, snappedSign[0].lon);
assert.ok(Math.abs(snappedSign[0].lat - 43.003) < 0.0002, snappedSign[0].lat);

const signFlags = {};
const stopCue = progress.signAlert([{ kind: "stop", lat: 43.65, lon: -79.38 }], signFlags, 10000, 0, 8000);
assert.strictEqual(stopCue.phrase, "Stop sign ahead");
signFlags[stopCue.key] = true;
assert.strictEqual(progress.signAlert([{ kind: "stop", lat: 43.65, lon: -79.38 }], signFlags, 20000, 10000, 8000), null);
assert.strictEqual(progress.signAlert([{ kind: "signal", lat: 43.651, lon: -79.381 }], signFlags, 12000, 10000, 8000), null);
const lightCue = progress.signAlert([{ kind: "signal", lat: 43.651, lon: -79.381 }], signFlags, 19000, 10000, 8000);
assert.strictEqual(lightCue.phrase, "Traffic light ahead");
assert.strictEqual(progress.signAlert([{ kind: "stop-all", lat: 43.66, lon: -79.4 }], {}, 30000, 0, 8000).phrase, "All-way stop ahead");

let speedState = { spoken: false, at: 0 };
let speedCue = progress.speedAlert("red", speedState, 1000);
assert.strictEqual(speedCue.speak, true);
assert.strictEqual(speedCue.phrase, "You are over the speed limit.");
speedState = speedCue.state;
speedCue = progress.speedAlert("red", speedState, 2000);
assert.strictEqual(speedCue.speak, false);
speedState = speedCue.state;
speedCue = progress.speedAlert("ok", speedState, 3000);
assert.strictEqual(speedCue.speak, false);
assert.strictEqual(speedCue.state.spoken, true);
speedState = speedCue.state;
speedCue = progress.speedAlert("red", speedState, 4000);
assert.strictEqual(speedCue.speak, false);
speedState = speedCue.state;
speedCue = progress.speedAlert("ok", speedState, 21000);
assert.strictEqual(speedCue.state.spoken, false);
speedState = speedCue.state;
speedCue = progress.speedAlert("red", speedState, 22000);
assert.strictEqual(speedCue.speak, true);
assert.strictEqual(speedCue.phrase, "You are over the speed limit.");

console.log("nav progress tests passed");
