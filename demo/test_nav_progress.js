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
assert.strictEqual(atStart.then.street, "Queen Street West");
assert.strictEqual(atStart.then.kind, "right");

const closer = progress.upcomingManeuvers(steps, line, 43.003, -79);
assert.strictEqual(closer.current.street, "Wellesley Street West");
assert.ok(closer.current.distanceM < atStart.current.distanceM);
assert.ok(closer.current.distanceM > 50);

const passed = progress.upcomingManeuvers(steps, line, 43.006, -79);
assert.strictEqual(passed.current.street, "Queen Street West");
assert.strictEqual(passed.current.kind, "right");
assert.strictEqual(passed.then.kind, "arrive");

const nearEnd = progress.upcomingManeuvers(steps, line, 43.018, -79);
assert.strictEqual(nearEnd.current.kind, "arrive");
assert.strictEqual(nearEnd.current.street, "Barrie");
assert.strictEqual(nearEnd.then, null);

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

console.log("nav progress tests passed");
