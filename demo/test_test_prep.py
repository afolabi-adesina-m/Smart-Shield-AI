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


class StreetRingTests(unittest.TestCase):
    def test_waypoints_sit_on_through_streets_around_the_centre(self):
        from test_prep import _waypoints_from_ways

        centre = (43.75, -79.48)
        streets = [
            [(43.763, -79.50), (43.763, -79.46)],
            [(43.763, -79.46), (43.737, -79.46)],
            [(43.737, -79.46), (43.737, -79.50)],
            [(43.737, -79.50), (43.763, -79.50)],
        ]
        elements = []
        for index, coords in enumerate(streets):
            elements.append({
                "type": "way",
                "tags": {"highway": "primary", "name": f"Practice Road {index}"},
                "geometry": [{"lat": lat, "lon": lon} for lat, lon in coords],
            })
        dead = {
            "type": "way",
            "tags": {"highway": "residential", "name": "Parking Lot Lane"},
            "geometry": [{"lat": 43.752, "lon": -79.49}, {"lat": 43.752, "lon": -79.47}],
        }
        ring = _waypoints_from_ways(centre[0], centre[1], elements + [dead])
        self.assertGreaterEqual(len(ring), 4)
        self.assertNotIn((43.752, -79.49), [(round(lat, 3), round(lon, 3)) for lat, lon in ring])

    def test_primary_street_beats_a_closer_park_road(self):
        from test_prep import _waypoints_from_ways

        centre = (43.75, -79.48)
        # Near square is a park road. Far square is a primary arterial. Both are through streets.
        near = [
            [(43.761, -79.495), (43.761, -79.465)],
            [(43.761, -79.465), (43.739, -79.465)],
            [(43.739, -79.465), (43.739, -79.495)],
            [(43.739, -79.495), (43.761, -79.495)],
        ]
        far = [
            [(43.770, -79.505), (43.770, -79.480), (43.770, -79.455)],
            [(43.770, -79.455), (43.750, -79.455), (43.730, -79.455)],
            [(43.730, -79.455), (43.730, -79.480), (43.730, -79.505)],
            [(43.730, -79.505), (43.750, -79.505), (43.770, -79.505)],
        ]
        elements = []
        for coords in near:
            elements.append({
                "type": "way",
                "tags": {"highway": "residential", "name": "Downsview Park Boulevard"},
                "geometry": [{"lat": lat, "lon": lon} for lat, lon in coords],
            })
        for index, coords in enumerate(far):
            elements.append({
                "type": "way",
                "tags": {"highway": "primary", "name": f"Arterial {index}"},
                "geometry": [{"lat": lat, "lon": lon} for lat, lon in coords],
            })
        ring = _waypoints_from_ways(centre[0], centre[1], elements, target_km=1.3, sectors=4, max_rank=4)
        self.assertGreaterEqual(len(ring), 4)
        from test_prep import _haversine_m
        for lat, lon in ring:
            self.assertGreater(_haversine_m(centre[0], centre[1], lat, lon), 1800)

    def test_circuit_faults_flag_freeway_spurs_and_backtracking(self):
        from test_prep import _circuit_faults

        route = {
            "distance_m": 9000,
            "geometry": [[-79.48, 43.75], [-79.47, 43.76], [-79.48, 43.75]],
            "steps": [
                {"distance": 400, "name": "Carl Hall Road", "maneuver": {"type": "turn", "modifier": "right"}},
                {"distance": 800, "name": "Highway 401 Collector", "maneuver": {"type": "merge", "modifier": "slight left"}},
                {"distance": 200, "name": "Locust Lodge Gardens", "maneuver": {"type": "end of road", "modifier": "right"}},
                {"distance": 900, "name": "Keele Street", "maneuver": {"type": "turn", "modifier": "right"}},
                {"distance": 500, "name": "Sheppard Avenue West", "maneuver": {"type": "turn", "modifier": "left"}},
                {"distance": 800, "name": "Keele Street", "maneuver": {"type": "turn", "modifier": "left"}},
            ],
        }
        faults = set(_circuit_faults(route, 43.75, -79.48))
        self.assertIn("freeway", faults)
        self.assertIn("restricted", faults)
        self.assertIn("spur-street", faults)
        self.assertIn("backtrack", faults)

    def test_strip_spurs_drops_an_out_and_back(self):
        from test_prep import _strip_spurs

        line = [
            [-79.480, 43.750],
            [-79.479, 43.750],
            [-79.479, 43.751],
            [-79.479, 43.750],
            [-79.478, 43.750],
        ]
        cleaned = _strip_spurs(line)
        self.assertEqual(cleaned[0], [-79.480, 43.750])
        self.assertEqual(cleaned[-1], [-79.478, 43.750])
        self.assertNotIn([-79.479, 43.751], cleaned)


class LoopTests(unittest.TestCase):
    def test_loop_uses_route_shape_when_overpass_fails(self):
        loop = build_practice_loop("downsview", "G", fetch=_fake_fetch)
        kinds = [point["kind"] for point in loop["points"]]
        self.assertIn("left_turn", kinds)
        self.assertIn("ramp", kinds)
        self.assertIn("roundabout", kinds)
        centre = next(item for item in list_centres() if item["id"] == "downsview")
        self.assertAlmostEqual(loop["geometry"][0][0], centre["lon"], places=4)
        self.assertAlmostEqual(loop["geometry"][0][1], centre["lat"], places=4)
        self.assertEqual(loop["geometry"][0], loop["geometry"][-1])
        self.assertIn([-79.48, 43.75], loop["geometry"])
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
