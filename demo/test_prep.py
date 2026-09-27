"""Ontario G2/G practice loops. Uses OSRM and Overpass only.

This module does not import or change the scoring engine. Coordinates for
mall units are marked approximate when the public geocoder did not resolve
the DriveTest suite itself.
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Callable, List, Optional

import requests

DISCLAIMER = (
    "Practice suggestions only. These loops are generated from public maps. "
    "They are not official DriveTest routes or examiner paths."
)
OVERPASS_URLS = (
    "https://overpass.openstreetmap.fr/api/interpreter",
    "https://overpass-api.de/api/interpreter",
)
CENTRE_PATH = Path(__file__).resolve().parent / "drivetest_centres.json"

_KIND_FROM_MANEUVER = {
    ("turn", "left"): "left_turn",
    ("turn", "sharp left"): "left_turn",
    ("turn", "slight left"): "left_turn",
    ("turn", "right"): "right_turn",
    ("turn", "sharp right"): "right_turn",
    ("turn", "slight right"): "right_turn",
    ("end of road", "left"): "left_turn",
    ("end of road", "right"): "right_turn",
    ("fork", "left"): "lane_change",
    ("fork", "right"): "lane_change",
    ("merge", ""): "lane_change",
    ("merge", "left"): "lane_change",
    ("merge", "right"): "lane_change",
    ("on ramp", ""): "ramp",
    ("on ramp", "left"): "ramp",
    ("on ramp", "right"): "ramp",
    ("off ramp", ""): "ramp",
    ("off ramp", "left"): "ramp",
    ("off ramp", "right"): "ramp",
    ("roundabout", ""): "roundabout",
    ("rotary", ""): "roundabout",
    ("roundabout turn", ""): "roundabout",
}

_LABELS = {
    "left_turn": "Left turn",
    "right_turn": "Right turn",
    "lane_change": "Lane change or merge",
    "ramp": "Highway on/off ramp",
    "roundabout": "Roundabout",
    "signal": "Traffic signal",
    "stop": "Stop sign",
    "school": "School or community safety zone",
    "crosswalk": "Crosswalk",
}


class TestPrepError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


def list_centres() -> List[dict]:
    payload = json.loads(CENTRE_PATH.read_text(encoding="utf-8"))
    return list(payload.get("centres") or [])


def centre_by_id(centre_id: str) -> dict:
    wanted = (centre_id or "").strip()
    for centre in list_centres():
        if centre.get("id") == wanted:
            return centre
    raise TestPrepError("Choose a DriveTest centre.", 404)


def build_practice_loop(
    centre_id: str,
    level: str = "G2",
    fetch: Optional[Callable] = None,
    osrm_url: str = "https://router.project-osrm.org/route/v1/driving",
) -> dict:
    """Return a loop that starts and ends at the centre, plus practice points."""
    exam = (level or "G2").strip().upper()
    if exam not in {"G2", "G"}:
        raise TestPrepError("Level must be G2 or G.")
    centre = centre_by_id(centre_id)
    getter = fetch or _http_get
    radius_km = 2.2 if exam == "G" else 1.4
    route = None
    last_error = "Routing failed."
    for scale in (1.0, 0.55):
        points = _loop_points(centre["lat"], centre["lon"], radius_km * scale)
        try:
            candidate = _osrm_route(points, getter, osrm_url)
        except TestPrepError as exc:
            last_error = str(exc)
            continue
        if route is None or candidate["distance_m"] < route["distance_m"]:
            route = candidate
        if route["distance_m"] <= 12000:
            break
    if not route:
        raise TestPrepError(last_error, 502)

    geometry = route["geometry"]
    steps = _points_from_steps(route.get("steps") or [], exam)
    overpass_note = ""
    features: List[dict] = []
    try:
        features = _overpass_points(geometry, getter)
    except Exception:
        overpass_note = "Live map features are unavailable. Showing turns from the route shape."
    points_out = _merge_points(steps, features, exam)
    return {
        "centre": {
            "id": centre["id"],
            "name": centre["name"],
            "address": centre["address"],
            "lat": centre["lat"],
            "lon": centre["lon"],
            "coords_approximate": bool(centre.get("coords_approximate")),
        },
        "level": exam,
        "geometry": geometry,
        "distance_m": route["distance_m"],
        "duration_s": route["duration_s"],
        "points": points_out,
        "overpass_note": overpass_note,
        "disclaimer": DISCLAIMER,
    }


def _loop_points(lat: float, lon: float, radius_km: float) -> List[tuple]:
    north = radius_km / 111.0
    east = radius_km / (111.0 * max(0.2, math.cos(math.radians(lat))))
    return [
        (lat, lon),
        (lat + north, lon + east * 0.15),
        (lat + north * 0.25, lon + east),
        (lat - north * 0.55, lon + east * 0.35),
        (lat - north * 0.2, lon - east * 0.75),
        (lat, lon),
    ]


def _osrm_route(points: List[tuple], fetch: Callable, osrm_url: str) -> dict:
    coords = ";".join(f"{lon:.6f},{lat:.6f}" for lat, lon in points)
    url = osrm_url.rstrip("/") + "/" + coords
    data = fetch(url, {
        "overview": "full",
        "geometries": "geojson",
        "steps": "true",
        "alternatives": "false",
    })
    routes = (data or {}).get("routes") or []
    if not routes:
        raise TestPrepError("No practice loop found around this centre.", 502)
    route = routes[0]
    geometry = ((route.get("geometry") or {}).get("coordinates")) or []
    if len(geometry) < 2:
        raise TestPrepError("The router returned an empty loop.", 502)
    steps = []
    for leg in route.get("legs") or []:
        steps.extend(leg.get("steps") or [])
    return {
        "geometry": geometry,
        "distance_m": float(route.get("distance") or 0),
        "duration_s": float(route.get("duration") or 0),
        "steps": steps,
    }


def _points_from_steps(steps: List[dict], level: str) -> List[dict]:
    found = []
    along = 0.0
    for step in steps:
        maneuver = step.get("maneuver") or {}
        kind = _KIND_FROM_MANEUVER.get((maneuver.get("type") or "", maneuver.get("modifier") or ""))
        if kind is None and (maneuver.get("type") or "").startswith("roundabout"):
            kind = "roundabout"
        location = maneuver.get("location") or []
        if kind and len(location) == 2:
            found.append(_point(kind, float(location[0]), float(location[1]), along, level, step.get("name") or ""))
        along += float(step.get("distance") or 0)
    return found


def _overpass_points(geometry: List[list], fetch: Callable) -> List[dict]:
    south, west, north, east = _bbox(geometry)
    query = f"""
[out:json][timeout:8];
(
  node["highway"="traffic_signals"]({south},{west},{north},{east});
  node["highway"="stop"]({south},{west},{north},{east});
  node["highway"="mini_roundabout"]({south},{west},{north},{east});
  node["highway"="crossing"]({south},{west},{north},{east});
  node["amenity"="school"]({south},{west},{north},{east});
  way["junction"="roundabout"]({south},{west},{north},{east});
  way["highway"="motorway_link"]({south},{west},{north},{east});
  way["amenity"="school"]({south},{west},{north},{east});
);
out center 60;
""".strip()
    last = None
    for url in OVERPASS_URLS:
        try:
            data = fetch(url, {"data": query}, method="post")
        except Exception as exc:
            last = exc
            continue
        elements = (data or {}).get("elements") or []
        if elements or data is not None:
            return _features_near_route(elements, geometry)
        last = TestPrepError("Empty Overpass reply")
    if last:
        raise last
    return []


def _features_near_route(elements: List[dict], geometry: List[list]) -> List[dict]:
    samples = geometry[:: max(1, len(geometry) // 80)]
    found = []
    for element in elements:
        lat, lon = _element_latlon(element)
        if lat is None:
            continue
        if _nearest_m(lat, lon, samples) > 70:
            continue
        tags = element.get("tags") or {}
        kind = _kind_from_tags(tags)
        if not kind:
            continue
        found.append(_point(kind, lon, lat, 0, "G", tags.get("name") or ""))
        if len(found) >= 10:
            break
    return found


def _kind_from_tags(tags: dict) -> Optional[str]:
    if tags.get("highway") == "traffic_signals":
        return "signal"
    if tags.get("highway") == "stop":
        return "stop"
    if tags.get("highway") == "crossing":
        return "crosswalk"
    if tags.get("amenity") == "school":
        return "school"
    if tags.get("junction") == "roundabout" or tags.get("highway") == "mini_roundabout":
        return "roundabout"
    if tags.get("highway") == "motorway_link":
        return "ramp"
    return None


def _element_latlon(element: dict):
    if "lat" in element and "lon" in element:
        return float(element["lat"]), float(element["lon"])
    center = element.get("center") or {}
    if "lat" in center and "lon" in center:
        return float(center["lat"]), float(center["lon"])
    return None, None


def _merge_points(steps: List[dict], features: List[dict], level: str) -> List[dict]:
    pool = []
    seen = set()
    for point in features + steps:
        if level == "G2" and point["kind"] == "ramp":
            point = dict(point)
            point["scored"] = False
            point["label"] = "Highway ramp (G test, not required on G2)"
        key = (point["kind"], round(point["lat"], 3), round(point["lon"], 3))
        if key in seen:
            continue
        seen.add(key)
        pool.append(point)
    turns = [point for point in pool if point["kind"] in {"left_turn", "right_turn"}]
    other = [point for point in pool if point["kind"] not in {"left_turn", "right_turn"}]
    return (other + turns[:6])[:14]


def _point(kind: str, lon: float, lat: float, along_m: float, level: str, name: str) -> dict:
    label = _LABELS.get(kind, kind)
    if name and kind in {"school", "signal", "stop"}:
        label = f"{label}: {name}" if kind == "school" else label
    scored = not (level == "G2" and kind == "ramp")
    return {
        "kind": kind,
        "label": label,
        "lat": lat,
        "lon": lon,
        "along_m": round(along_m, 1),
        "scored": scored,
    }


def _bbox(geometry: List[list], pad: float = 0.004):
    lats = [float(pair[1]) for pair in geometry]
    lons = [float(pair[0]) for pair in geometry]
    return min(lats) - pad, min(lons) - pad, max(lats) + pad, max(lons) + pad


def _nearest_m(lat: float, lon: float, samples: List[list]) -> float:
    best = 1e9
    for lon2, lat2 in samples:
        best = min(best, _haversine_m(lat, lon, float(lat2), float(lon2)))
    return best


def _haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    radius = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * radius * math.asin(min(1.0, math.sqrt(a)))


def _http_get(url: str, params: dict, method: str = "get"):
    headers = {"User-Agent": "SmartShieldCapstone/1.0 (Sheridan practice-route demo)"}
    if method == "post":
        response = requests.post(url, data=params, headers=headers, timeout=8)
    else:
        response = requests.get(url, params=params, headers=headers, timeout=20)
    response.raise_for_status()
    return response.json()
