"""Unit tests for posted-limit parsing and the Safe Speed display rule.

Also checks the ice-storm route score still matches the audited advisory.
Run from the repo root:  python -m unittest demo.test_speed_limit
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "demo"))
sys.path.insert(0, str(ROOT / "src"))

from speed_limit import (  # noqa: E402
    default_for_highway,
    parse_maxspeed,
    posted_from_way,
    safe_speed_kmh,
    select_way,
)


class ParseMaxspeedTests(unittest.TestCase):
    def test_plain_and_units(self):
        self.assertEqual(parse_maxspeed("100"), 100)
        self.assertEqual(parse_maxspeed("100 km/h"), 100)
        self.assertEqual(parse_maxspeed("30 mph"), 48)
        self.assertEqual(parse_maxspeed("60;80"), 60)
        self.assertEqual(parse_maxspeed("50|50|30"), 50)

    def test_non_numeric(self):
        self.assertIsNone(parse_maxspeed("signals"))
        self.assertIsNone(parse_maxspeed("none"))
        self.assertIsNone(parse_maxspeed(""))
        self.assertIsNone(parse_maxspeed(None))


class SelectWayTests(unittest.TestCase):
    def test_prefers_tagged_driving_road_over_closer_footway(self):
        elements = [
            {
                "type": "way",
                "id": 1,
                "center": {"lat": 43.6534, "lon": -79.3832},
                "tags": {"highway": "footway"},
            },
            {
                "type": "way",
                "id": 2,
                "center": {"lat": 43.6536, "lon": -79.3834},
                "tags": {"highway": "secondary", "name": "Bay Street", "maxspeed": "40"},
            },
        ]
        way = select_way(43.6532, -79.3832, elements)
        self.assertEqual(way["id"], 2)
        self.assertEqual(way["maxspeed"], 40)
        posted = posted_from_way(way)
        self.assertEqual(posted["posted_kmh"], 40)
        self.assertFalse(posted["estimated"])
        self.assertEqual(posted["posted_source"], "osm")

    def test_estimates_from_road_type_when_untagged(self):
        elements = [
            {
                "type": "way",
                "id": 9,
                "center": {"lat": 43.7, "lon": -79.4},
                "tags": {"highway": "residential", "name": "Elm Street"},
            }
        ]
        way = select_way(43.7, -79.4, elements)
        posted = posted_from_way(way)
        self.assertTrue(posted["estimated"])
        self.assertEqual(posted["posted_kmh"], default_for_highway("residential"))
        self.assertIn("estimated", posted["detail"].lower())

    def test_unknown_when_no_roads(self):
        posted = posted_from_way(None, lookup_error="timeout")
        self.assertEqual(posted["posted_kmh"], 50)
        self.assertTrue(posted["estimated"])
        self.assertEqual(posted["highway"], "unknown")


class SafeSpeedTests(unittest.TestCase):
    def test_scales_existing_route_advisory(self):
        # Model advisory is 80 km/h against the 100 km/h assumption.
        hwy = safe_speed_kmh(100, "motorway", tier="HIGH", recommended_kmh=80)
        self.assertEqual(hwy["safe_kmh"], 80)
        self.assertEqual(hwy["source"], "route_advisory")
        city = safe_speed_kmh(40, "secondary", tier="MEDIUM", recommended_kmh=80)
        self.assertEqual(city["safe_kmh"], 32)
        self.assertLess(city["safe_kmh"], 40)

    def test_weather_and_freeway_floor_without_changing_model_outputs(self):
        wet = safe_speed_kmh(40, "secondary", weather="wet")
        self.assertEqual(wet["safe_kmh"], 32)
        self.assertEqual(wet["tier"], "MEDIUM")
        ice = safe_speed_kmh(100, "motorway", weather="ice_storm")
        self.assertEqual(ice["safe_kmh"], 80)
        self.assertTrue(ice["floor_applied"])
        self.assertLessEqual(ice["safe_kmh"], ice["posted_kmh"])

    def test_clear_matches_posted(self):
        clear = safe_speed_kmh(100, "motorway", weather="clear")
        self.assertEqual(clear["safe_kmh"], 100)


class ExistingPredictionTests(unittest.TestCase):
    def test_ice_storm_advisory_unchanged(self):
        """Audited Toronto–Barrie ice-storm score (SS-AUDIT-2026-001)."""
        from inference import score_routes_batch

        scored = score_routes_batch(
            [{
                "distance_m": 95000,
                "duration_s": 5040,
                "hour": 17,
                "month": 6,
                "summary": "Fastest route",
                "lat": 43.8,
                "lon": -79.5,
            }],
            weather="ice_storm",
            vision_mode="proxy",
        )
        best = scored[0]
        self.assertEqual(best["tier"], "HIGH")
        self.assertEqual(best["recommended_speed_kmh"], 80)
        self.assertEqual(best["naive_recommended_speed_kmh"], 60)
        self.assertEqual(best["operational_guidance"], "AVOID_TRAVEL")
        self.assertEqual(best["safety_score"], 80.6)


if __name__ == "__main__":
    unittest.main()
