/* Client-side camera rules. Mirrors demo/test_cameras.py. No network. */
const assert = require("assert");
const cameras = require("./static/js/cameras.js");

function move(lat, lon, northM, eastM) {
  const lat2 = lat + (northM || 0) / 111320;
  const lon2 = lon + (eastM || 0) / (111320 * Math.cos(lat * Math.PI / 180));
  return [lat2, lon2];
}

const features = cameras.parseOverpass([
  { type: "node", id: 1, lat: 43.65, lon: -79.38, tags: { highway: "speed_camera", maxspeed: "40" } },
  { type: "node", id: 2, lat: 43.66, lon: -79.39, tags: { enforcement: "maxspeed", maxspeed: "50" } },
  {
    type: "relation",
    id: 9,
    tags: { type: "enforcement", enforcement: "traffic_signals" },
    members: [{ type: "node", ref: 3, role: "device", lat: 43.7, lon: -79.4 }],
  },
  {
    type: "way",
    id: 4,
    tags: { highway: "motorway", "maxspeed:variable": "80", maxspeed: "80" },
    geometry: [{ lat: 43.1, lon: -79.1 }, { lat: 43.11, lon: -79.11 }],
  },
  { type: "node", id: 8, lat: 43.2, lon: -79.2, tags: { highway: "stop" } },
]);
const byId = Object.fromEntries(features.map((item) => [item.id, item]));
assert.strictEqual(byId["osm:node:1"].kind, "speed_camera");
assert.strictEqual(byId["osm:node:1"].limit_kmh, 40);
assert.strictEqual(byId["osm:relation:9"].kind, "red_light");
assert.strictEqual(byId["osm:way:4"].kind, "variable");
assert.strictEqual(byId["osm:way:4"].limit_kmh, 80);
assert.strictEqual(byId["osm:way:4"].road_class, "motorway");
assert.ok(!byId["osm:node:8"]);

const near = move(43.65, -79.38, 20, 0);
const far = move(43.65, -79.38, 80, 0);
const merged = cameras.dedupeCameras(
  [{ id: "osm:node:1", kind: "red_light", lat: 43.65, lon: -79.38, limit_kmh: null, source: "osm" }],
  [
    { id: "toronto:rlc:1", kind: "red_light", lat: near[0], lon: near[1], limit_kmh: null, source: "toronto" },
    { id: "toronto:rlc:2", kind: "red_light", lat: far[0], lon: far[1], limit_kmh: null, source: "toronto" },
    { id: "toronto:ase:9", kind: "speed_camera", lat: 43.65, lon: -79.38, limit_kmh: 40, source: "toronto" },
  ],
);
const ids = merged.map((item) => item.id);
assert.ok(!ids.includes("toronto:rlc:1"));
assert.ok(ids.includes("toronto:rlc:2"));
assert.ok(ids.includes("toronto:ase:9"));

const lat = 43.65;
const lon = -79.38;
const cityPoint = move(lat, lon, 200, 0);
const city = { id: "city", kind: "speed_camera", lat: cityPoint[0], lon: cityPoint[1], limit_kmh: 40, points: [cityPoint] };
const ahead = cameras.alertsAhead([city], lat, lon, { heading: 0, roadMode: "STREET" });
assert.strictEqual(ahead[0].phrase, "Speed camera ahead, limit 40");
assert.deepStrictEqual(cameras.alertsAhead([city], lat, lon, { heading: 180 }), []);
const farPoint = move(lat, lon, 350, 0);
const farCam = { id: "far", kind: "speed_camera", lat: farPoint[0], lon: farPoint[1], limit_kmh: 40, points: [farPoint] };
assert.deepStrictEqual(cameras.alertsAhead([farCam], lat, lon, { heading: 0, roadMode: "STREET" }), []);
const hwyPoint = move(lat, lon, 350, 0);
const hwy = { id: "hwy", kind: "variable", lat: hwyPoint[0], lon: hwyPoint[1], limit_kmh: 80, road_class: "motorway", points: [hwyPoint] };
assert.strictEqual(cameras.alertsAhead([hwy], lat, lon, { heading: 0, roadMode: "STREET" })[0].phrase, "Variable speed limit zone, usually posted 80");
const redPoint = move(lat, lon, 180, 0);
const red = { id: "rlc", kind: "red_light", lat: redPoint[0], lon: redPoint[1], points: [redPoint] };
assert.strictEqual(cameras.alertsAhead([red], lat, lon, { heading: 0 })[0].phrase, "Red light camera at the next intersection");

const side = move(lat, lon, 0, 200);
const beside = { id: "side", kind: "red_light", lat: side[0], lon: side[1], points: [side] };
const route = [[lat, lon], [city.lat, city.lon]];
const onRoute = cameras.alertsAhead([city, beside], lat, lon, { heading: 270, route, roadMode: "HIGHWAY" });
assert.deepStrictEqual(onRoute.map((item) => item.id), ["city"]);
assert.deepStrictEqual(cameras.alertsAhead([city], lat, lon, { heading: 0, route, spoken: { city: true } }), []);
const posted = cameras.alertsAhead(
  [{ id: "cam", kind: "speed_camera", lat: city.lat, lon: city.lon, points: [[city.lat, city.lon]] }],
  lat,
  lon,
  { heading: 0, postedKmh: 40 },
);
assert.strictEqual(posted[0].phrase, "Speed camera ahead, limit 40");
assert.ok(cameras.overpassQuery(43.65, -79.38).includes('node["highway"="speed_camera"'));
assert.ok(cameras.DISCLAIMER.includes("OpenStreetMap"));
console.log("client camera tests ok");
