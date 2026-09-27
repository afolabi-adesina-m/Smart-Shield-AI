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


class SuggestRouteTests(unittest.TestCase):
    def test_api_rejects_short_query_without_geocoding(self):
        from api_server import APP
        resp = APP.test_client().get("/api/suggest?q=on")
        self.assertEqual(resp.status_code, 200)
        body = resp.get_json()
        self.assertEqual(body["suggestions"], [])
        self.assertIn(body["provider"], {"photon", "nominatim", "google", "mapbox"})


class _Json:
    def __init__(self, status_code, payload):
        self.status_code = status_code
        self._payload = payload

    def json(self):
        return self._payload


if __name__ == "__main__":
    unittest.main()
