"""Street and highway-exit rules for the fleet demo.

The trained model stays the highway risk engine. This module never retrains
it and never edits a score. HIGHWAY mode calls ``speed_limit.safe_speed_kmh``,
the same display rule the speed panel already uses. EXIT and STREET modes
apply the tunable limits in ``street_rules.json`` on top of OpenStreetMap.

Every posted limit is labeled ``posted`` (an OSM maxspeed tag) or
``estimated`` (a documented Ontario default). If Overpass fails, callers
still get a 200-style payload with ``lookup_ok`` false and an estimated limit.
"""

from __future__ import annotations

import json
import math
import threading
import time
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Sequence, Tuple

import requests

from speed_limit import (
    USER_AGENT,
    WEATHER_TIERS,
    default_for_highway,
    overpass_urls,
    parse_maxspeed,
    safe_speed_kmh,
    select_way,
    tier_fractions,
)

_DIR = Path(__file__).resolve().parent
_RULES_PATH = _DIR / "street_rules.json"
_DEMO_PATH = _DIR / "fleet_demo_route.json"

_RULES: Optional[dict] = None
_DEMO: Optional[dict] = None
_LOCK = threading.Lock()
_AREA_CACHE: Dict[str, Tuple[float, List[dict], Optional[str]]] = {}
_CORRIDOR: Dict[str, Any] = {"bbox": None, "elements": [], "error": None, "at": 0.0}
_NEXT_UPSTREAM = 0.0


def load_rules() -> dict:
    global _RULES
    if _RULES is None:
        with _RULES_PATH.open(encoding="utf-8") as handle:
            _RULES = json.load(handle)
    return _RULES


def load_demo_route() -> dict:
    global _DEMO
    if _DEMO is None:
        with _DEMO_PATH.open(encoding="utf-8") as handle:
            _DEMO = json.load(handle)
    return _DEMO


def clear_caches() -> None:
    global _RULES, _DEMO, _NEXT_UPSTREAM
    _RULES = None
    _DEMO = None
    _NEXT_UPSTREAM = 0.0
    _AREA_CACHE.clear()
    _CORRIDOR.update(bbox=None, elements=[], error=None, at=0.0)


def mode_for_highway(highway: Optional[str], rules: Optional[dict] = None) -> str:
    rules = rules or load_rules()
    key = (highway or "").split(";")[0].strip().lower()
    modes = rules.get("modes") or {}
    for mode in ("HIGHWAY", "EXIT", "STREET"):
        if key in set(modes.get(mode) or []):
            return mode
    return "STREET"


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    radius = 6_371_000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlmb = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
    return 2 * radius * math.asin(min(1.0, math.sqrt(a)))


def polyline_cum(coords: Sequence[Sequence[float]]) -> List[float]:
    """Cumulative metres along ``[lon, lat]`` pairs."""
    cum = [0.0]
    for i in range(1, len(coords)):
        lon1, lat1 = float(coords[i - 1][0]), float(coords[i - 1][1])
        lon2, lat2 = float(coords[i][0]), float(coords[i][1])
        cum.append(cum[-1] + haversine_m(lat1, lon1, lat2, lon2))
    return cum


def _xy(lat: float, lon: float, lat0: float, lon0: float) -> Tuple[float, float]:
    x = math.radians(lon - lon0) * math.cos(math.radians(lat0)) * 6_371_000.0
    y = math.radians(lat - lat0) * 6_371_000.0
    return x, y


def project_point(lat: float, lon: float, coords: Sequence[Sequence[float]]) -> Dict[str, float]:
    cum = polyline_cum(coords)
    best_cross = 1e18
    best_along = 0.0
    if len(coords) == 1:
        lon0, lat0 = float(coords[0][0]), float(coords[0][1])
        return {"cross_m": haversine_m(lat, lon, lat0, lon0), "along_m": 0.0, "total_m": 0.0}
    for i in range(len(coords) - 1):
        lon1, lat1 = float(coords[i][0]), float(coords[i][1])
        lon2, lat2 = float(coords[i + 1][0]), float(coords[i + 1][1])
        sx, sy = _xy(lat2, lon2, lat1, lon1)
        px, py = _xy(lat, lon, lat1, lon1)
        seg_len2 = sx * sx + sy * sy
        if seg_len2 < 1e-6:
            cross = math.hypot(px, py)
            along = cum[i]
        else:
            t = max(0.0, min(1.0, (px * sx + py * sy) / seg_len2))
            cross = math.hypot(px - t * sx, py - t * sy)
            along = cum[i] + t * math.sqrt(seg_len2)
        if cross < best_cross:
            best_cross = cross
            best_along = along
    return {"cross_m": best_cross, "along_m": best_along, "total_m": cum[-1] if cum else 0.0}


def point_at(coords: Sequence[Sequence[float]], along_m: float) -> Tuple[float, float]:
    """Return ``(lat, lon)`` at a distance along a ``[lon, lat]`` line."""
    cum = polyline_cum(coords)
    if not coords:
        raise ValueError("empty geometry")
    if along_m <= 0 or len(coords) == 1:
        return float(coords[0][1]), float(coords[0][0])
    if along_m >= cum[-1]:
        return float(coords[-1][1]), float(coords[-1][0])
    for i in range(1, len(cum)):
        if cum[i] >= along_m:
            span = cum[i] - cum[i - 1]
            t = 0.0 if span <= 0 else (along_m - cum[i - 1]) / span
            lon = float(coords[i - 1][0]) + t * (float(coords[i][0]) - float(coords[i - 1][0]))
            lat = float(coords[i - 1][1]) + t * (float(coords[i][1]) - float(coords[i - 1][1]))
            return lat, lon
    return float(coords[-1][1]), float(coords[-1][0])


def _bearing_delta(b1: float, b2: float) -> float:
    return abs((b1 - b2 + 180.0) % 360.0 - 180.0)


def bearing_deg(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dlmb = math.radians(lon2 - lon1)
    y = math.sin(dlmb) * math.cos(p2)
    x = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dlmb)
    return (math.degrees(math.atan2(y, x)) + 360.0) % 360.0


def driver_score(events: Sequence[dict], rules: Optional[dict] = None) -> int:
    """Transparent fleet score. See ``score.formula`` in street_rules.json."""
    rules = rules or load_rules()
    score_cfg = rules["score"]
    penalties = score_cfg["penalties"]
    total = int(score_cfg["start"])
    for event in events:
        kind = str(event.get("kind") or "")
        total -= int(penalties.get(kind, 0))
    return max(0, min(100, total))


def _condition_fraction(weather: Optional[str], tier: Optional[str]) -> Tuple[float, str]:
    fractions = tier_fractions()
    tier_name = (tier or "").strip().upper()
    weather_name = (weather or "").strip().lower()
    if tier_name in fractions and tier_name != "LOW":
        return fractions[tier_name], f"{tier_name.lower()} risk"
    if weather_name in ("", "auto", "clear"):
        return 1.0, ""
    mapped = WEATHER_TIERS.get(weather_name)
    if mapped and mapped in fractions and mapped != "LOW":
        return fractions[mapped], weather_name.replace("_", " ")
    return 1.0, ""


def _posted(way: Optional[dict], mode: str, rules: dict, lookup_error: Optional[str]) -> Dict[str, Any]:
    defaults = rules["posted_defaults_kmh"]
    highway = (way or {}).get("highway") or "unknown"
    name = (way or {}).get("name")
    if way and way.get("maxspeed") is not None:
        return {
            "posted_kmh": int(way["maxspeed"]),
            "posted_source": "osm",
            "posted_label": "posted",
            "estimated": False,
            "highway": highway,
            "road_name": name,
            "detail": "Posted limit from OpenStreetMap.",
        }
    if mode == "EXIT":
        est = int(defaults["exit_ramp"])
        lo, hi = int(defaults["exit_ramp_min"]), int(defaults["exit_ramp_max"])
        detail = (
            f"Estimated Ontario ramp default of {est} km/h "
            f"(typical ramp range {lo}–{hi} km/h). No maxspeed tag."
        )
    elif mode == "HIGHWAY":
        est = int(default_for_highway(None if highway == "unknown" else highway))
        label = highway.replace("_", " ")
        detail = f"Estimated {est} km/h for a {label} (no maxspeed tag)."
    else:
        if highway == "living_street":
            est = int(defaults["living_street"])
            kind = "living street"
        elif highway == "service":
            est = int(defaults["service"])
            kind = "service road"
        elif highway in set(defaults.get("rural_highways") or []):
            est = int(defaults["rural"])
            kind = "rural"
        else:
            est = int(defaults["urban"])
            kind = "urban"
        detail = f"Estimated Ontario {kind} default of {est} km/h. No maxspeed tag."
    if lookup_error and way is None:
        detail = f"{detail} Map lookup failed ({lookup_error})."
    return {
        "posted_kmh": est,
        "posted_source": "estimated",
        "posted_label": "estimated",
        "estimated": True,
        "highway": highway,
        "road_name": name,
        "detail": detail,
    }


def _exit_distance(car_along: Optional[float], mode: str, samples: Sequence[dict]) -> Optional[float]:
    if mode == "EXIT" or car_along is None or not samples:
        return None
    distances = []
    for sample in samples:
        highway = sample.get("highway")
        if mode_for_highway(highway) != "EXIT":
            continue
        if "from_m" in sample and "to_m" in sample:
            start = float(sample["from_m"])
            end = float(sample["to_m"])
            if start <= car_along < end:
                continue
            if start > car_along:
                distances.append(start - car_along)
        elif sample.get("along_m") is not None and float(sample["along_m"]) > car_along + 15:
            distances.append(float(sample["along_m"]) - car_along)
    if not distances:
        return None
    return min(distances)


def _hazards_ahead(
    lat: float,
    lon: float,
    hazards: Sequence[dict],
    geometry: Optional[Sequence[Sequence[float]]],
    bearing: Optional[float],
    rules: dict,
) -> List[dict]:
    ahead_cfg = rules["ahead"]
    search_m = float(ahead_cfg["search_m"])
    corridor_m = float(ahead_cfg["corridor_m"])
    min_ahead = float(ahead_cfg.get("min_ahead_m", 8))
    found: List[dict] = []
    car_along = None
    if geometry and len(geometry) >= 2:
        car_along = project_point(lat, lon, geometry)["along_m"]
    for hazard in hazards:
        hlat = float(hazard["lat"])
        hlon = float(hazard["lon"])
        straight = haversine_m(lat, lon, hlat, hlon)
        distance = None
        if geometry and len(geometry) >= 2 and car_along is not None:
            proj = project_point(hlat, hlon, geometry)
            if proj["cross_m"] > corridor_m:
                continue
            delta = proj["along_m"] - car_along
            if delta < min_ahead or delta > search_m:
                continue
            distance = delta
        elif bearing is not None and straight <= search_m and straight >= min_ahead:
            target = bearing_deg(lat, lon, hlat, hlon)
            if _bearing_delta(bearing, target) > float(ahead_cfg.get("bearing_deg", 70)):
                continue
            distance = straight
        else:
            continue
        kind = hazard["kind"]
        cap = (rules.get("caps") or {}).get(kind) or {}
        label = hazard.get("label") or cap.get("label") or kind.replace("_", " ").title()
        found.append({
            "kind": kind,
            "id": hazard.get("id") or f"{kind}:{hlat:.5f}:{hlon:.5f}",
            "lat": hlat,
            "lon": hlon,
            "name": hazard.get("name"),
            "label": label,
            "distance_m": round(distance),
        })
    found.sort(key=lambda item: item["distance_m"])
    limit = int(ahead_cfg.get("max_icons", 4))
    return found[:limit]


def build_context(
    lat: float,
    lon: float,
    way: Optional[dict],
    hazards: Optional[Sequence[dict]] = None,
    geometry: Optional[Sequence[Sequence[float]]] = None,
    road_samples: Optional[Sequence[dict]] = None,
    weather: Optional[str] = None,
    tier: Optional[str] = None,
    recommended_kmh: Optional[float] = None,
    bearing: Optional[float] = None,
    rules: Optional[dict] = None,
    lookup_ok: bool = True,
    lookup_error: Optional[str] = None,
) -> Dict[str, Any]:
    """Pure rules evaluation. Does not call Overpass or the model."""
    rules = rules or load_rules()
    highway = (way or {}).get("highway")
    mode = mode_for_highway(highway, rules)
    posted = _posted(way, mode, rules, lookup_error if not lookup_ok else None)
    ahead = _hazards_ahead(lat, lon, list(hazards or []), geometry, bearing, rules)
    # Street hazards and their speed caps apply in STREET mode only.
    # HIGHWAY keeps the model safe-speed rule; EXIT keeps the ramp limit.
    if mode != "STREET":
        ahead = []
    car_along = None
    if geometry and len(geometry) >= 2:
        car_along = project_point(lat, lon, geometry)["along_m"]
    exit_dist = _exit_distance(car_along, mode, list(road_samples or []))
    exit_cfg = rules["exit_warning"]
    exit_warning = None
    if exit_dist is not None and float(exit_cfg["min_m"]) <= exit_dist <= float(exit_cfg["max_m"]):
        exit_warning = {
            "text": exit_cfg["text"],
            "distance_m": int(round(exit_dist)),
        }

    active_caps: List[dict] = []
    safe_kmh = int(posted["posted_kmh"])
    safe_source = "posted"
    summary = "Matches the posted limit"
    rule = posted["detail"]
    if mode == "HIGHWAY":
        safe_info = safe_speed_kmh(
            posted["posted_kmh"],
            highway=highway,
            tier=tier,
            recommended_kmh=recommended_kmh,
            weather=weather,
        )
        safe_kmh = int(safe_info["safe_kmh"])
        safe_source = safe_info["source"]
        summary = safe_info["summary"]
        rule = safe_info["rule"]
    else:
        floor = int(rules.get("safe_floor_kmh", 15))
        reasons = []
        if mode == "STREET":
            for hazard in ahead:
                cap = (rules.get("caps") or {}).get(hazard["kind"])
                if not cap:
                    continue
                if hazard["distance_m"] <= int(cap["within_m"]) and int(cap["safe_kmh"]) < safe_kmh:
                    safe_kmh = int(cap["safe_kmh"])
                    active_caps.append({
                        "kind": hazard["kind"],
                        "safe_kmh": int(cap["safe_kmh"]),
                        "distance_m": hazard["distance_m"],
                    })
                    reasons.append(f"{cap['label']} within {hazard['distance_m']} m → {int(cap['safe_kmh'])} km/h")
        fraction, frac_note = _condition_fraction(weather, tier)
        if fraction < 0.999:
            safe_kmh = int(round(safe_kmh * fraction))
            if frac_note:
                reasons.append(f"{frac_note} lowers it further")
            safe_source = "conditions"
        else:
            safe_source = "street_rules" if mode == "STREET" else "exit_rules"
        safe_kmh = max(floor, min(int(posted["posted_kmh"]), safe_kmh))
        if reasons:
            summary = "Street rule · " + " · ".join(reasons) if mode == "STREET" else "Exit rule · " + " · ".join(reasons)
        elif mode == "EXIT":
            summary = "Exit ramp limit"
        rule = (
            "Street and exit safe speeds start from the posted limit, or an "
            "estimated Ontario default when OSM has no maxspeed. "
            "Near a bump the cap is about 20 km/h, before a signal about 30, "
            "before a stop about 15, and in a school zone about 40. "
            "Weather or an existing risk tier can lower that further, never above the posted limit. "
            "Highway mode does not use these caps; it uses the existing safe-speed rule."
        )

    alerts = []
    if exit_warning:
        alerts.append({
            "kind": "exit",
            "text": exit_warning["text"],
            "distance_m": exit_warning["distance_m"],
        })
    for hazard in ahead:
        alerts.append({
            "kind": hazard["kind"],
            "text": f"{hazard['label']} ahead in {hazard['distance_m']} m",
            "distance_m": hazard["distance_m"],
            "lat": hazard["lat"],
            "lon": hazard["lon"],
            "id": hazard["id"],
        })

    return {
        "lat": lat,
        "lon": lon,
        "road_mode": mode,
        "highway": posted["highway"],
        "road_name": posted["road_name"],
        "posted_kmh": posted["posted_kmh"],
        "posted_source": posted["posted_source"],
        "posted_label": posted["posted_label"],
        "estimated": posted["estimated"],
        "detail": posted["detail"],
        "safe_kmh": safe_kmh,
        "safe_source": safe_source,
        "summary": summary,
        "rule": rule,
        "lookup_ok": bool(lookup_ok),
        "lookup_error": lookup_error,
        "exit_warning": exit_warning,
        "alerts": alerts,
        "hazards": ahead,
        "active_caps": active_caps,
        "school_active": any(cap["kind"] == "school_zone" for cap in active_caps),
        "along_m": None if car_along is None else round(car_along, 1),
        "distance_m": None if not way else way.get("dist"),
        "osm_way_id": None if not way else way.get("id"),
    }


def _segment_at(segments: Sequence[dict], along_m: float) -> dict:
    for segment in segments:
        if float(segment["from_m"]) <= along_m < float(segment["to_m"]):
            return segment
    return segments[-1]


def context_from_demo(
    lat: float,
    lon: float,
    weather: Optional[str] = None,
    tier: Optional[str] = None,
    recommended_kmh: Optional[float] = None,
) -> Dict[str, Any]:
    route = load_demo_route()
    geometry = route["coordinates"]
    proj = project_point(lat, lon, geometry)
    segment = _segment_at(route["segments"], proj["along_m"])
    way = {
        "highway": segment["highway"],
        "name": segment.get("name"),
        "maxspeed": segment.get("maxspeed"),
        "dist": round(proj["cross_m"], 1),
        "id": segment.get("id"),
    }
    samples = [
        {"from_m": seg["from_m"], "to_m": seg["to_m"], "highway": seg["highway"]}
        for seg in route["segments"]
    ]
    payload = build_context(
        lat,
        lon,
        way,
        hazards=route.get("hazards") or [],
        geometry=geometry,
        road_samples=samples,
        weather=weather,
        tier=tier,
        recommended_kmh=recommended_kmh,
        lookup_ok=True,
        lookup_error=None,
    )
    payload["demo"] = True
    payload["route_name"] = route.get("name")
    return payload


def _clean_geometry(raw: Any) -> Optional[List[List[float]]]:
    if not isinstance(raw, list):
        return None
    points: List[List[float]] = []
    for item in raw[:800]:
        if not isinstance(item, (list, tuple)) or len(item) < 2:
            continue
        try:
            points.append([float(item[0]), float(item[1])])
        except (TypeError, ValueError):
            continue
    return points if len(points) >= 2 else None


def _bbox_around(lat: float, lon: float, geometry: Optional[Sequence[Sequence[float]]]) -> Tuple[float, float, float, float]:
    lats = [lat]
    lons = [lon]
    if geometry and len(geometry) >= 2:
        car = project_point(lat, lon, geometry)
        cum = polyline_cum(geometry)
        for index, point in enumerate(geometry):
            if abs(cum[index] - car["along_m"]) <= 900:
                lons.append(float(point[0]))
                lats.append(float(point[1]))
    else:
        pad = 0.006
        return lat - pad, lon - pad, lat + pad, lon + pad
    pad = 0.0012
    return min(lats) - pad, min(lons) - pad, max(lats) + pad, max(lons) + pad


def _cache_key(bbox: Tuple[float, float, float, float]) -> str:
    south, west, north, east = bbox
    return f"{south:.3f},{west:.3f},{north:.3f},{east:.3f}"


def _covers(bbox: Optional[Sequence[float]], lat: float, lon: float) -> bool:
    if not bbox:
        return False
    south, west, north, east = bbox
    margin = 0.001
    return (south + margin) <= lat <= (north - margin) and (west + margin) <= lon <= (east - margin)


def _overpass_query(south: float, west: float, north: float, east: float) -> str:
    box = f"{south:.5f},{west:.5f},{north:.5f},{east:.5f}"
    return (
        f"[out:json][timeout:18];("
        f'way["highway"]({box});'
        f'node["highway"="traffic_signals"]({box});'
        f'node["highway"="stop"]({box});'
        f'node["traffic_calming"]({box});'
        f'way["traffic_calming"]({box});'
        f'node["highway"="crossing"]({box});'
        f'way["highway"="crossing"]({box});'
        f'node["amenity"="school"]({box});'
        f'way["amenity"="school"]({box});'
        f'node["school_zone"]({box});'
        f");out tags center;"
    )


def _fetch_overpass(
    bbox: Tuple[float, float, float, float],
    fetch: Optional[Callable[..., Any]] = None,
) -> Tuple[List[dict], Optional[str]]:
    rules = load_rules()
    interval = float(rules["overpass"]["min_interval_s"])
    timeout = float(rules["overpass"]["timeout_s"])
    query = _overpass_query(*bbox)
    getter = fetch or requests.post
    last_error = None
    for url in overpass_urls():
        try:
            response = getter(
                url,
                data={"data": query},
                headers={"User-Agent": USER_AGENT},
                timeout=timeout,
            )
            status = getattr(response, "status_code", 200)
            if status >= 400:
                last_error = f"{url} HTTP {status}"
                continue
            payload = response.json()
            elements = list(payload.get("elements") or [])
            if elements:
                return elements, None
            last_error = f"{url} returned no map data"
        except Exception as exc:  # network, timeout, bad JSON
            last_error = f"{url}: {exc}"
    return [], last_error or "Overpass unavailable"


def load_elements(
    lat: float,
    lon: float,
    geometry: Optional[Sequence[Sequence[float]]] = None,
    fetch: Optional[Callable[..., Any]] = None,
) -> Tuple[List[dict], Optional[str]]:
    """Cached Overpass read. Never raises; a failure is an empty list plus an error."""
    global _NEXT_UPSTREAM
    rules = load_rules()
    ttl = float(rules["overpass"]["cache_ttl_s"])
    interval = float(rules["overpass"]["min_interval_s"])
    bbox = _bbox_around(lat, lon, geometry)
    key = _cache_key(bbox)
    now = time.time()
    with _LOCK:
        cached = _AREA_CACHE.get(key)
        if cached and now - cached[0] < ttl:
            return cached[1], cached[2]
        if _covers(_CORRIDOR.get("bbox"), lat, lon) and now - float(_CORRIDOR.get("at") or 0) < ttl:
            return list(_CORRIDOR.get("elements") or []), _CORRIDOR.get("error")
        if now < _NEXT_UPSTREAM:
            if cached:
                return cached[1], cached[2]
            if _covers(_CORRIDOR.get("bbox"), lat, lon) and _CORRIDOR.get("elements"):
                return list(_CORRIDOR["elements"]), _CORRIDOR.get("error")
            return [], "Overpass rate limit; using estimated defaults"
        _NEXT_UPSTREAM = now + interval
    try:
        elements, error = _fetch_overpass(bbox, fetch=fetch)
    except Exception as exc:
        elements, error = [], str(exc)
    with _LOCK:
        _AREA_CACHE[key] = (time.time(), elements, error)
        _CORRIDOR.update(bbox=bbox, elements=elements, error=error, at=time.time())
    return elements, error


def _center(element: dict) -> Optional[Tuple[float, float]]:
    center = element.get("center") or {}
    if "lat" in center and "lon" in center:
        return float(center["lat"]), float(center["lon"])
    if "lat" in element and "lon" in element:
        return float(element["lat"]), float(element["lon"])
    return None


def _prepare_ways(elements: Sequence[dict]) -> List[dict]:
    prepared = []
    for element in elements:
        if element.get("type") != "way":
            continue
        center = _center(element)
        if not center:
            continue
        prepared.append({
            "type": "way",
            "id": element.get("id"),
            "tags": element.get("tags") or {},
            "center": {"lat": center[0], "lon": center[1]},
        })
    return prepared


def hazards_from_elements(elements: Sequence[dict]) -> List[dict]:
    found = []
    seen = set()
    calming = {"bump": "Speed bump", "hump": "Speed hump", "table": "Speed table", "cushion": "Speed cushion"}
    for element in elements:
        tags = element.get("tags") or {}
        center = _center(element)
        if not center:
            continue
        kind = None
        label = None
        highway = str(tags.get("highway") or "")
        if highway == "traffic_signals":
            kind = "traffic_signal"
        elif highway == "stop":
            kind = "stop_sign"
        elif tags.get("traffic_calming"):
            kind = "speed_bump"
            label = calming.get(str(tags.get("traffic_calming")), "Speed bump")
        elif highway == "crossing" or tags.get("crossing") or tags.get("footway") == "crossing":
            kind = "crosswalk"
        elif tags.get("amenity") == "school" or tags.get("school_zone") in {"yes", "true", "1"}:
            kind = "school_zone"
        if not kind:
            continue
        ident = f"{kind}:{element.get('type')}:{element.get('id')}"
        if ident in seen:
            continue
        seen.add(ident)
        found.append({
            "kind": kind,
            "lat": center[0],
            "lon": center[1],
            "id": ident,
            "name": tags.get("name"),
            "label": label,
        })
    return found


def samples_along(elements: Sequence[dict], geometry: Sequence[Sequence[float]]) -> List[dict]:
    samples = []
    for element in _prepare_ways(elements):
        tags = element.get("tags") or {}
        highway = str(tags.get("highway") or "").split(";")[0].strip().lower()
        if not highway:
            continue
        center = element["center"]
        proj = project_point(float(center["lat"]), float(center["lon"]), geometry)
        if proj["cross_m"] > 45:
            continue
        samples.append({"along_m": proj["along_m"], "highway": highway})
    samples.sort(key=lambda item: item["along_m"])
    return samples


def prefetch_corridor(geometry: Any, fetch: Optional[Callable[..., Any]] = None) -> Dict[str, Any]:
    """One Overpass read for a whole route. Failures return lookup_ok false."""
    global _NEXT_UPSTREAM
    line = _clean_geometry(geometry)
    if not line:
        return {"ok": False, "lookup_ok": False, "error": "Need a route geometry", "hazards": 0, "cached": False}
    lats = [point[1] for point in line]
    lons = [point[0] for point in line]
    if max(lats) - min(lats) > 0.2 or max(lons) - min(lons) > 0.25:
        return {
            "ok": False,
            "lookup_ok": False,
            "error": "Route box is too large to prefetch",
            "hazards": 0,
            "cached": False,
        }
    bbox = (min(lats) - 0.003, min(lons) - 0.003, max(lats) + 0.003, max(lons) + 0.003)
    rules = load_rules()
    ttl = float(rules["overpass"]["cache_ttl_s"])
    now = time.time()
    with _LOCK:
        if (
            _CORRIDOR.get("elements")
            and _CORRIDOR.get("bbox") == bbox
            and now - float(_CORRIDOR.get("at") or 0) < ttl
        ):
            return {
                "ok": True,
                "lookup_ok": True,
                "cached": True,
                "error": _CORRIDOR.get("error"),
                "hazards": len(hazards_from_elements(_CORRIDOR["elements"])),
            }
        if now < _NEXT_UPSTREAM:
            return {
                "ok": False,
                "lookup_ok": False,
                "cached": False,
                "error": "Overpass rate limit; using estimated defaults",
                "hazards": 0,
            }
        _NEXT_UPSTREAM = now + float(rules["overpass"]["min_interval_s"])
    try:
        elements, error = _fetch_overpass(bbox, fetch=fetch)
    except Exception as exc:
        elements, error = [], str(exc)
    with _LOCK:
        _AREA_CACHE[_cache_key(bbox)] = (time.time(), elements, error)
        _CORRIDOR.update(bbox=bbox, elements=elements, error=error, at=time.time())
    return {
        "ok": bool(elements),
        "lookup_ok": bool(elements),
        "cached": False,
        "error": error,
        "hazards": len(hazards_from_elements(elements)) if elements else 0,
    }


def road_context(
    lat: float,
    lon: float,
    geometry: Any = None,
    weather: Optional[str] = None,
    tier: Optional[str] = None,
    recommended_kmh: Optional[float] = None,
    bearing: Optional[float] = None,
    demo: bool = False,
    fetch: Optional[Callable[..., Any]] = None,
) -> Dict[str, Any]:
    """Rules payload for one position. Overpass failures stay inside the payload."""
    if demo:
        return context_from_demo(lat, lon, weather=weather, tier=tier, recommended_kmh=recommended_kmh)
    line = _clean_geometry(geometry)
    try:
        elements, error = load_elements(lat, lon, line, fetch=fetch)
    except Exception as exc:
        elements, error = [], str(exc)
    lookup_ok = bool(elements)
    way = select_way(lat, lon, _prepare_ways(elements)) if elements else None
    hazards = hazards_from_elements(elements) if elements else []
    samples = samples_along(elements, line) if elements and line else []
    try:
        bear = None if bearing is None or bearing == "" else float(bearing)
    except (TypeError, ValueError):
        bear = None
    return build_context(
        lat,
        lon,
        way,
        hazards=hazards,
        geometry=line,
        road_samples=samples,
        weather=weather,
        tier=tier,
        recommended_kmh=recommended_kmh,
        bearing=bear,
        lookup_ok=lookup_ok,
        lookup_error=None if lookup_ok else error,
    )
