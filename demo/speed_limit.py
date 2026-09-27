"""Posted speed limits and the map Safe Speed display.

OpenStreetMap ``maxspeed`` is read through the Overpass API. When a road has
no posted limit, a documented default for that highway type is used and
labeled estimated.

Safe Speed does not retrain or alter the fusion model. It only scales signals
the app already produces:

* a scored route's ``recommended_speed_kmh`` (computed against the model's
  100 km/h highway assumption in ``safety_score.build_operational_advisory``), or
* the same LOW / MEDIUM / HIGH fractions ``risk_tier()`` already returns, or
* the road-conditions preset, mapped onto those same tiers, before a route
  has been scored.

The result is never higher than the posted limit. On motorways whose posted
limit is at least 100 km/h, the existing 80 km/h freeway floor still applies.
"""

from __future__ import annotations

import math
import os
import re
import sys
import time
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Sequence, Tuple

import requests

_ROOT = Path(__file__).resolve().parent.parent
_SRC = _ROOT / "src"
if str(_SRC) not in sys.path:
    sys.path.insert(0, str(_SRC))

from safety_score import FREEWAY_MIN_ADVISORY_KMH, POSTED_SPEED_KMH, risk_tier

USER_AGENT = "SmartShieldCapstone/1.0 (Sheridan PAIDA academic demo)"

# Public Overpass interpreters. The first one that returns roads wins.
# Override with OVERPASS_URL (tried first) or OVERPASS_URLS (comma-separated).
DEFAULT_OVERPASS_URLS = (
    "https://overpass.openstreetmap.fr/api/interpreter",
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
)

# Ontario-oriented defaults used only when OSM has no maxspeed tag.
# Values are typical posted limits, not legal advice.
ROAD_DEFAULTS_KMH = {
    "motorway": 100,
    "motorway_link": 80,
    "trunk": 80,
    "trunk_link": 70,
    "primary": 80,
    "primary_link": 60,
    "secondary": 60,
    "secondary_link": 50,
    "tertiary": 50,
    "tertiary_link": 40,
    "unclassified": 50,
    "residential": 40,
    "living_street": 20,
    "service": 30,
    "road": 50,
}
UNKNOWN_ROAD_KMH = 50

DRIVING_HIGHWAYS = set(ROAD_DEFAULTS_KMH)

# Same fractions risk_tier() returns for S in each band. Read from the
# function so this display cannot drift from the scoring module.
def tier_fractions() -> Dict[str, float]:
    return {
        "LOW": float(risk_tier(0)[2]),
        "MEDIUM": float(risk_tier(50)[2]),
        "HIGH": float(risk_tier(90)[2]),
    }


# Road-conditions presets already offered in the map UI, before a route score exists.
WEATHER_TIERS = {
    "clear": "LOW",
    "wet": "MEDIUM",
    "blizzard": "HIGH",
    "ice_storm": "HIGH",
}

FREEWAY_CLASSES = {"motorway", "motorway_link"}

_CACHE: Dict[Tuple[float, float], Tuple[float, List[dict], Optional[str]]] = {}
_CACHE_TTL_S = 600


def overpass_urls() -> List[str]:
    urls: List[str] = []
    primary = os.getenv("OVERPASS_URL", "").strip()
    extra = os.getenv("OVERPASS_URLS", "").strip()
    if primary:
        urls.append(primary)
    if extra:
        urls.extend(part.strip() for part in extra.split(",") if part.strip())
    for url in DEFAULT_OVERPASS_URLS:
        if url not in urls:
            urls.append(url)
    return urls


def parse_maxspeed(raw: Optional[str]) -> Optional[int]:
    """Parse an OSM maxspeed tag into km/h, or None when it is not a number."""
    if raw is None:
        return None
    text = str(raw).strip().lower()
    if not text or text in {"none", "signals", "variable", "unlimited", "walk", "national"}:
        return None
    # "60;80", "50|50|30", "100 @ (06:00-20:00)" — use the first speed.
    match = re.search(r"(\d+(?:[.,]\d+)?)\s*(mph|km/h|kmh|kph)?", text)
    if not match:
        return None
    value = float(match.group(1).replace(",", "."))
    unit = match.group(2) or ""
    if "mph" in unit:
        value *= 1.60934
    if value <= 0 or value > 200:
        return None
    return int(round(value))


def default_for_highway(highway: Optional[str]) -> int:
    key = (highway or "").split(";")[0].strip().lower()
    return int(ROAD_DEFAULTS_KMH.get(key, UNKNOWN_ROAD_KMH))


def _distance_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    radius = 6_371_000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlmb = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
    return 2 * radius * math.asin(min(1.0, math.sqrt(a)))


def _maxspeed_from_tags(tags: Dict[str, Any]) -> Optional[int]:
    for key in ("maxspeed", "maxspeed:forward", "maxspeed:backward", "maxspeed:lanes"):
        parsed = parse_maxspeed(tags.get(key))
        if parsed is not None:
            return parsed
    return None


def select_way(lat: float, lon: float, elements: Sequence[dict]) -> Optional[dict]:
    """Pick the driving road nearest the point, preferring a real maxspeed tag."""
    candidates = []
    for el in elements:
        if el.get("type") != "way":
            continue
        tags = el.get("tags") or {}
        highway = tags.get("highway")
        if isinstance(highway, list):
            highway = highway[0] if highway else None
        if not highway:
            continue
        highway = str(highway).split(";")[0].strip().lower()
        center = el.get("center") or {}
        if "lat" not in center or "lon" not in center:
            continue
        candidates.append({
            "highway": highway,
            "name": tags.get("name") or tags.get("ref"),
            "maxspeed": _maxspeed_from_tags(tags),
            "dist": _distance_m(lat, lon, float(center["lat"]), float(center["lon"])),
            "id": el.get("id"),
        })
    if not candidates:
        return None
    driving = [c for c in candidates if c["highway"] in DRIVING_HIGHWAYS]
    pool = driving or candidates
    pool.sort(key=lambda c: c["dist"])
    nearest = pool[0]
    window = max(nearest["dist"] + 35.0, 80.0)
    tagged = [c for c in pool if c["maxspeed"] is not None and c["dist"] <= window]
    if tagged:
        tagged.sort(key=lambda c: c["dist"])
        return tagged[0]
    return nearest


def posted_from_way(way: Optional[dict], lookup_error: Optional[str] = None) -> Dict[str, Any]:
    if way is None:
        return {
            "posted_kmh": UNKNOWN_ROAD_KMH,
            "posted_source": "estimated",
            "estimated": True,
            "highway": "unknown",
            "road_name": None,
            "distance_m": None,
            "osm_way_id": None,
            "detail": (
                "No nearby OpenStreetMap road"
                + (f" ({lookup_error})" if lookup_error else "")
                + f". Using the unknown-road default of {UNKNOWN_ROAD_KMH} km/h."
            ),
        }
    highway = way["highway"]
    if way["maxspeed"] is not None:
        return {
            "posted_kmh": int(way["maxspeed"]),
            "posted_source": "osm",
            "estimated": False,
            "highway": highway,
            "road_name": way.get("name"),
            "distance_m": round(float(way["dist"]), 1),
            "osm_way_id": way.get("id"),
            "detail": "Posted limit from OpenStreetMap.",
        }
    fallback = default_for_highway(highway)
    label = way.get("name") or highway.replace("_", " ")
    return {
        "posted_kmh": fallback,
        "posted_source": "estimated",
        "estimated": True,
        "highway": highway,
        "road_name": way.get("name"),
        "distance_m": round(float(way["dist"]), 1),
        "osm_way_id": way.get("id"),
        "detail": (
            f"Estimated {fallback} km/h for a {highway.replace('_', ' ')} "
            "(no maxspeed tag)."
        ),
    }


def safe_speed_kmh(
    posted_kmh: float,
    highway: Optional[str] = None,
    tier: Optional[str] = None,
    recommended_kmh: Optional[float] = None,
    weather: Optional[str] = None,
) -> Dict[str, Any]:
    """Scale an existing risk signal onto the posted limit. Never exceeds it."""
    posted = int(round(float(posted_kmh)))
    posted = max(5, min(200, posted))
    fractions = tier_fractions()
    tier_name = (tier or "").strip().upper() or None
    weather_name = (weather or "").strip().lower() or None
    fraction = 1.0
    source = "posted"
    summary = "Matches the posted limit"
    used_tier = tier_name

    if recommended_kmh is not None and POSTED_SPEED_KMH > 0:
        fraction = float(recommended_kmh) / float(POSTED_SPEED_KMH)
        source = "route_advisory"
        summary = f"{fraction:.0%} of posted · route advisory"
    elif tier_name in fractions:
        fraction = fractions[tier_name]
        source = "risk_tier"
        summary = f"{fraction:.0%} of posted · {tier_name} risk"
    elif weather_name in WEATHER_TIERS:
        used_tier = WEATHER_TIERS[weather_name]
        fraction = fractions[used_tier]
        source = "weather_preset"
        summary = f"{fraction:.0%} of posted · {weather_name.replace('_', ' ')} conditions"
    else:
        used_tier = used_tier or "LOW"

    safe = int(round(posted * fraction))
    floor_applied = False
    highway_key = (highway or "").split(";")[0].strip().lower()
    if (
        highway_key in FREEWAY_CLASSES
        and posted >= int(POSTED_SPEED_KMH)
        and safe < int(FREEWAY_MIN_ADVISORY_KMH)
    ):
        safe = int(FREEWAY_MIN_ADVISORY_KMH)
        floor_applied = True
        summary += f" · freeway floor {int(FREEWAY_MIN_ADVISORY_KMH)}"
    safe = max(5, min(posted, safe))

    return {
        "safe_kmh": safe,
        "posted_kmh": posted,
        "fraction": round(fraction, 3),
        "source": source,
        "tier": used_tier,
        "floor_applied": floor_applied,
        "summary": summary,
        "rule": (
            "Safe speed = posted limit × the speed fraction the app already uses "
            f"(route advisory ÷ {int(POSTED_SPEED_KMH)}, or risk_tier "
            "LOW 100% / MEDIUM 80% / HIGH 60%). "
            "It is capped at the posted limit. Motorways posted at "
            f"{int(POSTED_SPEED_KMH)} km/h or more keep the existing "
            f"{int(FREEWAY_MIN_ADVISORY_KMH)} km/h freeway floor."
        ),
    }


def _overpass_query(lat: float, lon: float) -> str:
    return (
        f"[out:json][timeout:12];"
        f"way(around:90,{lat:.6f},{lon:.6f})[\"highway\"];"
        f"out tags center 25;"
    )


def fetch_overpass_elements(
    lat: float,
    lon: float,
    get: Optional[Callable[..., Any]] = None,
    urls: Optional[Sequence[str]] = None,
) -> Tuple[List[dict], Optional[str]]:
    """Return (elements, error). Tries each Overpass endpoint until one has roads."""
    getter = get or requests.post
    last_error = None
    for url in list(urls or overpass_urls()):
        try:
            resp = getter(
                url,
                data={"data": _overpass_query(lat, lon)},
                headers={"User-Agent": USER_AGENT},
                timeout=8,
            )
            status = getattr(resp, "status_code", 200)
            if status >= 400:
                last_error = f"{url} HTTP {status}"
                continue
            payload = resp.json()
            elements = list(payload.get("elements") or [])
            if elements:
                return elements, None
            last_error = f"{url} returned no roads"
        except Exception as exc:  # network, JSON, timeout
            last_error = f"{url}: {exc}"
    return [], last_error


def _cache_key(lat: float, lon: float) -> Tuple[float, float]:
    return (round(lat, 4), round(lon, 4))


def lookup_posted_speed(lat: float, lon: float) -> Dict[str, Any]:
    key = _cache_key(lat, lon)
    now = time.time()
    cached = _CACHE.get(key)
    if cached and now - cached[0] < _CACHE_TTL_S:
        elements, lookup_error = cached[1], cached[2]
    else:
        elements, lookup_error = fetch_overpass_elements(lat, lon)
        _CACHE[key] = (now, elements, lookup_error)
    way = select_way(lat, lon, elements)
    posted = posted_from_way(way, lookup_error=lookup_error)
    posted["lat"] = lat
    posted["lon"] = lon
    return posted


def clear_cache() -> None:
    _CACHE.clear()
