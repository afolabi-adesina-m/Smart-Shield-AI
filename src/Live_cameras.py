"""Live Ontario 511 highway CCTV stills (Vision Brain input).

Public free API — Open Government Licence – Ontario:
  https://511on.ca/api/v2/get/cameras
Docs: https://511on.ca/developers/doc

Throttle note from 511: ~10 calls / 60 seconds. We cache the camera catalogue
aggressively and only download one JPEG per score request.

Never raises — returns None on any failure so callers can fall back to
vision_cache photos or the preset proxy.
"""

from __future__ import annotations

import math
import time
from io import BytesIO
from typing import Any, Dict, List, Optional, Tuple

import requests

CAMERAS_URL = "https://511on.ca/api/v2/get/cameras"
REQUEST_TIMEOUT_S = 8
CACHE_TTL_S = 300  # 5 minutes — camera locations barely change
NEARBY_RADIUS_KM = 40.0
USER_AGENT = "SmartShieldCapstone/1.0 (Sheridan PAIDA academic demo)"

# (fetched_at, camera_list)
_cache: Tuple[float, Optional[List[dict]]] = (0.0, None)


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def fetch_all_cameras() -> Optional[List[dict]]:
    """Fetch and cache the full Ontario 511 camera catalogue."""
    global _cache
    now = time.time()
    ts, cached = _cache
    if cached is not None and now - ts < CACHE_TTL_S:
        return cached

    try:
        resp = requests.get(
            CAMERAS_URL,
            params={"format": "json"},
            headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
            timeout=REQUEST_TIMEOUT_S,
        )
        resp.raise_for_status()
        cams = resp.json()
        if not isinstance(cams, list):
            return None
    except Exception:
        return None

    _cache = (now, cams)
    return cams


def _enabled_view_url(cam: dict) -> Optional[str]:
    views = cam.get("Views") or []
    if not isinstance(views, list):
        return None
    for view in views:
        if not isinstance(view, dict):
            continue
        if str(view.get("Status", "")).lower() not in {"", "enabled"}:
            continue
        url = view.get("Url") or view.get("url")
        if isinstance(url, str) and url.startswith("http"):
            return url
    # any view with a URL
    for view in views:
        if isinstance(view, dict):
            url = view.get("Url") or view.get("url")
            if isinstance(url, str) and url.startswith("http"):
                return url
    return None


def nearest_camera(
    lat: float,
    lon: float,
    radius_km: float = NEARBY_RADIUS_KM,
) -> Optional[Dict[str, Any]]:
    """Return nearest enabled camera within radius_km, or None."""
    cams = fetch_all_cameras()
    if not cams:
        return None

    best: Optional[Tuple[float, dict, str]] = None
    for cam in cams:
        try:
            clat = float(cam.get("Latitude"))
            clon = float(cam.get("Longitude"))
        except (TypeError, ValueError):
            continue
        url = _enabled_view_url(cam)
        if not url:
            continue
        dist = _haversine_km(lat, lon, clat, clon)
        if dist > radius_km:
            continue
        if best is None or dist < best[0]:
            best = (dist, cam, url)

    if best is None:
        return None
    dist, cam, url = best
    return {
        "id": cam.get("Id"),
        "roadway": (cam.get("Roadway") or "").strip(),
        "location": (cam.get("Location") or "").strip(),
        "latitude": float(cam["Latitude"]),
        "longitude": float(cam["Longitude"]),
        "distance_km": round(dist, 2),
        "image_url": url,
        "source": cam.get("Source"),
    }


def download_camera_still(image_url: str) -> Optional[bytes]:
    """Download one JPEG/PNG still. Returns None on failure."""
    try:
        resp = requests.get(
            image_url,
            headers={"User-Agent": USER_AGENT, "Accept": "image/*,*/*"},
            timeout=REQUEST_TIMEOUT_S,
        )
        resp.raise_for_status()
        ctype = (resp.headers.get("Content-Type") or "").lower()
        data = resp.content
        if len(data) < 1000:
            return None
        if "image" not in ctype and not data[:3] in (b"\xff\xd8\xff", b"\x89PN"):
            # 511 serves image/jpeg; reject HTML error pages
            if data[:1] == b"<" or data[:15].lower().startswith(b"<!doctype"):
                return None
        return data
    except Exception:
        return None


def fetch_nearby_still(
    lat: float,
    lon: float,
    radius_km: float = NEARBY_RADIUS_KM,
) -> Optional[Dict[str, Any]]:
    """
    Nearest 511 CCTV still as raw bytes + metadata.
    Returns dict with keys: image_bytes, image_url, roadway, location, distance_km, ...
    or None if unreachable / nothing nearby.
    """
    cam = nearest_camera(lat, lon, radius_km=radius_km)
    if not cam:
        return None
    blob = download_camera_still(cam["image_url"])
    if not blob:
        return None
    out = dict(cam)
    out["image_bytes"] = blob
    return out
