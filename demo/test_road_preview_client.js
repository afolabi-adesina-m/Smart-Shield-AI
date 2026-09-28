/* Street-name label and nearest-step checks. No map and no network. */
const assert = require("assert");
const preview = require("./static/js/road-preview.js");

assert.strictEqual(preview.roadLabel("Dundas St W", "401"), "Dundas St W");
assert.strictEqual(preview.roadLabel("", "401"), "Hwy 401");
assert.strictEqual(preview.roadLabel(null, "27A"), "Hwy 27A");
assert.strictEqual(preview.roadLabel("", "QEW"), "QEW");
assert.strictEqual(preview.roadLabel("  ", ""), "Unnamed road");
assert.strictEqual(preview.UNNAMED_ROAD, "Unnamed road");

assert.strictEqual(preview.stepInstruction("depart", "straight", "Queen St W"), "Head onto Queen St W");
assert.strictEqual(preview.stepInstruction("turn", "left", "Dundas St W"), "Turn left onto Dundas St W");
assert.strictEqual(preview.stepInstruction("arrive", "", "Unnamed road"), "Arrive · Unnamed road");

const dundas = {
  name: "Dundas St W",
  geometry: [[-79.40, 43.65], [-79.39, 43.651]],
};
const highway = {
  name: "Hwy 401",
  geometry: [[-79.30, 43.70], [-79.29, 43.701]],
};
const nearest = preview.nearestStep([dundas, highway], 43.7004, -79.2902);
assert.strictEqual(nearest, highway);
const city = preview.nearestStep([dundas, highway], 43.6502, -79.399);
assert.strictEqual(city, dundas);
assert.strictEqual(preview.nearestStep([{ name: "Unnamed road", geometry: [] }], 43.65, -79.38), null);

console.log("road preview client tests passed");
