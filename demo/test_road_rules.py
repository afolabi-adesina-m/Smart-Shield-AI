"""Street, exit, and fleet-score rules. The highway model is not modified.

Run from the repo root:  python -m unittest demo.test_road_rules demo.test_speed_limit
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "demo"))
sys.path.insert(0, str(ROOT / "src"))

from road_rules import (  # noqa: E402
    build_context,
    clear_caches,
    context_from_demo,
    driver_score,
    load_demo_route,
    mode_for_highway,
    point_at,
    road_context,
)
from speed_limit import default_for_highway, safe_speed_kmh  # noqa: E402


class ModeTests(unittest.TestCase):
    def test_highway_exit_and_street(self):
        self.assertEqual(mode_for_highway("motorway"), "HIGHWAY")
        self.assertEqual(mode_for_highway("trunk"), "HIGHWAY")
        self.assertEqual(mode_for_highway("motorway_link"), "EXIT")
        for tag in ("primary", "secondary", "tertiary", "residential", "unclassified"):
            self.assertEqual(mode_for_highway(tag), "STREET", tag)


class StreetRuleTests(unittest.TestCase):
    def test_bump_lowers_safe_speed_only_on_a_street(self):
        geometry = [[-79.70, 43.60], [-79.70, 43.605]]
        bump_lat = 43.60 + (25 / 111_320)
        ctx = build_context(
            43.60,
            -79.70,
            {"highway": "residential", "name": "Elm", "maxspeed": 40, "dist": 1, "id": 3},
            hazards=[{"kind": "speed_bump", "lat": bump_lat, "lon": -79.70, "id": "bump-1"}],
            geometry=geometry,
        )
        self.assertEqual(ctx["road_mode"], "STREET")
        self.assertEqual(ctx["posted_kmh"], 40)
        self.assertEqual(ctx["posted_label"], "posted")
        self.assertFalse(ctx["estimated"])
        self.assertEqual(ctx["safe_kmh"], 20)
        self.assertTrue(any("Speed bump ahead" in alert["text"] for alert in ctx["alerts"]))

    def test_hazard_behind_the_car_is_hidden(self):
        geometry = [[-79.70, 43.60], [-79.70, 43.605]]
        behind = 43.60 - (40 / 111_320)
        ctx = build_context(
            43.60,
            -79.70,
            {"highway": "residential", "name": "Elm", "maxspeed": 40, "dist": 1, "id": 3},
            hazards=[{"kind": "speed_bump", "lat": behind, "lon": -79.70, "id": "bump-back"}],
            geometry=geometry,
        )
        self.assertEqual(ctx["alerts"], [])
        self.assertEqual(ctx["safe_kmh"], 40)

    def test_estimated_urban_and_rural_defaults(self):
        urban = build_context(
            43.6, -79.6,
            {"highway": "tertiary", "name": None, "maxspeed": None, "dist": 5, "id": 9},
        )
        self.assertEqual(urban["posted_kmh"], 50)
        self.assertEqual(urban["posted_label"], "estimated")
        self.assertIn("50", urban["detail"])

        rural = build_context(
            43.6, -79.6,
            {"highway": "primary", "name": None, "maxspeed": None, "dist": 5, "id": 10},
        )
        self.assertEqual(rural["posted_kmh"], 80)
        self.assertTrue(rural["estimated"])
        self.assertIn("80", rural["detail"])

    def test_exit_ramp_estimate_is_50_not_the_old_link_default(self):
        self.assertEqual(default_for_highway("motorway_link"), 80)
        ctx = build_context(
            43.6, -79.6,
            {"highway": "motorway_link", "name": "Ramp", "maxspeed": None, "dist": 3, "id": 11},
        )
        self.assertEqual(ctx["road_mode"], "EXIT")
        self.assertEqual(ctx["posted_kmh"], 50)
        self.assertEqual(ctx["posted_label"], "estimated")
        self.assertIn("40", ctx["detail"])
        self.assertIn("60", ctx["detail"])

    def test_wet_weather_lowers_a_street_further(self):
        ctx = build_context(
            43.6, -79.6,
            {"highway": "residential", "name": "Elm", "maxspeed": 50, "dist": 2, "id": 12},
            weather="wet",
        )
        self.assertEqual(ctx["posted_kmh"], 50)
        self.assertEqual(ctx["safe_kmh"], 40)

    def test_school_zone_cap(self):
        geometry = [[-79.70, 43.60], [-79.70, 43.605]]
        school_lat = 43.60 + (50 / 111_320)
        ctx = build_context(
            43.60,
            -79.70,
            {"highway": "residential", "name": "Elm", "maxspeed": 50, "dist": 1, "id": 13},
            hazards=[{"kind": "school_zone", "lat": school_lat, "lon": -79.70, "id": "school-1"}],
            geometry=geometry,
        )
        self.assertTrue(ctx["school_active"])
        self.assertEqual(ctx["safe_kmh"], 40)
        self.assertTrue(any(alert["kind"] == "school_zone" for alert in ctx["alerts"]))


class HighwayUnchangedTests(unittest.TestCase):
    def test_highway_safe_speed_ignores_a_nearby_bump(self):
        expected = safe_speed_kmh(100, "motorway", recommended_kmh=80)
        ctx = build_context(
            43.57,
            -79.67,
            {"highway": "motorway", "name": "403", "maxspeed": 100, "dist": 2, "id": 1},
            hazards=[{"kind": "speed_bump", "lat": 43.5704, "lon": -79.674, "id": "b"}],
            geometry=[[-79.676, 43.570], [-79.660, 43.580]],
            recommended_kmh=80,
        )
        self.assertEqual(ctx["road_mode"], "HIGHWAY")
        self.assertEqual(ctx["safe_kmh"], expected["safe_kmh"])
        self.assertEqual(ctx["safe_kmh"], 80)
        self.assertEqual(ctx["active_caps"], [])
        self.assertEqual(ctx["posted_label"], "posted")


class ScoreTests(unittest.TestCase):
    def test_formula_and_clamp(self):
        events = [
            {"kind": "over_posted"},
            {"kind": "missed_exit"},
            {"kind": "harsh_brake"},
        ]
        self.assertEqual(driver_score(events), 76)
        self.assertEqual(driver_score([{"kind": "school_speeding"}]), 85)
        self.assertEqual(driver_score(events * 30), 0)


class OverpassFailureTests(unittest.TestCase):
    def setUp(self):
        clear_caches()

    def tearDown(self):
        clear_caches()

    def test_down_overpass_still_returns_an_estimated_limit(self):
        def boom(*_args, **_kwargs):
            raise RuntimeError("timed out")

        out = road_context(43.65, -79.38, demo=False, fetch=boom)
        self.assertFalse(out["lookup_ok"])
        self.assertGreater(out["posted_kmh"], 0)
        self.assertEqual(out["posted_label"], "estimated")
        self.assertIn("estimated", out["detail"].lower())

    def test_second_call_is_rate_limited_without_crashing(self):
        calls = {"n": 0}

        def boom(*_args, **_kwargs):
            calls["n"] += 1
            raise RuntimeError("down")

        first = road_context(43.65, -79.38, fetch=boom)
        second = road_context(43.90, -79.80, fetch=boom)
        self.assertFalse(first["lookup_ok"])
        self.assertFalse(second["lookup_ok"])
        self.assertGreater(second["posted_kmh"], 0)
        self.assertGreater(calls["n"], 0)
        self.assertLess(calls["n"], 8)


class DemoRouteTests(unittest.TestCase):
    def test_scenes_cover_highway_exit_and_street(self):
        route = load_demo_route()
        coords = route["coordinates"]
        expected = {
            "highway": "HIGHWAY",
            "exit_warning": "HIGHWAY",
            "exit": "EXIT",
            "street": "STREET",
            "bump": "STREET",
        }
        for name, mode in expected.items():
            lat, lon = point_at(coords, route["scenes"][name]["along_m"])
            ctx = context_from_demo(lat, lon)
            self.assertEqual(ctx["road_mode"], mode, name)
            self.assertEqual(ctx["posted_label"], "posted", name)

        warning = context_from_demo(*point_at(coords, route["scenes"]["exit_warning"]["along_m"]))
        self.assertEqual(warning["exit_warning"]["text"], "Slow down: exit ahead")
        self.assertGreaterEqual(warning["exit_warning"]["distance_m"], 300)
        self.assertLessEqual(warning["exit_warning"]["distance_m"], 500)

        ramp = context_from_demo(*point_at(coords, route["scenes"]["exit"]["along_m"]))
        self.assertEqual(ramp["posted_kmh"], 50)
        self.assertFalse(ramp["estimated"])

        street = context_from_demo(*point_at(coords, route["scenes"]["street"]["along_m"]))
        self.assertTrue(any("Traffic signal ahead" in alert["text"] for alert in street["alerts"]))

        bump = context_from_demo(*point_at(coords, route["scenes"]["bump"]["along_m"]))
        self.assertTrue(any("Speed bump ahead" in alert["text"] for alert in bump["alerts"]))

    def test_playback_samples_hit_every_warning(self):
        route = load_demo_route()
        coords = route["coordinates"]
        total = float(route["total_m"])
        along = 0.0
        saw = {"exit_warning": False, "exit": False, "signal_cap": False, "bump_cap": False, "signal_alert": False}

        def speed_at(distance):
            for band in route["speed_profile"]:
                if distance < float(band["to_m"]):
                    return float(band["kmh"])
            return float(route["speed_profile"][-1]["kmh"])

        while along < total:
            lat, lon = point_at(coords, along)
            ctx = context_from_demo(lat, lon)
            if ctx["exit_warning"]:
                saw["exit_warning"] = True
                self.assertEqual(ctx["road_mode"], "HIGHWAY")
            if ctx["road_mode"] == "EXIT":
                saw["exit"] = True
                self.assertEqual(ctx["posted_kmh"], 50)
            if any(alert["kind"] == "traffic_signal" for alert in ctx["alerts"]):
                saw["signal_alert"] = True
            if any(cap["kind"] == "traffic_signal" for cap in ctx["active_caps"]):
                saw["signal_cap"] = True
                self.assertLessEqual(ctx["safe_kmh"], 30)
            if any(cap["kind"] == "speed_bump" for cap in ctx["active_caps"]):
                saw["bump_cap"] = True
                self.assertLessEqual(ctx["safe_kmh"], 20)
            along += max(8.0, speed_at(along) / 3.6)

        self.assertTrue(all(saw.values()), saw)


if __name__ == "__main__":
    unittest.main()
