"""Live Ontario 511 traffic alert lookup (Fix 2) — replaces the fixed
WEATHER_PRESETS / SCENARIO_ALERTS text in nlp_brain.py with real events
near the route.

Uses the public Ontario 511 Events API (no key required):
    https://511on.ca/api/v2/get/event
Docs: https://511on.ca/developers/doc

Falls back to None on any failure (no network, bad response, timeout, or
nothing nearby). Callers MUST handle None by falling back to the existing
WEATHER_PRESETS text — this module never raises.
"""

from __future__ import annotations

import math
import time
from typing import List, Optional, Tuple

import requests

EVENTS_URL = "https://511on.ca/api/v2/get/event"
REQUEST_TIMEOUT_S = 6
CACHE_TTL_S = 180  # 3 minutes — traffic events change faster than weather
NEARBY_RADIUS_KM = 15.0
MAX_EVENTS_IN_TEXT = 5

# in-memory cache: (fetched_at, full_event_list)
_cache: Tuple[float, Optional[List[dict]]] = (0.0, None)


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def fetch_all_events() -> Optional[List[dict]]:
    """Fetch and cache the full Ontario 511 event feed (all regions)."""
    global _cache
    now = time.time()
    ts, cached = _cache
    if cached is not None and now - ts < CACHE_TTL_S:
        return cached

    try:
        resp = requests.get(
            EVENTS_URL,
            params={"format": "json", "lang": "en"},
            timeout=REQUEST_TIMEOUT_S,
        )
        resp.raise_for_status()
        events = resp.json()
        if not isinstance(events, list):
            return None
    except Exception:
        return None

    _cache = (now, events)
    return events


def nearby_events(lat: float, lon: float, radius_km: float = NEARBY_RADIUS_KM) -> List[dict]:
    """Return real 511 events within radius_km of (lat, lon), closest first."""
    events = fetch_all_events()
    if not events:
        return []

    scored: List[Tuple[float, dict]] = []
    for ev in events:
        ev_lat, ev_lon = ev.get("Latitude"), ev.get("Longitude")
        if ev_lat is None or ev_lon is None:
            continue
        dist = _haversine_km(lat, lon, ev_lat, ev_lon)
        if dist <= radius_km:
            scored.append((dist, ev))

    scored.sort(key=lambda x: x[0])
    return [ev for _, ev in scored]


def nearby_alert_text(lat: float, lon: float, radius_km: float = NEARBY_RADIUS_KM) -> Optional[str]:
    """
    Build one alert-style string from real nearby 511 events, in the same
    'roadway + description' shape nlp_brain.t_score_from_text() already
    expects. Returns None if the feed is unreachable or nothing is nearby
    (caller should fall back to WEATHER_PRESETS in that case).
    """
    events = nearby_events(lat, lon, radius_km)
    if not events:
        return None

    parts = []
    for ev in events[:MAX_EVENTS_IN_TEXT]:
        roadway = (ev.get("RoadwayName") or "").strip()
        desc = (ev.get("Description") or "").strip()
        if not desc:
            continue
        parts.append(f"{roadway}: {desc}" if roadway else desc)

    return " | ".join(parts) if parts else None