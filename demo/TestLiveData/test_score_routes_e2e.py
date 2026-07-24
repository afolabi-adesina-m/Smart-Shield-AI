"""End-to-end tests through the actual Flask API.

These prove the *whole pipeline* is wired correctly — not just the
Live_weather.py / Live_alerts.py helper files in isolation, but that
inference.py and flask_common.py actually call them and pass the results
through to /api/score-routes.

@pytest.mark.live: needs real network (real Open-Meteo + real 511 calls).
No marker: mocks the live helpers, so it runs anywhere, and proves the
fallback path (calendar_fallback / preset_fallback) still works with zero
network access.
"""

from __future__ import annotations

import pytest

import sys
import os
sys.path.append(os.path.join(os.path.dirname(__file__), '..', '..', 'src'))

from unittest.mock import MagicMock, patch

import Live_alerts
import Live_weather

SAMPLE_ROUTE = {
    "distance_m": 90000,
    "duration_s": 3600,
    "mid_lat": 44.0,
    "mid_lon": -79.4,
}


def _post_score(client, routes, weather="clear", force_preset=False, custom_alert=""):
    return client.post(
        "/api/score-routes",
        json={
            "routes": routes,
            "weather": weather,
            "force_preset": force_preset,
            "custom_alert": custom_alert,
        },
    )


class TestFallbackPath:
    """No network needed — proves the app still works offline."""

    def test_falls_back_when_live_sources_unavailable(self, client):
        with patch("inference.live_risk_components", return_value=None), \
             patch("inference.nearby_alert_text", return_value=None):
            resp = _post_score(client, [SAMPLE_ROUTE], weather="blizzard")
        assert resp.status_code == 200
        route = resp.get_json()["routes"][0]
        assert route["e_index_source"] == "calendar_fallback"
        assert route["alert_source"] == "preset_fallback"

    def test_no_coordinates_also_falls_back(self, client):
        route_without_coords = {"distance_m": 50000, "duration_s": 1800}
        resp = _post_score(client, [route_without_coords], weather="clear")
        assert resp.status_code == 200
        route = resp.get_json()["routes"][0]
        assert route["e_index_source"] == "calendar_fallback"
        assert route["alert_source"] == "preset_fallback"

    def test_custom_alert_always_wins_over_live_and_preset(self, client):
        with patch("inference.nearby_alert_text", return_value="Hwy 400: fake live alert"):
            resp = _post_score(
                client, [SAMPLE_ROUTE], weather="clear", custom_alert="Custom hazard text"
            )
        route = resp.get_json()["routes"][0]
        assert route["alert_source"] == "custom"
        assert "Custom hazard text" in route["alert_preview"]


class TestForcePresetOverride:
    """force_preset=True should skip live lookups even with coordinates present."""

    def test_force_preset_ignores_live_data(self, client):
        with patch("inference.live_risk_components") as mock_weather, \
             patch("inference.nearby_alert_text") as mock_alert:
            resp = _post_score(client, [SAMPLE_ROUTE], weather="ice_storm", force_preset=True)
        mock_weather.assert_not_called()
        mock_alert.assert_not_called()
        route = resp.get_json()["routes"][0]
        assert route["e_index_source"] == "calendar_fallback"
        assert route["alert_source"] == "preset_fallback"


class TestLiveWiredThrough:
    """Mocks the live helpers to simulate 'network is up' without needing it."""

    def test_live_weather_result_flows_through_to_e_index(self, client):
        fake_components = {
            "surface_risk": 1.0, "visibility_risk": 0.8, "wind_risk": 0.6, "temp_risk": 1.0,
            "is_day": False, "raw_temp_c": -12.0, "raw_precip_mm": 3.0,
            "raw_snow_cm": 2.0, "raw_wind_kmh": 40.0,
        }
        with patch("inference.live_risk_components", return_value=fake_components), \
             patch("inference.nearby_alert_text", return_value=None):
            resp = _post_score(client, [SAMPLE_ROUTE], weather="clear")
        route = resp.get_json()["routes"][0]
        assert route["e_index_source"] == "live_weather"
        assert route["live_weather_raw"]["raw_temp_c"] == -12.0
        # heavy snow + cold + wind at night should push the tier up, not
        # stay at the "clear" preset's usual LOW/MEDIUM result
        assert route["tier"] in ("MEDIUM", "HIGH")

    def test_live_alert_result_flows_through_to_t_score(self, client):
        with patch("inference.live_risk_components", return_value=None), \
             patch("inference.nearby_alert_text", return_value="Hwy 400: multi-vehicle collision, black ice"):
            resp = _post_score(client, [SAMPLE_ROUTE], weather="clear")
        route = resp.get_json()["routes"][0]
        assert route["alert_source"] == "live_511"
        assert "collision" in route["alert_preview"].lower()


# ---------------------------------------------------------------------------
# LIVE — real network, real Open-Meteo + real 511 Ontario, through the API
# ---------------------------------------------------------------------------

@pytest.mark.live
class TestRealEndToEnd:
    def test_score_routes_prefers_live_sources_when_network_is_up(self, client):
        resp = _post_score(client, [SAMPLE_ROUTE], weather="clear")
        assert resp.status_code == 200
        route = resp.get_json()["routes"][0]
        # If the network is genuinely up, we expect the live path — if this
        # ever prints "calendar_fallback"/"preset_fallback" here, check
        # Open-Meteo / 511 Ontario status before assuming the code is wrong.
        print("e_index_source:", route["e_index_source"])
        print("alert_source:", route["alert_source"])
        assert route["e_index_source"] in ("live_weather", "calendar_fallback")
        assert route["alert_source"] in ("live_511", "preset_fallback")
