"""Ontario G2/G practice loops. Uses OSRM and Overpass only.

This module does not import or change the scoring engine. Coordinates for
mall units are marked approximate when the public geocoder did not resolve
the DriveTest suite itself.
"""

from __future__ import annotations

import json
import math
import re
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
    radius_km = 2.4 if exam == "G" else 1.8
    lat, lon = float(centre["lat"]), float(centre["lon"])
    elements = _public_elements(lat, lon, getter, radius_km)
    rings = _candidate_rings(lat, lon, elements, radius_km)
    if not rings:
        rings = [_offset_ring(lat, lon, radius_km * scale) for scale in (1.0, 0.7)]
    route = None
    best = None
    best_key = None
    last_error = "Routing failed."
    for via in rings[:3]:
        if len(via) < 3:
            continue
        for ordered in _ring_orders(via):
            points = [(lat, lon)] + ordered + [(lat, lon)]
            try:
                candidate = _osrm_route(points, getter, osrm_url)
            except TestPrepError as exc:
                last_error = str(exc)
                continue
            faults = _circuit_faults(candidate, lat, lon)
            serious = [fault for fault in faults if fault != "revisit"]
            key = (len(set(serious)), len(set(faults)), float(candidate["distance_m"]))
            if best is None or key < best_key:
                best = candidate
                best_key = key
            if not faults:
                route = candidate
                break
        if route:
            break
    route = route or best
    if not route:
        raise TestPrepError(last_error, 502)
    route["geometry"] = _strip_spurs(route["geometry"])
    route["geometry"] = _pin_ends(route["geometry"], lat, lon)

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


_THROUGH = {"trunk", "primary", "secondary", "tertiary", "unclassified", "residential"}
_RANK = {"trunk": 0, "primary": 0, "secondary": 1, "tertiary": 2, "unclassified": 3, "residential": 4}
# Parking aisles, park paths, and freeway collectors are not practice streets.
_SKIP_WAY_NAME = re.compile(
    r"parking|parkade|service road|collector|expressway|"
    r"\b(garden|gardens|grove|trail|crescent|court|lane|mews|park)\b",
    re.I,
)
_FREEWAY_NAME = re.compile(r"highway|collector|expressway|freeway", re.I)
_SPUR_NAME = re.compile(r"\b(garden|gardens|grove|trail|crescent|court|lane|mews)\b", re.I)
_PARK_ROAD = re.compile(r"\bpark\b", re.I)


def _ring_orders(via: List[tuple]) -> List[List[tuple]]:
    """Clockwise and counter-clockwise rotations. The first is the bearing order."""
    if len(via) > 4:
        return [via, list(reversed(via))]
    orders = []
    for sequence in (via, list(reversed(via))):
        for shift in range(len(sequence)):
            orders.append(sequence[shift:] + sequence[:shift])
    return orders


def _offset_ring(lat: float, lon: float, radius_km: float) -> List[tuple]:
    north = radius_km / 111.0
    east = radius_km / (111.0 * max(0.2, math.cos(math.radians(lat))))
    return [
        (lat + north, lon),
        (lat + north * 0.5, lon + east),
        (lat - north * 0.5, lon + east * 0.6),
        (lat - north, lon - east * 0.2),
        (lat, lon - east),
    ]


def _public_elements(lat: float, lon: float, fetch: Callable, radius_km: float) -> List[dict]:
    """Through-street geometries around the centre. Empty when Overpass is down."""
    meters = int(max(radius_km, 2.2) * 1000)
    query = f"""
[out:json][timeout:18];
way(around:{meters},{lat},{lon})["highway"~"^(trunk|primary|secondary|tertiary|unclassified|residential)$"];
out geom;
""".strip()
    for url in OVERPASS_URLS:
        try:
            data = fetch(url, {"data": query}, method="post")
        except Exception:
            continue
        elements = (data or {}).get("elements") or []
        if elements:
            return elements
    return []


def _candidate_rings(lat: float, lon: float, elements: List[dict], radius_km: float) -> List[List[tuple]]:
    """Arterial circuits first, then a wider street ring if the tight one cannot route."""
    # Near-side bearings first so the loop stays on arterials beside the centre
    # instead of hopping a freeway to hit a due-east point.
    specs = (
        (1.0, (30, 230, 285), 2),
        (1.3, (15, 200, 290), 2),
        (1.6, (0, 90, 180, 270), 1),
        (min(2.2, radius_km + 0.4), (20, 110, 200, 290), 2),
    )
    rings = []
    seen = set()
    for target, bearings, max_rank in specs:
        ring = _waypoints_from_ways(
            lat, lon, elements, target_km=target, bearings=bearings, max_rank=max_rank,
        )
        if len(ring) < 3:
            continue
        key = tuple((round(point[0], 3), round(point[1], 3)) for point in ring)
        if key in seen:
            continue
        seen.add(key)
        rings.append(ring)
    return rings


def _waypoints_from_ways(
    lat: float,
    lon: float,
    elements: List[dict],
    target_km: float = 1.6,
    sectors: int = 6,
    max_rank: int = 4,
    bearings: Optional[List[float]] = None,
) -> List[tuple]:
    ways = []
    ends: dict = {}
    expressway = []
    blocked_names = set()
    blocked_points = []
    for element in elements or []:
        tags = element.get("tags") or {}
        name = tags.get("name") or ""
        if tags.get("expressway") == "yes" or tags.get("highway") in {"motorway", "motorway_link"}:
            if name:
                blocked_names.add(name)
            for point in element.get("geometry") or []:
                if "lat" in point:
                    expressway.append((float(point["lat"]), float(point["lon"])))
        elif name and _SKIP_WAY_NAME.search(name):
            for point in (element.get("geometry") or [])[::3]:
                if "lat" in point:
                    blocked_points.append((float(point["lat"]), float(point["lon"])))
    for element in elements or []:
        if element.get("type") != "way":
            continue
        tags = element.get("tags") or {}
        highway = tags.get("highway") or ""
        if highway not in _THROUGH or highway not in _RANK:
            continue
        rank = _RANK[highway]
        if rank > max_rank:
            continue
        if tags.get("access") in {"private", "no", "customers"}:
            continue
        if tags.get("motor_vehicle") in {"private", "no"}:
            continue
        if tags.get("expressway") == "yes" or tags.get("motorroad") == "yes":
            continue
        name = tags.get("name") or ""
        if not name or name in blocked_names or _SKIP_WAY_NAME.search(name):
            continue
        geom = element.get("geometry") or []
        coords = [(float(point["lat"]), float(point["lon"])) for point in geom if "lat" in point]
        if len(coords) < 2:
            continue
        ways.append((rank, name, coords))
        for index, point in enumerate(coords):
            if index not in (0, len(coords) - 1):
                continue
            key = (round(point[0], 5), round(point[1], 5))
            ends[key] = ends.get(key, 0) + 1
    through = []
    for rank, name, coords in ways:
        start = (round(coords[0][0], 5), round(coords[0][1], 5))
        finish = (round(coords[-1][0], 5), round(coords[-1][1], 5))
        # Arterials continue past the search window, so a free end is not a cul-de-sac.
        if rank > 1 and (ends.get(start, 0) < 2 or ends.get(finish, 0) < 2):
            continue
        through.append((rank, name, coords))
    express_samples = expressway[:: max(1, len(expressway) // 80)] if expressway else []
    chosen = []
    used_names = set()
    blocked_samples = [(pair[1], pair[0]) for pair in blocked_points[:: max(1, len(blocked_points) // 100 or 1)]]
    aims = list(bearings) if bearings else [sector * (360.0 / sectors) for sector in range(sectors)]
    for aim in aims:
        ideal = _destination(lat, lon, aim, target_km)
        best = None
        best_name = ""
        best_score = 1e9
        for rank, name, coords in through:
            if name in used_names:
                continue
            point, offset_m = _clear_point(
                coords, ideal[0], ideal[1], lat, lon, express_samples, blocked_samples,
            )
            if point is None:
                continue
            # An arterial a block off the ideal beats a side street sitting on it.
            score = offset_m + rank * 900
            if score < best_score:
                best_score = score
                best = point
                best_name = name
        if best and all(_haversine_m(best[0], best[1], other[0], other[1]) > 400 for other in chosen):
            chosen.append(best)
            if best_name:
                used_names.add(best_name)
    chosen.sort(key=lambda point: _bearing(lat, lon, point[0], point[1]))
    return chosen[:6]


def _circuit_faults(route: dict, lat: float, lon: float) -> List[str]:
    """Reasons a driven line is not a public-street circuit around the centre."""
    faults = []
    if float(route.get("distance_m") or 0) > 16000:
        faults.append("long")
    farthest = 0.0
    geometry = route.get("geometry") or []
    for pair in geometry[:: max(1, len(geometry) // 80)]:
        if len(pair) < 2:
            continue
        farthest = max(farthest, _haversine_m(lat, lon, float(pair[1]), float(pair[0])))
    if farthest > 3400:
        faults.append("far")
    if _revisit_count(geometry) >= 1:
        faults.append("revisit")
    chunks = []
    for step in route.get("steps") or []:
        maneuver = step.get("maneuver") or {}
        kind = maneuver.get("type") or ""
        name = step.get("name") or ""
        dist = float(step.get("distance") or 0)
        modifier = maneuver.get("modifier") or ""
        if kind in {"on ramp", "off ramp"} or (kind == "merge" and (not name or _FREEWAY_NAME.search(name))):
            faults.append("freeway")
        if (modifier == "uturn" or kind == "uturn") and dist > 150:
            faults.append("uturn")
        if _FREEWAY_NAME.search(name) or "parking" in name.lower() or "parkade" in name.lower():
            faults.append("restricted")
        if dist > 100 and (_SPUR_NAME.search(name) or _PARK_ROAD.search(name)):
            faults.append("spur-street")
        if name and dist >= 120:
            if chunks and chunks[-1][0] == name:
                chunks[-1][1] += dist
            else:
                chunks.append([name, dist])
    seen = {}
    for name, dist in chunks:
        seen.setdefault(name, []).append(dist)
    home = chunks[0][0] if chunks else ""
    for name, dists in seen.items():
        if name == home:
            continue
        dists.sort(reverse=True)
        # A second long stretch on the same street is an out-and-back, not the short
        # return from the loop onto the centre's access road.
        if len(dists) >= 2 and dists[1] >= 700:
            faults.append("backtrack")
            break
    return faults


def _revisit_count(geometry: List[list]) -> int:
    """How many samples come back near an earlier part of the drive, a spur or double-back."""
    if len(geometry) < 8:
        return 0
    samples = []
    walked = 0.0
    previous = geometry[0]
    samples.append((0.0, previous))
    for pair in geometry[1:]:
        if len(pair) < 2 or len(previous) < 2:
            previous = pair
            continue
        walked += _haversine_m(float(previous[1]), float(previous[0]), float(pair[1]), float(pair[0]))
        if walked - samples[-1][0] >= 90:
            samples.append((walked, pair))
        previous = pair
    revisits = 0
    for index, (along, point) in enumerate(samples):
        for later, other in samples[index + 5:]:
            gap = later - along
            # Short out-and-back spurs. A loop that briefly rejoins its start road is kept.
            if gap < 200 or gap > 950:
                continue
            if _haversine_m(float(point[1]), float(point[0]), float(other[1]), float(other[0])) < 45:
                revisits += 1
                break
    return revisits


def _destination(lat: float, lon: float, bearing_deg: float, distance_km: float) -> tuple:
    bearing = math.radians(bearing_deg)
    north = distance_km / 111.0
    east = distance_km / (111.0 * max(0.2, math.cos(math.radians(lat))))
    return lat + north * math.cos(bearing), lon + east * math.sin(bearing)


def _separated_by_expressway(lat: float, lon: float, point_lat: float, point_lon: float, expressway: List[tuple]) -> bool:
    """True when the waypoint sits past a freeway that lies between it and the centre."""
    dist = _haversine_m(lat, lon, point_lat, point_lon)
    heading = _bearing(lat, lon, point_lat, point_lon)
    for elat, elon in expressway[:: max(1, len(expressway) // 120)]:
        freeway = _haversine_m(lat, lon, elat, elon)
        if freeway > dist - 40:
            continue
        delta = abs(((_bearing(lat, lon, elat, elon) - heading + 180) % 360) - 180)
        if delta < 26:
            return True
    return False


def _clear_point(coords, ideal_lat, ideal_lon, centre_lat, centre_lon, expressway, blocked):
    """Point on a street near the ideal, off freeways, park roads, and parking aisles."""
    express_samples = [(pair[1], pair[0]) for pair in expressway] if expressway else []
    best = None
    best_m = 1e9
    for start, end in zip(coords, coords[1:]):
        for point in (start, end):
            offset = _haversine_m(ideal_lat, ideal_lon, point[0], point[1])
            if offset > 1300 or offset >= best_m:
                continue
            centre_m = _haversine_m(centre_lat, centre_lon, point[0], point[1])
            if not (450 <= centre_m <= 3000):
                continue
            if express_samples and _nearest_m(point[0], point[1], express_samples) < 80:
                continue
            if expressway and _separated_by_expressway(centre_lat, centre_lon, point[0], point[1], expressway):
                continue
            if blocked and _nearest_m(point[0], point[1], blocked) < 45:
                continue
            best_m = offset
            best = point
    return best, best_m


def _closest_on_way(coords: List[tuple], lat: float, lon: float):
    best = None
    best_m = 1e9
    for start, end in zip(coords, coords[1:]):
        for step in (0.0, 0.5, 1.0):
            point = (start[0] + (end[0] - start[0]) * step, start[1] + (end[1] - start[1]) * step)
            dist = _haversine_m(lat, lon, point[0], point[1])
            if dist < best_m:
                best_m = dist
                best = point
    return best, best_m


def _bearing(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    delta = math.radians(lon2 - lon1)
    y = math.sin(delta) * math.cos(phi2)
    x = math.cos(phi1) * math.sin(phi2) - math.sin(phi1) * math.cos(phi2) * math.cos(delta)
    return (math.degrees(math.atan2(y, x)) + 360) % 360


def _pin_ends(geometry: List[list], lat: float, lon: float) -> List[list]:
    pin = [round(lon, 6), round(lat, 6)]
    body = [list(pair) for pair in geometry if len(pair) >= 2]
    if body and _haversine_m(lat, lon, float(body[0][1]), float(body[0][0])) < 25:
        body = body[1:]
    if body and _haversine_m(lat, lon, float(body[-1][1]), float(body[-1][0])) < 25:
        body = body[:-1]
    return [pin] + body + [pin]


def _strip_spurs(coords: List[list]) -> List[list]:
    """Drop out-and-back spurs. The overall loop from start back to start is kept."""
    points = [list(pair) for pair in coords if len(pair) >= 2]
    changed = True
    while changed and len(points) > 4:
        changed = False
        for index in range(1, len(points) - 2):
            window_m = 0.0
            for follow in range(index + 1, min(index + 50, len(points) - 1)):
                window_m += _haversine_m(
                    float(points[follow - 1][1]), float(points[follow - 1][0]),
                    float(points[follow][1]), float(points[follow][0]),
                )
                if window_m > 450:
                    break
                gap = _haversine_m(
                    float(points[index][1]), float(points[index][0]),
                    float(points[follow][1]), float(points[follow][0]),
                )
                if window_m < 120 or gap > 40:
                    continue
                mid = points[(index + follow) // 2]
                bulge = _haversine_m(
                    float(points[index][1]), float(points[index][0]),
                    float(mid[1]), float(mid[0]),
                )
                if bulge > 70:
                    del points[index + 1:follow]
                    changed = True
                    break
            if changed:
                break
    return points


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
        response = requests.post(url, data=params, headers=headers, timeout=20)
    else:
        response = requests.get(url, params=params, headers=headers, timeout=20)
    response.raise_for_status()
    return response.json()
