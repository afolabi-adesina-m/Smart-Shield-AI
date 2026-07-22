"""Live road-condition inference from Open-Meteo (free, no API key)."""

from __future__ import annotations

from typing import Any, Dict, Optional, Tuple

import requests

OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"
USER_AGENT = "SmartShieldCapstone/1.0 (Sheridan PAIDA academic demo)"

# WMO weather interpretation codes → demo presets
_CODE_TO_PRESET = {
    0: "clear",
    1: "clear",
    2: "clear",
    3: "clear",
    45: "wet",
    48: "wet",
    51: "wet",
    53: "wet",
    55: "wet",
    56: "ice_storm",
    57: "ice_storm",
    61: "wet",
    63: "wet",
    65: "wet",
    66: "ice_storm",
    67: "ice_storm",
    71: "blizzard",
    73: "blizzard",
    75: "blizzard",
    77: "blizzard",
    80: "wet",
    81: "wet",
    82: "wet",
    85: "blizzard",
    86: "blizzard",
    95: "wet",
    96: "wet",
    99: "wet",
}

_CODE_LABEL = {
    0: "Clear sky",
    1: "Mainly clear",
    2: "Partly cloudy",
    3: "Overcast",
    45: "Fog",
    48: "Depositing rime fog",
    51: "Light drizzle",
    53: "Moderate drizzle",
    55: "Dense drizzle",
    56: "Light freezing drizzle",
    57: "Dense freezing drizzle",
    61: "Slight rain",
    63: "Moderate rain",
    65: "Heavy rain",
    66: "Light freezing rain",
    67: "Heavy freezing rain",
    71: "Slight snow",
    73: "Moderate snow",
    75: "Heavy snow",
    77: "Snow grains",
    80: "Slight rain showers",
    81: "Moderate rain showers",
    82: "Violent rain showers",
    85: "Slight snow showers",
    86: "Heavy snow showers",
    95: "Thunderstorm",
    96: "Thunderstorm with slight hail",
    99: "Thunderstorm with heavy hail",
}


def _clip01(x: float) -> float:
    return max(0.0, min(1.0, float(x)))


def map_weather_to_preset(
    weather_code: int,
    temperature_c: float,
    precipitation_mm: float,
    snowfall_cm: float,
) -> str:
    """Map Open-Meteo signals → clear | wet | blizzard | ice_storm."""
    preset = _CODE_TO_PRESET.get(int(weather_code), "clear")
    # Near-freezing precip → ice risk even if code says rain
    if temperature_c <= 0.5 and (precipitation_mm > 0.1 or snowfall_cm > 0.0):
        if snowfall_cm >= 0.5 or preset == "blizzard":
            return "blizzard"
        return "ice_storm"
    if snowfall_cm >= 1.0:
        return "blizzard"
    return preset


def build_alert_text(preset: str, label: str, temperature_c: float, wind_kmh: float) -> str:
    """Ontario 511-style text so TF-IDF T uses live wording, not static TC scripts."""
    if preset == "ice_storm":
        return (
            f"Ontario highway advisory: {label}. Freezing precipitation and black ice risk. "
            f"Temperature {temperature_c:.0f}°C. Hazardous driving conditions."
        )
    if preset == "blizzard":
        return (
            f"Ontario highway advisory: {label}. Snow and reduced visibility. "
            f"Wind near {wind_kmh:.0f} km/h. Slippery pavement. Multiple collision risk."
        )
    if preset == "wet":
        return (
            f"Ontario highway advisory: {label}. Wet pavement and reduced grip. "
            f"Temperature {temperature_c:.0f}°C. Use caution."
        )
    return (
        f"Ontario highway conditions: {label}. Road surface generally clear and dry. "
        f"Temperature {temperature_c:.0f}°C. No severe weather advisory."
    )


def risk_components(
    preset: str,
    temperature_c: float,
    precipitation_mm: float,
    snowfall_cm: float,
    visibility_m: Optional[float],
    wind_kmh: float,
) -> Dict[str, float]:
    if preset == "ice_storm":
        surface = 0.95
    elif preset == "blizzard":
        surface = 0.90
    elif preset == "wet":
        surface = 0.55 + min(0.25, precipitation_mm / 10.0)
    else:
        surface = 0.12

    if visibility_m is None:
        visibility = {"clear": 0.15, "wet": 0.45, "blizzard": 0.85, "ice_storm": 0.70}[preset]
    else:
        # 10 km+ → low risk; under 1 km → high
        visibility = _clip01(1.0 - (visibility_m / 10000.0))

    wind = _clip01(wind_kmh / 80.0)
    if temperature_c <= -10:
        temp = 0.85
    elif temperature_c <= 0:
        temp = 0.65
    elif temperature_c >= 32:
        temp = 0.35
    else:
        temp = 0.12

    return {
        "surface_risk": _clip01(surface),
        "visibility_risk": _clip01(visibility),
        "wind_risk": wind,
        "temp_risk": temp,
    }


def fetch_live_conditions(
    lat: float,
    lon: float,
    timeout: float = 12.0,
) -> Dict[str, Any]:
    """
    Pull current conditions for a route midpoint.
    Raises RuntimeError on network/API failure.
    """
    params = {
        "latitude": lat,
        "longitude": lon,
        "current": ",".join([
            "weather_code",
            "temperature_2m",
            "precipitation",
            "snowfall",
            "visibility",
            "wind_speed_10m",
        ]),
        "wind_speed_unit": "kmh",
        "timezone": "America/Toronto",
    }
    resp = requests.get(
        OPEN_METEO_URL,
        params=params,
        headers={"User-Agent": USER_AGENT},
        timeout=timeout,
    )
    resp.raise_for_status()
    payload = resp.json()
    cur = payload.get("current") or {}
    if "weather_code" not in cur:
        raise RuntimeError("Open-Meteo response missing current weather")

    code = int(cur.get("weather_code", 0))
    temp = float(cur.get("temperature_2m", 15.0))
    precip = float(cur.get("precipitation") or 0.0)
    snow = float(cur.get("snowfall") or 0.0)
    wind = float(cur.get("wind_speed_10m") or 0.0)
    vis = cur.get("visibility")
    visibility_m = float(vis) if vis is not None else None

    preset = map_weather_to_preset(code, temp, precip, snow)
    label = _CODE_LABEL.get(code, f"Weather code {code}")
    risks = risk_components(preset, temp, precip, snow, visibility_m, wind)
    alert = build_alert_text(preset, label, temp, wind)

    return {
        "provider": "Open-Meteo",
        "preset": preset,
        "label": label,
        "weather_code": code,
        "temperature_c": round(temp, 1),
        "precipitation_mm": round(precip, 2),
        "snowfall_cm": round(snow, 2),
        "wind_kmh": round(wind, 1),
        "visibility_m": round(visibility_m, 0) if visibility_m is not None else None,
        "latitude": lat,
        "longitude": lon,
        "alert_text": alert,
        **risks,
    }


def resolve_conditions(
    weather: str,
    lat: Optional[float] = None,
    lon: Optional[float] = None,
) -> Tuple[str, Optional[Dict[str, Any]], str]:
    """
    Returns (preset, live_dict_or_None, source_label).
    weather='auto' uses live Open-Meteo when lat/lon available.
    """
    mode = (weather or "auto").strip().lower()
    if mode == "auto":
        if lat is None or lon is None:
            return "clear", None, "auto-fallback-clear"
        live = fetch_live_conditions(float(lat), float(lon))
        return live["preset"], live, "live"
    if mode not in {"clear", "wet", "blizzard", "ice_storm"}:
        mode = "clear"
    return mode, None, "manual"
