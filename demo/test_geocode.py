"""Place geocoder: cache, Photon fallback, and coordinate passthrough. No live calls."""

from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "demo"))

from geocode_suggest import GEOCODE_HEADERS, clear_cache  # noqa: E402
from place_geocode import (  # noqa: E402
    FRIENDLY_BUSY,
    FRIENDLY_UNAVAILABLE,
    GeocodeLookupError,
    geocode_place,
    reset_geocode_cache,
)


class _Response:
    def __init__(self, status_code, payload, headers=None):
        self.status_code = status_code
        self._payload = payload
        self.headers = headers or {}

    def json(self):
        return self._payload


def _photon(lon, lat, name="Kingston"):
    return {
        "features": [{
            "geometry": {"coordinates": [lon, lat]},
            "properties": {
                "name": name,
                "state": "Ontario",
                "country": "Canada",
            },
        }]
    }


class PlaceGeocodeTests(unittest.TestCase):
    def setUp(self):
        clear_cache()
        reset_geocode_cache()

    def test_cache_hit_skips_second_request(self):
        calls = []

        def fake_get(url, params=None, headers=None, timeout=None):
            calls.append(url)
            self.assertEqual(headers["User-Agent"], GEOCODE_HEADERS["User-Agent"])
            self.assertEqual(headers["Referer"], GEOCODE_HEADERS["Referer"])
            return _Response(200, [{
                "lat": "44.389",
                "lon": "-79.690",
                "display_name": "Barrie, Ontario",
            }])

        first = geocode_place("Barrie, Ontario", get=fake_get, min_interval=0, use_disk=False)
        second = geocode_place("  barrie,   ontario ", get=fake_get, min_interval=0, use_disk=False)
        self.assertEqual(len(calls), 1)
        self.assertAlmostEqual(first["lat"], 44.389)
        self.assertEqual(second["lat"], first["lat"])
        self.assertEqual(second["lon"], first["lon"])

    def test_seeded_toronto_never_calls_network(self):
        def explode(*_args, **_kwargs):
            raise AssertionError("seeded places must not call a geocoder")

        for query in (
            "Toronto, Ontario",
            "mississauga",
            "Brampton, ON",
            "Oakville, Ontario, Canada",
            "hamilton ontario",
        ):
            hit = geocode_place(query, get=explode, min_interval=0, use_disk=False)
            self.assertEqual(hit["source"], "seed")
            self.assertGreater(hit["lat"], 43)
            self.assertLess(hit["lon"], -79)

    def test_429_retries_once_then_photon(self):
        seen = []
        slept = []

        def fake_get(url, params=None, headers=None, timeout=None):
            seen.append((url, params, headers))
            if "nominatim" in url:
                return _Response(429, [], {"Retry-After": "0.25"})
            self.assertEqual(params["limit"], 1)
            self.assertIn("Kingston", params["q"])
            return _Response(200, _photon(-76.48, 44.231, "Kingston"))

        hit = geocode_place(
            "Kingston, Ontario",
            get=fake_get,
            sleep=slept.append,
            min_interval=0,
            use_disk=False,
        )
        nominatim_calls = [item for item in seen if "nominatim" in item[0]]
        photon_calls = [item for item in seen if "photon" in item[0]]
        self.assertEqual(len(nominatim_calls), 2)
        self.assertEqual(len(photon_calls), 1)
        self.assertEqual(slept, [0.25])
        self.assertEqual(nominatim_calls[0][2]["User-Agent"], GEOCODE_HEADERS["User-Agent"])
        self.assertIn("github.com/afolabi-adesina-m/Smart-Shield-AI", nominatim_calls[0][2]["Referer"])
        self.assertAlmostEqual(hit["lat"], 44.231)
        self.assertAlmostEqual(hit["lon"], -76.48)
        self.assertEqual(hit["source"], "photon")
        self.assertIn("Kingston", hit["display_name"])

    def test_retry_after_is_capped(self):
        slept = []

        def fake_get(url, params=None, headers=None, timeout=None):
            if "nominatim" in url:
                return _Response(429, [], {"Retry-After": "30"})
            return _Response(200, _photon(-79.69, 44.389, "Barrie"))

        geocode_place(
            "Barrie Ontario",
            get=fake_get,
            sleep=slept.append,
            min_interval=0,
            use_disk=False,
        )
        self.assertEqual(slept, [2.0])

    def test_lat_lon_passthrough_skips_network(self):
        def explode(*_args, **_kwargs):
            raise AssertionError("coordinates must not be geocoded")

        hit = geocode_place("43.65, -79.38", get=explode, min_interval=0, use_disk=False)
        self.assertEqual(hit["lat"], 43.65)
        self.assertEqual(hit["lon"], -79.38)
        self.assertEqual(hit["source"], "coordinates")
        compact = geocode_place("43.65,-79.38", get=explode, min_interval=0, use_disk=False)
        self.assertEqual(compact["lat"], 43.65)
        self.assertEqual(compact["lon"], -79.38)

    def test_all_failures_hide_raw_exception(self):
        def explode(url, params=None, headers=None, timeout=None):
            raise RuntimeError(
                "429 Client Error: Too many requests for url: "
                "https://nominatim.openstreetmap.org/search?q=Kingston"
            )

        with self.assertRaises(GeocodeLookupError) as caught:
            geocode_place(
                "Kingston, Ontario",
                get=explode,
                sleep=lambda _seconds: None,
                min_interval=0,
                use_disk=False,
            )
        message = str(caught.exception)
        self.assertEqual(message, FRIENDLY_UNAVAILABLE)
        self.assertNotIn("nominatim", message.lower())
        self.assertNotIn("Client Error", message)
        self.assertNotIn("429", message)

    def test_rate_limit_on_both_services_is_friendly(self):
        def fake_get(url, params=None, headers=None, timeout=None):
            return _Response(429, {"error": "Too many requests for url: https://nominatim.openstreetmap.org"}, {})

        with self.assertRaises(GeocodeLookupError) as caught:
            geocode_place(
                "Kingston, Ontario",
                get=fake_get,
                sleep=lambda _seconds: None,
                min_interval=0,
                use_disk=False,
            )
        self.assertEqual(caught.exception.status, 429)
        self.assertEqual(str(caught.exception), FRIENDLY_BUSY)
        self.assertNotIn("http", str(caught.exception).lower())

    def test_disk_cache_serves_a_later_lookup(self):
        def fake_get(url, params=None, headers=None, timeout=None):
            return _Response(200, [{
                "lat": "44.231",
                "lon": "-76.486",
                "display_name": "Kingston, Ontario",
            }])

        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "geocode.json"
            geocode_place("Kingston, Ontario", get=fake_get, min_interval=0, use_disk=True, cache_path=path)
            self.assertTrue(path.is_file())
            reset_geocode_cache()

            def explode(*_args, **_kwargs):
                raise AssertionError("disk cache should answer")

            hit = geocode_place(
                "kingston, ontario",
                get=explode,
                min_interval=0,
                use_disk=True,
                cache_path=path,
            )
            self.assertAlmostEqual(hit["lat"], 44.231)
            self.assertEqual(hit["source"], "cache")


class GeocodeRouteTests(unittest.TestCase):
    def test_api_returns_seeded_toronto_without_nominatim(self):
        from api_server import APP

        def explode(*_args, **_kwargs):
            raise AssertionError("route seed must not call Nominatim")

        with patch("place_geocode.requests.get", explode):
            resp = APP.test_client().get("/api/geocode", query_string={"q": "Toronto, Ontario"})
        self.assertEqual(resp.status_code, 200)
        body = resp.get_json()
        self.assertAlmostEqual(body["lat"], 43.6532)
        self.assertAlmostEqual(body["lon"], -79.3832)
        self.assertNotIn("error", body)

    def test_api_error_is_friendly(self):
        from api_server import APP

        def explode(*_args, **_kwargs):
            raise RuntimeError(
                "429 Client Error: Too many requests for url: https://nominatim.openstreetmap.org/search"
            )

        with patch("place_geocode.requests.get", explode), \
                patch("place_geocode.reserve_upstream_slot", lambda *_a, **_k: None), \
                patch("place_geocode.time.sleep", lambda *_a, **_k: None):
            resp = APP.test_client().get("/api/geocode", query_string={"q": "43.70, -79.40"})
        # Coordinates never reach the patched getter.
        self.assertEqual(resp.status_code, 200)
        self.assertAlmostEqual(resp.get_json()["lat"], 43.70)

        with patch("place_geocode.requests.get", explode), \
                patch("place_geocode.reserve_upstream_slot", lambda *_a, **_k: None), \
                patch("place_geocode.time.sleep", lambda *_a, **_k: None):
            resp = APP.test_client().get("/api/geocode", query_string={"q": "Kingston, Ontario"})
        self.assertEqual(resp.status_code, 502)
        text = resp.get_json()["error"]
        self.assertEqual(text, FRIENDLY_UNAVAILABLE)
        self.assertNotIn("nominatim", text.lower())
        self.assertNotIn("Client Error", text)


if __name__ == "__main__":
    unittest.main()
