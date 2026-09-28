"""Street-name labels parsed from OSRM steps. No live routing."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import patch

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


if __name__ == "__main__":
    unittest.main()
