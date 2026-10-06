"""CORS defaults, response headers, and request-shape checks.

Native Expo requests have no Origin header. Browsers enforce CORS; a missing
Origin is allowed so the phone app can keep calling the API.
"""

from __future__ import annotations

import os
from typing import Optional

# The class site, plus the local Flask ports and Expo's usual dev ports.
DEFAULT_ORIGINS = (
    "https://smart-shield-ai.onrender.com",
    "http://localhost:5050",
    "http://127.0.0.1:5050",
    "http://localhost:5051",
    "http://127.0.0.1:5051",
    "http://localhost:8081",
    "http://127.0.0.1:8081",
    "http://localhost:19006",
    "http://127.0.0.1:19006",
)

# Leaflet and MapLibre from unpkg. OSM raster tiles and OpenFreeMap vector
# styles. Overpass is called from the browser for signals and stop signs.
CONTENT_SECURITY_POLICY = "; ".join((
    "default-src 'self'",
    "script-src 'self' https://unpkg.com blob: 'wasm-unsafe-eval'",
    "style-src 'self' 'unsafe-inline' https://unpkg.com https://fonts.googleapis.com",
    "img-src 'self' data: blob: https://tile.openstreetmap.org https://a.tile.openstreetmap.org https://b.tile.openstreetmap.org https://c.tile.openstreetmap.org https://tiles.openfreemap.org https://unpkg.com",
    "connect-src 'self' https://tile.openstreetmap.org https://a.tile.openstreetmap.org https://b.tile.openstreetmap.org https://c.tile.openstreetmap.org https://tiles.openfreemap.org https://unpkg.com https://fonts.googleapis.com https://fonts.gstatic.com https://overpass-api.de https://overpass.kumi.systems https://overpass.openstreetmap.fr",
    "font-src 'self' data: https://tiles.openfreemap.org https://unpkg.com https://fonts.gstatic.com",
    "worker-src 'self' blob:",
    "frame-ancestors 'self'",
    "base-uri 'self'",
    "object-src 'none'",
))

MAX_ALERT_CHARS = 280
MAX_QUERY_CHARS = 120
MAX_ROUTES = 8
MAX_WAYPOINTS = 25
MAX_GEOMETRY_POINTS = 5000
MAX_SUMMARY_CHARS = 240
DEFAULT_MAX_BODY = 1_048_576


def configured_origins():
    """ALLOWED_ORIGINS wins. SMART_SHIELD_CORS_ORIGINS remains as a fallback.

    ``*`` is an explicit opt-in to the old open policy. An empty value uses
    the Render host plus localhost and Expo dev origins.
    """
    raw = os.getenv("ALLOWED_ORIGINS", "").strip()
    if not raw:
        raw = os.getenv("SMART_SHIELD_CORS_ORIGINS", "").strip()
    if not raw:
        return list(DEFAULT_ORIGINS)
    if raw == "*":
        return "*"
    return [part.strip() for part in raw.split(",") if part.strip()]


def max_body_bytes() -> int:
    raw = os.getenv("MAX_CONTENT_LENGTH", str(DEFAULT_MAX_BODY)).strip() or str(DEFAULT_MAX_BODY)
    try:
        value = int(raw)
    except ValueError:
        value = DEFAULT_MAX_BODY
    return max(64, min(value, 20_000_000))


def security_headers() -> dict:
    return {
        "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "strict-origin-when-cross-origin",
        "X-Frame-Options": "SAMEORIGIN",
        "Content-Security-Policy": CONTENT_SECURITY_POLICY,
    }


def valid_lat_lon(lat: float, lon: float) -> bool:
    return -90 <= lat <= 90 and -180 <= lon <= 180


def text_field(value, max_len: int) -> Optional[str]:
    """Return an error string, or None when the value is a short string or missing."""
    if value is None:
        return None
    if not isinstance(value, str):
        return "Text fields must be strings"
    if len(value) > max_len:
        return f"Text is too long (max {max_len} characters)"
    return None


def check_point(point) -> Optional[str]:
    if not isinstance(point, dict):
        return "A waypoint must be an object with lat and lon"
    try:
        lat = float(point["lat"])
        lon = float(point["lon"])
    except (KeyError, TypeError, ValueError):
        return "A waypoint needs numeric lat and lon"
    if not valid_lat_lon(lat, lon):
        return "lat/lon out of range"
    return None
