"""Tests for Live_alerts.py (Fix 2).

Same split as test_live_weather.py:
  - unit tests mock requests.get and run offline
  - @pytest.mark.live tests hit the real 511 Ontario feed

Run just the unit tests:  pytest tests/test_live_alerts.py -m "not live"
Run just the live tests:  pytest tests/test_live_alerts.py -m live
"""

from __future__ import annotations

import sys
import os
sys.path.append(os.path.join(os.path.dirname(__file__), '..', '..', 'src'))

from unittest.mock import MagicMock, patch
import pytest

import Live_alerts


TORONTO = (43.6532, -79.3832)
BARRIE = (44.3894, -79.6903)


def _fake_events(events):
    resp = MagicMock()
    resp.raise_for_status = lambda: None
    resp.json.return_value = events
    return resp


def _event(lat, lon, roadway="Hwy 400", desc="Multi-vehicle collision"):
    return {"Latitude": lat, "Longitude": lon, "RoadwayName": roadway, "Description": desc}


# ---------------------------------------------------------------------------
# UNIT TESTS — no network required
# ---------------------------------------------------------------------------

class TestFallbackSafety:
    def test_returns_none_on_connection_error(self):
        with patch("Live_alerts.requests.get", side_effect=ConnectionError("offline")):
            events = Live_alerts.fetch_all_events()
        assert events is None

    def test_returns_none_on_non_list_payload(self):
        resp = MagicMock()
        resp.raise_for_status = lambda: None
        resp.json.return_value = {"not": "a list"}
        with patch("Live_alerts.requests.get", return_value=resp):
            events = Live_alerts.fetch_all_events()
        assert events is None

    def test_nearby_alert_text_is_none_when_feed_unreachable(self):
        with patch("Live_alerts.fetch_all_events", return_value=None):
            text = Live_alerts.nearby_alert_text(*TORONTO)
        assert text is None

    def test_nearby_alert_text_is_none_when_nothing_nearby(self):
        far_away_event = [_event(51.0, -114.0)]  # Calgary, nowhere near Toronto/Barrie
        with patch("Live_alerts.fetch_all_events", return_value=far_away_event):
            text = Live_alerts.nearby_alert_text(*TORONTO, radius_km=15)
        assert text is None


class TestDistanceFiltering:
    def test_nearby_events_excludes_far_events(self):
        events = [_event(*TORONTO), _event(51.0, -114.0)]
        with patch("Live_alerts.fetch_all_events", return_value=events):
            nearby = Live_alerts.nearby_events(*TORONTO, radius_km=15)
        assert len(nearby) == 1

    def test_nearby_events_sorted_closest_first(self):
        near = _event(TORONTO[0] + 0.01, TORONTO[1] + 0.01, desc="Close crash")
        mid = _event(TORONTO[0] + 0.05, TORONTO[1] + 0.05, desc="Mid crash")
        events = [mid, near]
        with patch("Live_alerts.fetch_all_events", return_value=events):
            nearby = Live_alerts.nearby_events(*TORONTO, radius_km=15)
        assert nearby[0]["Description"] == "Close crash"

    def test_events_missing_coords_are_skipped(self):
        bad = {"RoadwayName": "Hwy 7", "Description": "no coords given"}
        good = _event(*TORONTO)
        with patch("Live_alerts.fetch_all_events", return_value=[bad, good]):
            nearby = Live_alerts.nearby_events(*TORONTO, radius_km=15)
        assert len(nearby) == 1


class TestAlertTextShape:
    def test_combines_roadway_and_description(self):
        events = [_event(*TORONTO, roadway="Hwy 400", desc="Black ice reported")]
        with patch("Live_alerts.fetch_all_events", return_value=events):
            text = Live_alerts.nearby_alert_text(*TORONTO)
        assert text == "Hwy 400: Black ice reported"

    def test_caps_at_max_events_in_text(self):
        many = [_event(*TORONTO, desc=f"Incident {i}") for i in range(10)]
        with patch("Live_alerts.fetch_all_events", return_value=many):
            text = Live_alerts.nearby_alert_text(*TORONTO)
        assert text.count("Incident") == Live_alerts.MAX_EVENTS_IN_TEXT


# ---------------------------------------------------------------------------
# LIVE TESTS — real network, real 511 Ontario feed
# ---------------------------------------------------------------------------

@pytest.mark.live
class TestRealFeed:
    def test_feed_is_reachable_and_nonempty(self):
        events = Live_alerts.fetch_all_events()
        assert events is not None, "no data back — check network / 511 API status"
        assert isinstance(events, list)
        # Ontario's highway network almost always has *something* active.
        assert len(events) > 0

    def test_events_have_expected_shape(self):
        events = Live_alerts.fetch_all_events()
        assert events
        sample = events[0]
        assert "Latitude" in sample and "Longitude" in sample

    def test_nearby_events_near_a_busy_corridor(self):
        # 401 through Toronto is one of the busiest highways in North
        # America — there's almost always at least one nearby event.
        nearby = Live_alerts.nearby_events(43.65, -79.4, radius_km=25)
        assert isinstance(nearby, list)  # can legitimately be empty on a quiet day
