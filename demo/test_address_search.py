"""Autocomplete parsing and the suggest API. No live geocoder calls."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "demo"))

from geocode_suggest import (  # noqa: E402
    clear_cache,
    dedupe_suggestions,
    rank_suggestions,
    reverse_place,
    suggest_places,
    suggestion_from_photon,
)


class PhotonParseTests(unittest.TestCase):
    def test_street_in_ontario(self):
        item = suggestion_from_photon({
            "geometry": {"coordinates": [-79.383, 43.653]},
            "properties": {
                "osm_id": 10,
                "osm_type": "W",
                "name": "Bay Street",
                "city": "Toronto",
                "state": "Ontario",
                "country": "Canada",
                "countrycode": "CA",
            },
        })
        self.assertEqual(item["label"], "Bay Street")
        self.assertIn("Toronto", item["detail"])
        self.assertIn("Ontario", item["detail"])
        self.assertEqual(item["lat"], 43.653)
        self.assertEqual(item["lon"], -79.383)

    def test_rank_puts_ontario_first(self):
        items = [
            {"label": "Paris", "detail": "France", "countrycode": "FR", "state": ""},
            {"label": "Barrie", "detail": "Ontario", "countrycode": "CA", "state": "Ontario"},
            {"label": "Vancouver", "detail": "British Columbia", "countrycode": "CA", "state": "British Columbia"},
        ]
        ranked = rank_suggestions(items)
        self.assertEqual([i["label"] for i in ranked], ["Barrie", "Vancouver", "Paris"])

    def test_dedupe_same_label(self):
        items = [
            {"label": "Bay Street", "detail": "Toronto, Ontario, Canada"},
            {"label": "Bay Street", "detail": "Toronto, Ontario, Canada"},
            {"label": "Bay Street", "detail": "Ottawa, Ontario, Canada"},
        ]
        self.assertEqual(len(dedupe_suggestions(items)), 2)


class SuggestPlacesTests(unittest.TestCase):
    def setUp(self):
        clear_cache()

    def test_short_query_does_not_call_upstream(self):
        def explode(*_args, **_kwargs):
            raise AssertionError("upstream should not be called")
        out = suggest_places("ab", get=explode, min_interval=0)
        self.assertEqual(out["suggestions"], [])

    def test_fake_photon_response(self):
        def fake_get(url, params=None, headers=None, timeout=None):
            self.assertIn("photon", url)
            self.assertGreaterEqual(len(params["q"]), 3)
            self.assertIn("Smart-Shield-AI/1.0", (headers or {}).get("User-Agent", ""))
            self.assertIn("Referer", headers or {})
            return _Json(200, {"features": [{
                "geometry": {"coordinates": [-79.69, 44.389]},
                "properties": {
                    "osm_id": 99,
                    "osm_type": "R",
                    "name": "Barrie",
                    "state": "Ontario",
                    "country": "Canada",
                    "countrycode": "CA",
                },
            }]})

        out = suggest_places("Barrie", get=fake_get, min_interval=0)
        self.assertEqual(out["provider"], "photon")
        self.assertEqual(out["suggestions"][0]["label"], "Barrie")
        self.assertAlmostEqual(out["suggestions"][0]["lat"], 44.389)

    def test_photon_hit_is_one_request_even_outside_ontario(self):
        calls = []

        def fake_get(url, params=None, headers=None, timeout=None):
            calls.append((url, (params or {}).get("q")))
            return _Json(200, {"features": [{
                "geometry": {"coordinates": [2.35, 48.86]},
                "properties": {
                    "osm_id": 1,
                    "osm_type": "R",
                    "name": "Paris",
                    "state": "Ile-de-France",
                    "country": "France",
                    "countrycode": "FR",
                },
            }]})

        out = suggest_places("Paris", get=fake_get, min_interval=0)
        self.assertEqual(calls, [("https://photon.komoot.io/api/", "Paris")])
        self.assertEqual(out["provider"], "photon")
        self.assertEqual(out["suggestions"][0]["label"], "Paris")

    def test_repeat_query_uses_cache(self):
        calls = {"n": 0}

        def fake_get(url, params=None, headers=None, timeout=None):
            calls["n"] += 1
            return _Json(200, {"features": [{
                "geometry": {"coordinates": [-79.69, 44.389]},
                "properties": {
                    "osm_id": 99,
                    "osm_type": "R",
                    "name": "Barrie",
                    "state": "Ontario",
                    "country": "Canada",
                    "countrycode": "CA",
                },
            }]})

        suggest_places("Barrie", get=fake_get, min_interval=0)
        out = suggest_places("barrie", get=fake_get, min_interval=0)
        self.assertEqual(calls["n"], 1)
        self.assertEqual(out["suggestions"][0]["label"], "Barrie")

    def test_empty_photon_falls_back_to_nominatim_once(self):
        calls = []

        def fake_get(url, params=None, headers=None, timeout=None):
            calls.append(url)
            if "photon" in url:
                return _Json(200, {"features": []})
            return _Json(200, [{
                "lat": "44.389",
                "lon": "-79.69",
                "display_name": "Barrie, Ontario, Canada",
                "address": {
                    "city": "Barrie",
                    "state": "Ontario",
                    "country": "Canada",
                    "country_code": "ca",
                },
                "osm_type": "R",
                "osm_id": 1,
            }])

        out = suggest_places("Barrie", get=fake_get, min_interval=0)
        self.assertEqual(sum("photon" in url for url in calls), 1)
        self.assertEqual(sum("nominatim" in url for url in calls), 1)
        self.assertEqual(out["provider"], "nominatim")
        self.assertEqual(out["suggestions"][0]["label"], "Barrie")


class ReverseTests(unittest.TestCase):
    def setUp(self):
        clear_cache()

    def test_photon_reverse_keeps_requested_point(self):
        def fake_get(url, params=None, headers=None, timeout=None):
            self.assertIn("reverse", url)
            self.assertEqual(timeout, 4)
            return _Json(200, {"features": [{
                "geometry": {"coordinates": [-79.38, 43.65]},
                "properties": {
                    "osm_id": 7,
                    "osm_type": "W",
                    "name": "Bay Street",
                    "city": "Toronto",
                    "state": "Ontario",
                    "country": "Canada",
                    "countrycode": "CA",
                },
            }]})

        out = reverse_place(43.6512, -79.3841, get=fake_get, min_interval=0)
        self.assertEqual(out["label"], "Bay Street, Toronto")
        self.assertAlmostEqual(out["lat"], 43.6512)
        self.assertAlmostEqual(out["lon"], -79.3841)


class SuggestRouteTests(unittest.TestCase):
    def test_api_rejects_short_query_without_geocoding(self):
        from api_server import APP
        resp = APP.test_client().get("/api/suggest?q=on")
        self.assertEqual(resp.status_code, 200)
        body = resp.get_json()
        self.assertEqual(body["suggestions"], [])
        self.assertIn(body["provider"], {"photon", "nominatim", "google", "mapbox"})

    def test_reverse_requires_coordinates(self):
        from api_server import APP
        resp = APP.test_client().get("/api/reverse")
        self.assertEqual(resp.status_code, 400)


class _Json:
    def __init__(self, status_code, payload):
        self.status_code = status_code
        self._payload = payload

    def json(self):
        return self._payload


if __name__ == "__main__":
    unittest.main()
