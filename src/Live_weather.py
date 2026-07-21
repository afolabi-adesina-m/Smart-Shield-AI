"""Live weather lookup (Fix 3) — replaces the calendar-based E_index guess
in safety_score.e_index_from_features() with real conditions.

Uses Open-Meteo (https://open-meteo.com) — free, no API key required.

Falls back to None on any failure (no network, bad response, timeout).
Callers MUST handle None by falling back to the existing calendar-based
estimate — this module never raises, so a live-data outage cannot crash
the demo.
"""

from __future__ import annotations

import time
from typing import Dict, Optional, Tuple

import requests

OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"
REQUEST_TIMEOUT_S = 5
CACHE_TTL_S = 600  # 10 minutes — weather doesn't need per-second freshness

# in-memory cache: {(lat_rounded, lon_rounded): (fetched_at, raw_json)}
_cache: Dict[Tuple[float, float], Tuple[float, dict]] = {}


def _round_coord(v: float) -> float:
    """Round to ~1km so nearby route points reuse one cached API call."""
    return round(v, 2)


def fetch_current_weather(lat: float, lon: float) -> Optional[dict]:
    """Return the raw Open-Meteo response, or None on any failure."""
    key = (_round_coord(lat), _round_coord(lon))
    now = time.time()

    cached = _cache.get(key)
    if cached and now - cached[0] < CACHE_TTL_S:
        return cached[1]

    try:
        resp = requests.get(
            OPEN_METEO_URL,
            params={
                "latitude": lat,
                "longitude": lon,
                "current": "temperature_2m,precipitation,snowfall,wind_speed_10m,is_day",
                "hourly": "visibility",
                "timezone": "America/Toronto",
                "forecast_days": 1,
            },
            timeout=REQUEST_TIMEOUT_S,
        )
        resp.raise_for_status()
        data = resp.json()
    except Exception:
        # No network, API down, bad coords, timeout — all treated the same:
        # the caller falls back to the calendar-based estimate.
        return None

    _cache[key] = (now, data)
    return data


def _visibility_at_current_hour(data: dict) -> Optional[float]:
    """Match the hourly visibility array to the current hour (metres)."""
    try:
        current_time = data["current"]["time"]  # e.g. "2026-07-13T14:00"
        hourly_times = data["hourly"]["time"]
        hourly_vis = data["hourly"]["visibility"]
        idx = hourly_times.index(current_time)
        return float(hourly_vis[idx])
    except (KeyError, ValueError, IndexError):
        return None


def live_risk_components(lat: float, lon: float) -> Optional[Dict[str, float]]:
    """
    Convert live weather into the same 4 risk components that
    safety_score.compute_e_index() already expects, each scaled to [0, 1].

    Returns None if the live fetch failed — caller should fall back to
    safety_score.e_index_from_features() in that case.
    """
    data = fetch_current_weather(lat, lon)
    if not data or "current" not in data:
        return None

    cur = data["current"]
    temp_c = cur.get("temperature_2m")
    precip_mm = cur.get("precipitation") or 0.0
    snow_cm = cur.get("snowfall") or 0.0
    wind_kmh = cur.get("wind_speed_10m") or 0.0
    is_day = cur.get("is_day", 1)

    if temp_c is None:
        return None

    # Surface risk: active snowfall, or rain at/near freezing (freezing rain)
    if snow_cm > 0 or (temp_c <= 1.0 and precip_mm > 0):
        surface_risk = 1.0
    elif precip_mm > 0:
        surface_risk = 0.5
    else:
        surface_risk = 0.15

    # Visibility risk: from real hourly visibility (metres) when available;
    # otherwise fall back to a precipitation + day/night estimate.
    vis_m = _visibility_at_current_hour(data)
    if vis_m is not None:
        visibility_risk = max(0.0, min(1.0, 1.0 - (vis_m / 10000.0)))
    else:
        if precip_mm > 0 and not is_day:
            visibility_risk = 0.6
        elif precip_mm > 0:
            visibility_risk = 0.3
        elif not is_day:
            visibility_risk = 0.2
        else:
            visibility_risk = 0.1

    # Wind risk: scaled against ~60 km/h as a rough high-wind-advisory ceiling
    wind_risk = max(0.0, min(1.0, wind_kmh / 60.0))

    # Temp risk: freezing / sub-freezing raises risk
    if temp_c <= -10:
        temp_risk = 1.0
    elif temp_c <= 2:
        temp_risk = 0.7
    elif temp_c <= 8:
        temp_risk = 0.3
    else:
        temp_risk = 0.1

    return {
        "surface_risk": surface_risk,
        "visibility_risk": visibility_risk,
        "wind_risk": wind_risk,
        "temp_risk": temp_risk,
        "is_day": bool(is_day),
        "raw_temp_c": temp_c,
        "raw_precip_mm": precip_mm,
        "raw_snow_cm": snow_cm,
        "raw_wind_kmh": wind_kmh,
    }