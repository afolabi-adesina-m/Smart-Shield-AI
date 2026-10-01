"""Street-name labels parsed from OSRM steps. No live routing."""

from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))

from engine_loader import prepare_engine  # noqa: E402

prepare_engine()

from flask import Flask  # noqa: E402

from flask_common import register_api_routes  # noqa: E402
from road_preview import road_label, steps_from_route  # noqa: E402


def _fixture_route():
    return {
        "code": "Ok",
        "routes": [{
            "distance": 1200.0,
            "duration": 180.0,
            "geometry": {"coordinates": [[-79.38, 43.65], [-79.37, 43.66]]},
            "legs": [{
                "steps": [
                    {
                        "name": "Dundas St W",
                        "ref": "401",
                        "distance": 400,
                        "maneuver": {
                            "type": "depart",
                            "modifier": "straight",
                            "location": [-79.38, 43.65],
                        },
                        "geometry": {"coordinates": [[-79.38, 43.65], [-79.379, 43.651]]},
                    },
                    {
                        "name": "",
                        "ref": "401",
                        "distance": 700,
                        "maneuver": {
                            "type": "new name",
                            "modifier": "straight",
                            "location": [-79.379, 43.651],
                        },
                        "geometry": {"coordinates": [[-79.379, 43.651], [-79.37, 43.655]]},
                    },
                    {
                        "name": " ",
                        "ref": "QEW",
                        "distance": 100,
                        "maneuver": {"type": "turn", "modifier": "right", "location": [-79.37, 43.655]},
                        "geometry": {"coordinates": [[-79.37, 43.655], [-79.37, 43.66]]},
                    },
                    {
                        "name": "",
                        "ref": "",
                        "distance": 0,
                        "maneuver": {"type": "arrive", "location": [-79.37, 43.66]},
                        "geometry": {"coordinates": [[-79.37, 43.66]]},
                    },
                    {
                        "name": "Skip me",
                        "maneuver": {},
                    },
                ],
            }],
        }],
    }


class RoadLabelTests(unittest.TestCase):
    def test_name_wins_over_ref(self):
        self.assertEqual(road_label("Dundas St W", "401"), "Dundas St W")

    def test_numeric_ref_becomes_highway(self):
        self.assertEqual(road_label("", "401"), "Hwy 401")
        self.assertEqual(road_label(None, "27A"), "Hwy 27A")

    def test_named_ref_is_kept(self):
        self.assertEqual(road_label("", "QEW"), "QEW")

    def test_missing_name_is_unnamed(self):
        self.assertEqual(road_label("  ", ""), "Unnamed road")
        self.assertEqual(road_label(None, None), "Unnamed road")


class StepsFromRouteTests(unittest.TestCase):
    def test_labels_and_skips_empty_maneuvers(self):
        steps = steps_from_route(_fixture_route()["routes"][0])
        self.assertEqual([step["name"] for step in steps], ["Dundas St W", "Hwy 401", "QEW", "Unnamed road"])
        self.assertEqual(steps[0]["instruction"], "Head onto Dundas St W")
        self.assertEqual(steps[1]["instruction"], "Continue on Hwy 401")
        self.assertEqual(steps[2]["instruction"], "Turn right onto QEW")
        self.assertEqual(steps[3]["instruction"], "Arrive · Unnamed road")
        self.assertEqual(steps[3]["location"], [-79.37, 43.66])


class DirectionsPayloadTests(unittest.TestCase):
    def test_steps_are_added_without_changing_route_fields(self):
        app = Flask(__name__)
        register_api_routes(app)
        fixture = _fixture_route()
        with patch("flask_common._osm_get", return_value=fixture) as mocked:
            response = app.test_client().get(
                "/api/directions?from_lat=43.65&from_lon=-79.38&to_lat=43.66&to_lon=-79.37"
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(mocked.call_args[0][1]["steps"], "true")
        route = response.get_json()["routes"][0]
        self.assertEqual(route["distance"], 1200.0)
        self.assertEqual(route["duration"], 180.0)
        self.assertEqual(route["geometry"], [[-79.38, 43.65], [-79.37, 43.66]])
        self.assertEqual(route["mid_lon"], -79.37)
        self.assertEqual(route["mid_lat"], 43.66)
        self.assertEqual(route["steps"][1]["name"], "Hwy 401")
        self.assertNotIn("legs", route)


class TravelModeTests(unittest.TestCase):
    def test_transit_polyline_precision_is_detected(self):
        from travel_modes import decode_polyline_auto

        points = decode_polyline_auto("oprm_Ynqw`in@nyw_@nha`D")
        self.assertEqual(points[0], [-79.3801, 43.6447])
        self.assertEqual(points[1], [-79.644, 43.591])

    def test_motorcycle_reuses_the_car_route(self):
        app = Flask(__name__)
        register_api_routes(app)
        with patch("flask_common._osm_get", return_value=_fixture_route()) as mocked:
            response = app.test_client().get(
                "/api/directions?from_lat=43.65&from_lon=-79.38&to_lat=43.66&to_lon=-79.37&mode=motorcycle"
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(mocked.call_args[0][1]["steps"], "true")
        body = response.get_json()
        self.assertEqual(body["mode"], "motorcycle")
        self.assertIn("Motorways are allowed in Ontario", body["note"])
        self.assertEqual(body["routes"][0]["geometry"], [[-79.38, 43.65], [-79.37, 43.66]])

    def test_cycle_falls_back_when_the_first_host_is_busy(self):
        from travel_modes import clear_cache

        clear_cache()
        app = Flask(__name__)
        register_api_routes(app)
        calls = []

        def fake_get(url, params=None, headers=None, timeout=None):
            calls.append(url)
            if "routed-bike" in url:
                busy = requests.Response()
                busy.status_code = 429
                return busy
            ok = requests.Response()
            ok.status_code = 200
            ok._content = json.dumps(_fixture_route()).encode()
            return ok

        with patch("travel_modes.requests.get", side_effect=fake_get):
            response = app.test_client().get(
                "/api/directions?from_lat=43.65&from_lon=-79.38&to_lat=43.66&to_lon=-79.37&mode=cycle"
            )
            again = app.test_client().get(
                "/api/directions?from_lat=43.65&from_lon=-79.38&to_lat=43.66&to_lon=-79.37&mode=cycle"
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(calls), 2)
        self.assertIn("routed-bike", calls[0])
        self.assertIn("/bike/", calls[1])
        self.assertEqual(again.status_code, 200)
        self.assertEqual(len(calls), 2)
        self.assertEqual(response.get_json()["routes"][0]["steps"][1]["name"], "Hwy 401")

    def test_cycle_rewrites_a_driving_duration(self):
        from travel_modes import clear_cache, realistic_duration

        kept, estimated = realistic_duration("cycle", 37000, 148 * 60)
        self.assertFalse(estimated)
        self.assertEqual(kept, 148 * 60)
        seconds, replaced = realistic_duration("cycle", 40000, 35 * 60)
        self.assertTrue(replaced)
        self.assertAlmostEqual(seconds, 40000 / (16.5 * 1000 / 3600), places=1)
        walk_kept, walk_estimated = realistic_duration("walk", 35000, 471 * 60)
        self.assertFalse(walk_estimated)
        self.assertEqual(walk_kept, 471 * 60)
        walk_seconds, walk_replaced = realistic_duration("walk", 35000, 30 * 60)
        self.assertTrue(walk_replaced)
        self.assertAlmostEqual(walk_seconds, 35000 / (4.8 * 1000 / 3600), places=1)

        clear_cache()
        app = Flask(__name__)
        register_api_routes(app)
        fast = _fixture_route()
        fast["routes"][0]["distance"] = 40000
        fast["routes"][0]["duration"] = 2100

        class Ok:
            status_code = 200

            def json(self):
                return fast

        with patch("travel_modes.requests.get", return_value=Ok()):
            response = app.test_client().get(
                "/api/directions?from_lat=43.64&from_lon=-79.38&to_lat=43.65&to_lon=-79.74&mode=cycle"
            )
        self.assertEqual(response.status_code, 200)
        body = response.get_json()
        self.assertEqual(body["mode"], "cycle")
        self.assertIn("16.5 km/h", body["note"])
        self.assertAlmostEqual(body["routes"][0]["duration"], 40000 / (16.5 * 1000 / 3600), places=1)

    def test_transit_keeps_scheduled_times_and_missing_colours(self):
        from travel_modes import clear_cache

        clear_cache()
        app = Flask(__name__)
        register_api_routes(app)
        payload = {
            "itineraries": [{
                "duration": 1800,
                "startTime": "2026-09-29T14:00:00Z",
                "endTime": "2026-09-29T14:30:00Z",
                "transfers": 1,
                "legs": [
                    {
                        "mode": "WALK",
                        "duration": 300,
                        "distance": 400,
                        "startTime": "2026-09-29T14:00:00Z",
                        "endTime": "2026-09-29T14:05:00Z",
                        "realTime": False,
                        "from": {"name": "Union Station", "departure": "2026-09-29T14:00:00Z"},
                        "to": {"name": "Union Station Bus Terminal", "arrival": "2026-09-29T14:05:00Z"},
                        "legGeometry": {"points": "_p~iF~ps|U_ulLnnqC"},
                    },
                    {
                        "mode": "BUS",
                        "routeShortName": "29",
                        "routeLongName": "Dufferin",
                        "agencyName": "TTC",
                        "headsign": "29 Dufferin",
                        "duration": 1200,
                        "realTime": False,
                        "from": {"name": "Union Station Bus Terminal", "departure": "2026-09-29T14:06:00Z"},
                        "to": {"name": "Bloor", "arrival": "2026-09-29T14:26:00Z"},
                        "intermediateStops": [
                            {"name": "King", "lat": 43.65, "lon": -79.39},
                            {"name": "Queen", "lat": 43.65, "lon": -79.39},
                        ],
                        "legGeometry": {"points": "_p~iF~ps|U_ulLnnqC"},
                    },
                ],
            }],
        }

        class Ok:
            status_code = 200

            def json(self):
                return payload

        with patch("travel_modes.requests.get", return_value=Ok()):
            response = app.test_client().get(
                "/api/directions?from_lat=43.64&from_lon=-79.38&to_lat=43.59&to_lon=-79.64&mode=transit"
            )
        self.assertEqual(response.status_code, 200)
        body = response.get_json()
        self.assertTrue(body["scheduled"])
        self.assertIn("Scheduled times", body["note"])
        bus = body["itineraries"][0]["legs"][1]
        self.assertEqual(bus["line"], "29")
        self.assertIsNone(bus["color"])
        self.assertTrue(bus["color_missing"])
        self.assertEqual(bus["stop_count"], 2)
        self.assertEqual(bus["draw_color"], "#5f6368")
        self.assertGreaterEqual(len(bus["geometry"]), 2)
        self.assertEqual(body["itineraries"][0]["walk_min"], 5)
        notes = body["itineraries"][0]["walk_notes"]
        self.assertTrue(any("last stop" in note for note in notes))
        self.assertFalse(any("first stop" in note for note in notes))
        self.assertEqual(body["itineraries"][0]["legs"][0]["mode"], "WALK")
        self.assertEqual(body["itineraries"][0]["legs"][0]["distance_m"], 400)
        self.assertGreaterEqual(len(body["itineraries"][0]["legs"][0]["geometry"]), 2)
        self.assertTrue(all(-180 <= point[0] <= 180 and -90 <= point[1] <= 90 for point in bus["geometry"]))


if __name__ == "__main__":
    unittest.main()
