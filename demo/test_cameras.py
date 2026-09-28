"""Camera parsers, Toronto fetch, and approach alerts. No live network."""

from __future__ import annotations

import json
import math
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "demo"))

from cameras import (  # noqa: E402
    DISCLAIMER,
    alerts_ahead,
    dedupe_cameras,
    load_toronto_cameras,
    parse_overpass,
    parse_toronto_records,
    reset_camera_cache,
)


def _move(lat, lon, north_m=0.0, east_m=0.0):
    lat2 = lat + north_m / 111320.0
    lon2 = lon + east_m / (111320.0 * math.cos(math.radians(lat)))
    return lat2, lon2


class _Response:
    def __init__(self, payload, status=200):
        self.status_code = status
        self._payload = payload
        self.headers = {}

    def json(self):
        return self._payload


class ParserTests(unittest.TestCase):
    def test_overpass_cameras_and_variable_way(self):
        features = parse_overpass([
            {
                "type": "node",
                "id": 1,
                "lat": 43.65,
                "lon": -79.38,
                "tags": {"highway": "speed_camera", "maxspeed": "40"},
            },
            {
                "type": "node",
                "id": 2,
                "lat": 43.66,
                "lon": -79.39,
                "tags": {"enforcement": "maxspeed", "maxspeed": "50"},
            },
            {
                "type": "relation",
                "id": 9,
                "tags": {"type": "enforcement", "enforcement": "traffic_signals"},
                "members": [{"type": "node", "ref": 3, "role": "device", "lat": 43.7, "lon": -79.4}],
            },
            {
                "type": "way",
                "id": 4,
                "tags": {"highway": "motorway", "maxspeed:variable": "80", "maxspeed": "80"},
                "geometry": [{"lat": 43.1, "lon": -79.1}, {"lat": 43.11, "lon": -79.11}],
            },
            {
                "type": "node",
                "id": 8,
                "lat": 43.2,
                "lon": -79.2,
                "tags": {"highway": "stop"},
            },
        ])
        by_id = {item["id"]: item for item in features}
        self.assertEqual(by_id["osm:node:1"]["kind"], "speed_camera")
        self.assertEqual(by_id["osm:node:1"]["limit_kmh"], 40)
        self.assertEqual(by_id["osm:node:2"]["kind"], "speed_camera")
        self.assertEqual(by_id["osm:node:2"]["limit_kmh"], 50)
        self.assertEqual(by_id["osm:relation:9"]["kind"], "red_light")
        self.assertAlmostEqual(by_id["osm:relation:9"]["lat"], 43.7)
        self.assertEqual(by_id["osm:way:4"]["kind"], "variable")
        self.assertEqual(by_id["osm:way:4"]["limit_kmh"], 80)
        self.assertEqual(by_id["osm:way:4"]["road_class"], "motorway")
        self.assertNotIn("osm:node:8", by_id)

    def test_toronto_records_skip_planned_cameras(self):
        red = parse_toronto_records("red_light", [{
            "ID": 43,
            "NAME": "Jane St And Clair Rd",
            "geometry": json.dumps({"type": "Point", "coordinates": [-79.513685, 43.74124]}),
        }])
        speed = parse_toronto_records("speed_camera", [
            {"FID": 1, "Status": "Active", "location": "Kipling Ave", "geometry": {"type": "Point", "coordinates": [-79.567, 43.714]}},
            {"FID": 2, "Status": "Planned", "location": "Later", "geometry": {"type": "Point", "coordinates": [-79.4, 43.7]}},
        ])
        self.assertEqual(red[0]["id"], "toronto:rlc:43")
        self.assertEqual(red[0]["kind"], "red_light")
        self.assertAlmostEqual(red[0]["lat"], 43.74124)
        self.assertEqual(len(speed), 1)
        self.assertEqual(speed[0]["id"], "toronto:ase:1")
        self.assertEqual(speed[0]["name"], "Kipling Ave")

    def test_dedupe_drops_toronto_within_30m(self):
        osm = [{
            "id": "osm:node:1",
            "kind": "red_light",
            "lat": 43.65,
            "lon": -79.38,
            "limit_kmh": None,
            "source": "osm",
            "points": [[43.65, -79.38]],
        }]
        near_lat, near_lon = _move(43.65, -79.38, north_m=20)
        far_lat, far_lon = _move(43.65, -79.38, north_m=80)
        toronto = [
            {"id": "toronto:rlc:1", "kind": "red_light", "lat": near_lat, "lon": near_lon, "limit_kmh": None, "source": "toronto"},
            {"id": "toronto:rlc:2", "kind": "red_light", "lat": far_lat, "lon": far_lon, "limit_kmh": None, "source": "toronto"},
            {"id": "toronto:ase:9", "kind": "speed_camera", "lat": 43.65, "lon": -79.38, "limit_kmh": 40, "source": "toronto"},
        ]
        merged = dedupe_cameras(osm, toronto)
        ids = [item["id"] for item in merged]
        self.assertNotIn("toronto:rlc:1", ids)
        self.assertIn("toronto:rlc:2", ids)
        self.assertIn("toronto:ase:9", ids)
        self.assertIn("osm:node:1", ids)


class AlertTests(unittest.TestCase):
    def setUp(self):
        self.lat, self.lon = 43.65, -79.38

    def _feature(self, ident, kind, north_m, **extra):
        lat, lon = _move(self.lat, self.lon, north_m=north_m)
        feature = {
            "id": ident,
            "kind": kind,
            "lat": lat,
            "lon": lon,
            "limit_kmh": extra.pop("limit_kmh", None),
            "road_class": extra.pop("road_class", None),
            "points": [[lat, lon]],
        }
        feature.update(extra)
        return feature

    def test_heading_and_distance(self):
        city = self._feature("city", "speed_camera", 200, limit_kmh=40)
        far = self._feature("far", "speed_camera", 350, limit_kmh=40)
        highway = self._feature("hwy", "variable", 350, limit_kmh=80, road_class="motorway")
        # North of the driver. Heading 0 is north.
        city_alerts = alerts_ahead([city], self.lat, self.lon, heading=0, road_mode="STREET")
        self.assertEqual(city_alerts[0]["phrase"], "Speed camera ahead, limit 40")
        self.assertEqual(alerts_ahead([city], self.lat, self.lon, heading=180), [])
        self.assertEqual(alerts_ahead([far], self.lat, self.lon, heading=0, road_mode="STREET"), [])
        highway_alerts = alerts_ahead([highway], self.lat, self.lon, heading=0, road_mode="STREET")
        self.assertEqual(highway_alerts[0]["phrase"], "Variable speed limit zone, usually posted 80")
        self.assertEqual(
            alerts_ahead([self._feature("rlc", "red_light", 180)], self.lat, self.lon, heading=0)[0]["phrase"],
            "Red light camera at the next intersection",
        )

    def test_route_corridor_and_once_only(self):
        camera = self._feature("cam", "speed_camera", 200, limit_kmh=40)
        beside_lat, beside_lon = _move(self.lat, self.lon, east_m=200)
        beside = {
            "id": "side",
            "kind": "red_light",
            "lat": beside_lat,
            "lon": beside_lon,
            "limit_kmh": None,
            "points": [[beside_lat, beside_lon]],
        }
        route = [[self.lat, self.lon], [camera["lat"], camera["lon"]]]
        # Heading is west, but the camera is on the route ahead.
        first = alerts_ahead([camera, beside], self.lat, self.lon, heading=270, route=route, road_mode="HIGHWAY")
        self.assertEqual([item["id"] for item in first], ["cam"])
        again = alerts_ahead([camera], self.lat, self.lon, heading=0, route=route, spoken={"cam"})
        self.assertEqual(again, [])

    def test_posted_limit_fills_a_missing_camera_limit(self):
        camera = self._feature("cam", "speed_camera", 200)
        alerts = alerts_ahead([camera], self.lat, self.lon, heading=0, posted_kmh=40)
        self.assertEqual(alerts[0]["phrase"], "Speed camera ahead, limit 40")


class FetchTests(unittest.TestCase):
    def setUp(self):
        reset_camera_cache()

    def tearDown(self):
        reset_camera_cache()

    def test_network_then_cache_then_snapshot(self):
        calls = []

        def fake_get(url, params=None, headers=None, timeout=None):
            calls.append((url, params, headers))
            self.assertIn("Smart-Shield-AI/1.0", headers["User-Agent"])
            self.assertIn("Referer", headers)
            kind = "red_light" if params["resource_id"].startswith("b57") else "speed_camera"
            if kind == "red_light":
                record = {
                    "ID": 7,
                    "NAME": "King and Bathurst",
                    "geometry": {"type": "Point", "coordinates": [-79.4, 43.65]},
                }
            else:
                record = {
                    "FID": 3,
                    "Status": "Active",
                    "location": "Lake Shore",
                    "geometry": {"type": "Point", "coordinates": [-79.41, 43.64]},
                }
            return _Response({"result": {"total": 1, "records": [record]}})

        with tempfile.TemporaryDirectory() as tmp:
            cache = Path(tmp) / "cameras.json"
            snapshot = Path(tmp) / "snapshot.json"
            snapshot.write_text(json.dumps({"features": [{
                "id": "toronto:rlc:fallback",
                "kind": "red_light",
                "lat": 43.7,
                "lon": -79.4,
                "limit_kmh": None,
                "source": "toronto",
                "name": "Fallback",
            }]}), encoding="utf-8")
            first = load_toronto_cameras(get=fake_get, now=1_000, cache_path=cache, snapshot_path=snapshot)
            self.assertEqual({item["id"] for item in first}, {"toronto:rlc:7", "toronto:ase:3"})
            self.assertEqual(len(calls), 2)
            reset_camera_cache()
            second = load_toronto_cameras(
                get=lambda *_a, **_k: (_ for _ in ()).throw(AssertionError("cache should answer")),
                now=1_000 + 60,
                cache_path=cache,
                snapshot_path=snapshot,
            )
            self.assertEqual({item["id"] for item in second}, {"toronto:rlc:7", "toronto:ase:3"})

            def explode(*_args, **_kwargs):
                raise RuntimeError("429 Client Error: Too many requests for url: https://ckan.example/search")

            reset_camera_cache()
            stale = Path(tmp) / "stale.json"
            third = load_toronto_cameras(get=explode, now=5_000, cache_path=stale, snapshot_path=snapshot)
            self.assertEqual(third[0]["id"], "toronto:rlc:fallback")
            self.assertNotIn("429", DISCLAIMER)


class CameraRouteTests(unittest.TestCase):
    def test_api_returns_features_and_disclaimer(self):
        from unittest.mock import patch

        from api_server import APP

        sample = [{
            "id": "toronto:rlc:1",
            "kind": "red_light",
            "lat": 43.65,
            "lon": -79.38,
            "limit_kmh": None,
            "source": "toronto",
            "road_class": None,
            "name": "King",
            "points": [[43.65, -79.38]],
        }]
        with patch("flask_common.load_toronto_cameras", return_value=sample):
            resp = APP.test_client().get("/api/cameras?lat=43.65&lon=-79.38")
        self.assertEqual(resp.status_code, 200)
        body = resp.get_json()
        self.assertEqual(body["disclaimer"], DISCLAIMER)
        self.assertEqual(body["features"][0]["id"], "toronto:rlc:1")
        self.assertNotIn("points", body["features"][0])
        self.assertNotIn("429", body["disclaimer"])


if __name__ == "__main__":
    unittest.main()
