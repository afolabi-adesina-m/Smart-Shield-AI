"""Tests for Live_weather.py (Fix 3).

Two kinds of test live in this file:

- UNIT tests (no marker): mock `requests.get`, run instantly, no network
  needed. These check *our* logic — caching, fallback-on-failure, risk-score
  math — is correct regardless of what Open-Meteo actually returns today.

- LIVE tests (`@pytest.mark.live`): hit the real Open-Meteo API. These are
  the only tests that can actually prove "this is real-time data, not a
  stub." They need network access and are skipped by default in CI.

Run just the unit tests:     pytest tests/test_live_weather.py -m "not live"
Run just the live tests:     pytest tests/test_live_weather.py -m live
"""

from __future__ import annotations

from datetime import datetime, timedelta
from unittest.mock import MagicMock, patch

import sys
import os
sys.path.append(os.path.join(os.path.dirname(__file__), '..', '..', 'src'))

from unittest.mock import MagicMock, patch
import pytest

import Live_weather


TORONTO = (43.6532, -79.3832)


def _fake_response(temp_c=5.0, precip_mm=0.0, snow_cm=0.0, wind_kmh=10.0, is_day=1, when=None):
    """Build a fake Open-Meteo JSON payload shaped like the real one."""
    when = when or datetime.now().strftime("%Y-%m-%dT%H:00")
    resp = MagicMock()
    resp.raise_for_status = lambda: None
    resp.json.return_value = {
        "current": {
            "time": when,
            "temperature_2m": temp_c,
            "precipitation": precip_mm,
            "snowfall": snow_cm,
            "wind_speed_10m": wind_kmh,
            "is_day": is_day,
        },
        "hourly": {
            "time": [when],
            "visibility": [10000.0],
        },
    }
    return resp


# ---------------------------------------------------------------------------
# UNIT TESTS — no network required
# ---------------------------------------------------------------------------

class TestCaching:
    def test_reuses_cache_within_ttl(self):
        """Two calls for the same spot, back to back, should only hit the API once."""
        with patch("Live_weather.requests.get", return_value=_fake_response()) as mock_get:
            Live_weather.fetch_current_weather(*TORONTO)
            Live_weather.fetch_current_weather(*TORONTO)
        assert mock_get.call_count == 1

    def test_refetches_after_ttl_expires(self):
        with patch("Live_weather.requests.get", return_value=_fake_response()) as mock_get:
            Live_weather.fetch_current_weather(*TORONTO)
            # simulate the cache entry being older than CACHE_TTL_S
            key = (round(TORONTO[0], 2), round(TORONTO[1], 2))
            old_ts, data = Live_weather._cache[key]
            Live_weather._cache[key] = (old_ts - Live_weather.CACHE_TTL_S - 1, data)
            Live_weather.fetch_current_weather(*TORONTO)
        assert mock_get.call_count == 2

    def test_rounds_nearby_coords_to_same_cache_key(self):
        """~1km apart should share one cached call, per _round_coord()'s intent."""
        with patch("Live_weather.requests.get", return_value=_fake_response()) as mock_get:
            Live_weather.fetch_current_weather(43.65321, -79.38322)
            Live_weather.fetch_current_weather(43.65319, -79.38318)
        assert mock_get.call_count == 1


class TestFallbackSafety:
    """The whole point of this module: never raise, never fake data."""

    def test_returns_none_on_connection_error(self):
        with patch("Live_weather.requests.get", side_effect=ConnectionError("offline")):
            result = Live_weather.fetch_current_weather(*TORONTO)
        assert result is None

    def test_returns_none_on_timeout(self):
        import requests as real_requests
        with patch("Live_weather.requests.get", side_effect=real_requests.Timeout("slow")):
            result = Live_weather.fetch_current_weather(*TORONTO)
        assert result is None

    def test_returns_none_on_bad_status(self):
        resp = MagicMock()
        resp.raise_for_status.side_effect = Exception("500 server error")
        with patch("Live_weather.requests.get", return_value=resp):
            result = Live_weather.fetch_current_weather(*TORONTO)
        assert result is None

    def test_live_risk_components_returns_none_when_fetch_fails(self):
        with patch("Live_weather.fetch_current_weather", return_value=None):
            result = Live_weather.live_risk_components(*TORONTO)
        assert result is None

    def test_live_risk_components_returns_none_on_malformed_payload(self):
        with patch("Live_weather.fetch_current_weather", return_value={"unexpected": "shape"}):
            result = Live_weather.live_risk_components(*TORONTO)
        assert result is None


class TestRiskScoring:
    """Sanity-check the weather -> risk-number conversion logic itself."""

    def test_snow_means_high_surface_risk(self):
        fake = _fake_response(temp_c=-2.0, precip_mm=0.0, snow_cm=3.0)
        with patch("Live_weather.requests.get", return_value=fake):
            result = Live_weather.live_risk_components(*TORONTO)
        assert result is not None
        assert result["surface_risk"] == 1.0

    def test_clear_dry_day_means_low_risk(self):
        fake = _fake_response(temp_c=20.0, precip_mm=0.0, snow_cm=0.0, wind_kmh=5.0, is_day=1)
        with patch("Live_weather.requests.get", return_value=fake):
            result = Live_weather.live_risk_components(*TORONTO)
        assert result is not None
        assert result["surface_risk"] < 0.3
        assert result["temp_risk"] < 0.3

    def test_high_wind_scales_toward_one(self):
        fake = _fake_response(wind_kmh=60.0)
        with patch("Live_weather.requests.get", return_value=fake):
            result = Live_weather.live_risk_components(*TORONTO)
        assert result["wind_risk"] == pytest.approx(1.0)

    def test_extreme_cold_means_max_temp_risk(self):
        fake = _fake_response(temp_c=-15.0)
        with patch("Live_weather.requests.get", return_value=fake):
            result = Live_weather.live_risk_components(*TORONTO)
        assert result["temp_risk"] == 1.0

    def test_night_flag_is_read_from_is_day(self):
        fake = _fake_response(is_day=0)
        with patch("Live_weather.requests.get", return_value=fake):
            result = Live_weather.live_risk_components(*TORONTO)
        assert result["is_day"] is False


# ---------------------------------------------------------------------------
# LIVE TESTS — real network, real Open-Meteo API
# ---------------------------------------------------------------------------

@pytest.mark.live
class TestRealOpenMeteo:
    def test_returns_data_for_a_real_city(self):
        data = Live_weather.fetch_current_weather(*TORONTO)
        assert data is not None, "no data back — check network / API status"
        assert "current" in data

    def test_timestamp_is_actually_recent(self):
        data = Live_weather.fetch_current_weather(*TORONTO)
        assert data is not None
        reported = datetime.fromisoformat(data["current"]["time"])
        now = datetime.now()
        assert abs((now - reported).total_seconds()) < 2 * 3600, (
            "weather timestamp is more than 2 hours from now — looks stale"
        )

    def test_different_cities_return_different_temperatures(self):
        toronto = Live_weather.fetch_current_weather(43.65, -79.38)
        inuvik = Live_weather.fetch_current_weather(68.35, -133.72)  # Canadian Arctic
        assert toronto is not None and inuvik is not None
        t1 = toronto["current"]["temperature_2m"]
        t2 = inuvik["current"]["temperature_2m"]
        assert t1 != t2, "identical temps in Toronto and the Arctic — suspicious"

    def test_live_risk_components_end_to_end(self):
        result = Live_weather.live_risk_components(*TORONTO)
        assert result is not None
        for key in ("surface_risk", "visibility_risk", "wind_risk", "temp_risk"):
            assert 0.0 <= result[key] <= 1.0
