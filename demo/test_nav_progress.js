/* Step progression and the upcoming-feature window. No map and no network. */
const assert = require("assert");
const progress = require("./static/js/nav-progress.js");

assert.strictEqual(progress.maneuverKind({ type: "turn", modifier: "left" }), "left");
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

console.log("nav progress tests passed");
