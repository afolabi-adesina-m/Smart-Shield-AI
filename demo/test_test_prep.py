"""Practice-loop builder. No live routing calls."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from test_prep import (  # noqa: E402
    DISCLAIMER,
    TestPrepError,
    build_practice_loop,
    list_centres,
)


def _fake_fetch(url, params=None, method="get"):
    if "overpass" in url or method == "post":
        raise TimeoutError("overpass down")
    return {
        "routes": [{
            "distance": 4200,
            "duration": 540,
            "geometry": {"coordinates": [[-79.48, 43.75], [-79.47, 43.76], [-79.48, 43.75]]},
            "legs": [{
                "steps": [
                    {
                        "distance": 800,
                        "name": "Carl Hall Road",
                        "maneuver": {"type": "depart", "modifier": "", "location": [-79.48, 43.75]},
                    },
                    {
                        "distance": 600,
                        "name": "Keele Street",
                        "maneuver": {"type": "turn", "modifier": "left", "location": [-79.475, 43.752]},
                    },
                    {
                        "distance": 700,
                        "name": "Highway 401",
                        "maneuver": {"type": "on ramp", "modifier": "right", "location": [-79.47, 43.755]},
                    },
                    {
                        "distance": 500,
                        "name": "",
                        "maneuver": {"type": "roundabout", "modifier": "", "location": [-79.472, 43.748]},
                    },
                ]
            }],
        }]
    }


class CentreTests(unittest.TestCase):
    def test_seed_list_covers_the_requested_centres(self):
        ids = {item["id"] for item in list_centres()}
        for centre_id in (
            "downsview", "etobicoke", "port-union", "metro-east", "brampton",
            "mississauga", "oakville", "oshawa", "newmarket", "barrie",
            "hamilton", "ottawa-walkley", "london", "kitchener",
        ):
            self.assertIn(centre_id, ids)
        self.assertTrue(all("lat" in item and "address" in item for item in list_centres()))


class LoopTests(unittest.TestCase):
    def test_loop_uses_route_shape_when_overpass_fails(self):
        loop = build_practice_loop("downsview", "G", fetch=_fake_fetch)
        kinds = [point["kind"] for point in loop["points"]]
        self.assertIn("left_turn", kinds)
        self.assertIn("ramp", kinds)
        self.assertIn("roundabout", kinds)
        self.assertEqual(loop["geometry"][0], [-79.48, 43.75])
        self.assertEqual(loop["centre"]["id"], "downsview")
        self.assertIn("not official", loop["disclaimer"].lower())
        self.assertEqual(loop["disclaimer"], DISCLAIMER)
        self.assertIn("unavailable", loop["overpass_note"].lower())

    def test_g2_does_not_score_highway_ramps(self):
        loop = build_practice_loop("oakville", "G2", fetch=_fake_fetch)
        ramps = [point for point in loop["points"] if point["kind"] == "ramp"]
        self.assertTrue(ramps)
        self.assertFalse(ramps[0]["scored"])
        self.assertIn("G2", ramps[0]["label"])

    def test_unknown_centre(self):
        with self.assertRaises(TestPrepError) as caught:
            build_practice_loop("nope", fetch=_fake_fetch)
        self.assertEqual(caught.exception.status, 404)


if __name__ == "__main__":
    unittest.main()
