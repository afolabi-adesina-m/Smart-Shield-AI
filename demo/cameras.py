"""Enforcement cameras and variable speed zones.

OpenStreetMap elements are parsed from the same Overpass shapes the map
already requests. City of Toronto red-light and automated speed cameras are
fetched from CKAN, cached for a day, and fall back to a committed snapshot.
Toronto points within 30 m of an OpenStreetMap feature of the same kind are
dropped. Nothing here scores a route.
"""

from __future__ import annotations

import json
import math
import os
import threading
import time
from pathlib import Path
from typing import Callable, Optional

import requests

DISCLAIMER = (
    "Camera locations from OpenStreetMap and City of Toronto open data; may be incomplete."
)
USER_AGENT = "Smart-Shield-AI/1.0 (capstone; https://github.com/afolabi-adesina-m/Smart-Shield-AI)"
REFERER = "https://github.com/afolabi-adesina-m/Smart-Shield-AI"
CKAN = "https://ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action/datastore_search"
TORONTO_RESOURCES = (
    ("red_light", "b57a31a1-5ee6-43e3-bfb9-206ebe93066d"),
    ("speed_camera", "e25e9460-a0e8-469c-b9fb-9a4837ac6c1c"),
)
HIGHWAY_ROADS = {"motorway", "trunk", "motorway_link", "trunk_link"}
HIGHWAY_MODES = {"HIGHWAY", "highway", "motorway", "trunk"}
CITY_M = 250.0
HIGHWAY_M = 400.0
DEDUPE_M = 30.0
ROUTE_CORRIDOR_M = 60.0
AHEAD_DEG = 60.0
CACHE_TTL_S = 24 * 60 * 60

_ROOT = Path(__file__).resolve().parent
SNAPSHOT_PATH = _ROOT / "data" / "toronto_cameras.json"
_lock = threading.Lock()
_memory: dict = {"at": 0.0, "features": None, "path": ""}


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    radius = 6371000.0
    p1 = math.radians(lat1)
    p2 = math.radians(lat2)
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlon / 2) ** 2
    return 2 * radius * math.asin(min(1.0, math.sqrt(a)))


def heading_delta(heading: float, bearing: float) -> float:
    return (bearing - heading + 540.0) % 360.0 - 180.0


def bearing_deg(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1 = math.radians(lat1)
    p2 = math.radians(lat2)
    dlon = math.radians(lon2 - lon1)
    y = math.sin(dlon) * math.cos(p2)
    x = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dlon)
    return (math.degrees(math.atan2(y, x)) + 360.0) % 360.0


def parse_limit(*values) -> Optional[int]:
    """Numeric km/h from an OSM maxspeed-style value. Signals and 'yes' are ignored."""
    for value in values:
        if value is None:
            continue
        text = str(value).strip().lower()
        if not text or text in {"signals", "variable", "yes", "no", "none", "walk", "urban", "rural"}:
            continue
        mph = "mph" in text
        digits = ""
        for char in text:
            if char.isdigit() or (char == "." and digits and "." not in digits):
                digits += char
            elif digits:
                break
        if not digits:
            continue
        number = float(digits)
        if mph:
            number *= 1.60934
        if 5 <= number <= 200:
            return int(round(number))
    return None


def _sample(points: list, limit: int = 40) -> list:
    if len(points) <= limit:
        return points
    step = len(points) / float(limit)
    return [points[int(index * step)] for index in range(limit)]


def _element_points(element: dict, nodes: dict) -> list:
    if element.get("lat") is not None and element.get("lon") is not None:
        return [[float(element["lat"]), float(element["lon"])]]
    center = element.get("center") or {}
    if center.get("lat") is not None and center.get("lon") is not None:
        return [[float(center["lat"]), float(center["lon"])]]
    points = []
    for point in element.get("geometry") or []:
        if isinstance(point, dict) and point.get("lat") is not None and point.get("lon") is not None:
            points.append([float(point["lat"]), float(point["lon"])])
    if points:
        return _sample(points)
    if element.get("type") == "relation":
        ranked = []
        for member in element.get("members") or []:
            role = (member.get("role") or "").lower()
            if role not in {"device", "from"}:
                continue
            lat = member.get("lat")
            lon = member.get("lon")
            if lat is None or lon is None:
                found = nodes.get(member.get("ref"))
                if not found:
                    continue
                lat, lon = found
            rank = 0 if role == "device" else 1
            ranked.append((rank, [float(lat), float(lon)]))
        ranked.sort(key=lambda item: item[0])
        if ranked:
            return [ranked[0][1]]
    return []


def _kind_from_tags(tags: dict) -> Optional[str]:
    highway = (tags.get("highway") or "").lower()
    enforcement = (tags.get("enforcement") or "").lower()
    if highway == "speed_camera" or enforcement in {"maxspeed", "average_speed", "speed"} or "speed" in enforcement:
        if enforcement in {"traffic_signals", "red_light", "traffic_signal"} or "signal" in enforcement or "red_light" in enforcement:
            return "red_light"
        if highway == "speed_camera" or enforcement:
            return "speed_camera"
    if enforcement in {"traffic_signals", "red_light", "traffic_signal"} or (
        enforcement and ("signal" in enforcement or "red" in enforcement)
    ):
        return "red_light"
    variable = tags.get("maxspeed:variable")
    if variable not in {None, ""} or str(tags.get("maxspeed") or "").lower() == "signals":
        return "variable"
    sign = str(tags.get("traffic_sign") or "").lower()
    if "variable" in sign and ("speed" in sign or "maxspeed" in sign):
        return "variable"
    if enforcement:
        return "speed_camera"
    return None


def _road_class(tags: dict) -> Optional[str]:
    highway = (tags.get("highway") or "").lower()
    if highway in HIGHWAY_ROADS:
        return highway
    return None


def parse_overpass(elements) -> list:
    """Cameras and variable-speed ways from an Overpass element list."""
    elements = elements or []
    nodes = {}
    for element in elements:
        if element.get("type") == "node" and element.get("id") is not None and element.get("lat") is not None:
            nodes[element["id"]] = (float(element["lat"]), float(element["lon"]))
    found = []
    for element in elements:
        tags = element.get("tags") or {}
        if element.get("type") == "relation" and (tags.get("type") or "").lower() != "enforcement":
            continue
        if element.get("type") == "relation":
            enforcement = (tags.get("enforcement") or "").lower()
            if enforcement not in {"maxspeed", "traffic_signals"} and "speed" not in enforcement and "signal" not in enforcement:
                continue
        kind = _kind_from_tags(tags)
        if kind is None:
            continue
        points = _element_points(element, nodes)
        if not points:
            continue
        limit = parse_limit(tags.get("maxspeed:variable"), tags.get("maxspeed"), tags.get("maxspeed:forward"))
        midpoint = points[len(points) // 2]
        ident = f"osm:{element.get('type') or 'node'}:{element.get('id')}"
        found.append({
            "id": ident,
            "kind": kind,
            "lat": midpoint[0],
            "lon": midpoint[1],
            "limit_kmh": limit,
            "source": "osm",
            "road_class": _road_class(tags),
            "name": tags.get("name") or tags.get("description") or "",
            "points": points,
        })
    return _collapse(found, 20.0)


def _geometry_point(record: dict):
    geometry = record.get("geometry")
    if isinstance(geometry, str):
        try:
            geometry = json.loads(geometry)
        except json.JSONDecodeError:
            return None
    if not isinstance(geometry, dict):
        return None
    coords = geometry.get("coordinates")
    if not isinstance(coords, (list, tuple)) or len(coords) < 2:
        return None
    try:
        lon = float(coords[0])
        lat = float(coords[1])
    except (TypeError, ValueError):
        return None
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        return None
    return lat, lon


def parse_toronto_record(kind: str, record: dict) -> Optional[dict]:
    point = _geometry_point(record or {})
    if not point:
        return None
    lat, lon = point
    if kind == "red_light":
        ident = record.get("ID") or record.get("RLC") or record.get("_id")
        name = record.get("NAME") or record.get("LINEAR_NAME_FULL_1") or "Red light camera"
        return {
            "id": f"toronto:rlc:{ident}",
            "kind": "red_light",
            "lat": lat,
            "lon": lon,
            "limit_kmh": None,
            "source": "toronto",
            "road_class": None,
            "name": str(name),
            "points": [[lat, lon]],
        }
    status = str(record.get("Status") or "Active").strip().lower()
    if status and status != "active":
        return None
    ident = record.get("FID") or record.get("_id")
    name = record.get("location") or "Speed camera"
    return {
        "id": f"toronto:ase:{ident}",
        "kind": "speed_camera",
        "lat": lat,
        "lon": lon,
        "limit_kmh": parse_limit(record.get("maxspeed"), record.get("SPEED_LIMIT")),
        "source": "toronto",
        "road_class": None,
        "name": str(name),
        "points": [[lat, lon]],
    }


def parse_toronto_records(kind: str, records) -> list:
    features = []
    for record in records or []:
        feature = parse_toronto_record(kind, record)
        if feature:
            features.append(feature)
    return features


def _collapse(features: list, metres: float) -> list:
    kept = []
    for item in features:
        match = None
        for other in kept:
            if other["kind"] != item["kind"]:
                continue
            if haversine_m(item["lat"], item["lon"], other["lat"], other["lon"]) <= metres:
                match = other
                break
        if match is None:
            kept.append(item)
            continue
        if match.get("limit_kmh") is None and item.get("limit_kmh") is not None:
            match["limit_kmh"] = item["limit_kmh"]
    return kept


def dedupe_cameras(osm: list, toronto: list, metres: float = DEDUPE_M) -> list:
    """Keep OpenStreetMap features and Toronto points that are not within ``metres``."""
    kept_osm = [dict(item, points=list(item.get("points") or [[item["lat"], item["lon"]]])) for item in osm or []]
    extra = []
    for item in toronto or []:
        duplicate = None
        for other in kept_osm:
            if other["kind"] != item["kind"]:
                continue
            if haversine_m(item["lat"], item["lon"], other["lat"], other["lon"]) <= metres:
                duplicate = other
                break
        if duplicate is not None:
            if duplicate.get("limit_kmh") is None and item.get("limit_kmh") is not None:
                duplicate["limit_kmh"] = item["limit_kmh"]
            continue
        extra.append(item)
    return kept_osm + extra


def warn_distance_m(feature: dict, road_mode: Optional[str]) -> float:
    if feature.get("road_class") in HIGHWAY_ROADS:
        return HIGHWAY_M
    if (road_mode or "") in HIGHWAY_MODES:
        return HIGHWAY_M
    return CITY_M


def _feature_points(feature: dict) -> list:
    points = feature.get("points") or []
    if points:
        return points
    return [[feature["lat"], feature["lon"]]]


def _distance_to(feature: dict, lat: float, lon: float) -> float:
    return min(haversine_m(lat, lon, point[0], point[1]) for point in _feature_points(feature))


def _on_route(feature: dict, route: list) -> bool:
    if not route:
        return False
    for point in _feature_points(feature):
        for stop in route:
            if haversine_m(point[0], point[1], stop[0], stop[1]) <= ROUTE_CORRIDOR_M:
                return True
    return False


def _ahead_of_heading(feature: dict, lat: float, lon: float, heading: Optional[float]) -> bool:
    if heading is None:
        return False
    nearest = min(_feature_points(feature), key=lambda point: haversine_m(lat, lon, point[0], point[1]))
    bearing = bearing_deg(lat, lon, nearest[0], nearest[1])
    return abs(heading_delta(float(heading), bearing)) <= AHEAD_DEG


def alert_phrase(feature: dict, posted_kmh: Optional[float] = None) -> str:
    limit = feature.get("limit_kmh")
    if limit is None and posted_kmh not in {None, ""}:
        try:
            limit = int(round(float(posted_kmh)))
        except (TypeError, ValueError):
            limit = None
    if feature.get("kind") == "red_light":
        return "Red light camera at the next intersection"
    if feature.get("kind") == "speed_camera":
        if limit:
            return f"Speed camera ahead, limit {int(limit)}"
        return "Speed camera ahead"
    if limit:
        return f"Variable speed limit zone, usually posted {int(limit)}"
    return "Variable speed limit zone"


def alerts_ahead(
    features: list,
    lat: float,
    lon: float,
    *,
    heading: Optional[float] = None,
    route: Optional[list] = None,
    road_mode: Optional[str] = None,
    posted_kmh: Optional[float] = None,
    spoken: Optional[set] = None,
) -> list:
    """Features the driver is approaching, nearest first.

    A route (points still ahead of the driver) must pass near the feature.
    With no route, the feature has to sit in front of ``heading``. Each id in
    ``spoken`` is skipped so a camera is announced once.
    """
    spoken = spoken or set()
    route = route or []
    use_route = len(route) >= 2
    chosen = []
    for feature in features or []:
        ident = feature.get("id")
        if not ident or ident in spoken:
            continue
        distance = _distance_to(feature, lat, lon)
        if distance > warn_distance_m(feature, road_mode) or distance < 15:
            continue
        if use_route:
            if not _on_route(feature, route):
                continue
        elif not _ahead_of_heading(feature, lat, lon, heading):
            continue
        chosen.append((distance, feature))
    chosen.sort(key=lambda item: item[0])
    return [{
        "id": feature["id"],
        "kind": feature["kind"],
        "phrase": alert_phrase(feature, posted_kmh),
        "distance_m": round(distance, 1),
    } for distance, feature in chosen]


def _cache_file(path: Optional[Path] = None) -> Path:
    if path is not None:
        return Path(path)
    raw = os.getenv("CAMERA_CACHE_PATH", "").strip()
    if raw:
        return Path(raw)
    return _ROOT / ".cache" / "toronto_cameras.json"


def read_snapshot(path: Optional[Path] = None) -> list:
    file_path = Path(path) if path else SNAPSHOT_PATH
    try:
        payload = json.loads(file_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    features = payload.get("features") if isinstance(payload, dict) else payload
    if not isinstance(features, list):
        return []
    clean = []
    for feature in features:
        if not isinstance(feature, dict):
            continue
        try:
            lat = float(feature["lat"])
            lon = float(feature["lon"])
        except (KeyError, TypeError, ValueError):
            continue
        if not (-90 <= lat <= 90 and -180 <= lon <= 180):
            continue
        kind = feature.get("kind")
        if kind not in {"red_light", "speed_camera", "variable"}:
            continue
        clean.append({
            "id": str(feature.get("id") or f"toronto:{kind}:{len(clean)}"),
            "kind": kind,
            "lat": lat,
            "lon": lon,
            "limit_kmh": parse_limit(feature.get("limit_kmh")),
            "source": feature.get("source") or "toronto",
            "road_class": feature.get("road_class"),
            "name": str(feature.get("name") or ""),
            "points": [[lat, lon]],
        })
    return clean


def _fetch_resource(kind: str, resource_id: str, get: Callable) -> list:
    headers = {"User-Agent": USER_AGENT, "Referer": REFERER, "Accept": "application/json"}
    offset = 0
    total = None
    records = []
    while total is None or offset < total:
        response = get(CKAN, params={"resource_id": resource_id, "limit": 500, "offset": offset}, headers=headers, timeout=25)
        if getattr(response, "status_code", 200) >= 400:
            raise RuntimeError("Toronto open data did not respond")
        result = (response.json() or {}).get("result") or {}
        batch = result.get("records") or []
        total = int(result.get("total") or len(batch))
        if not batch:
            break
        records.extend(batch)
        offset += len(batch)
        if offset > 5000:
            break
    return parse_toronto_records(kind, records)


def load_toronto_cameras(
    *,
    get: Optional[Callable] = None,
    now: Optional[float] = None,
    cache_path: Optional[Path] = None,
    ttl: float = CACHE_TTL_S,
    use_network: bool = True,
    snapshot_path: Optional[Path] = None,
) -> list:
    """Toronto cameras, from memory, a daily file, the network, or the snapshot."""
    moment = time.time() if now is None else float(now)
    path = _cache_file(cache_path)
    with _lock:
        cached = _memory.get("features")
        if cached is not None and _memory.get("path") == str(path) and moment - float(_memory.get("at") or 0) < ttl:
            return [dict(item) for item in cached]
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        saved_at = float(payload.get("fetched_at") or 0)
        if moment - saved_at < ttl and isinstance(payload.get("features"), list):
            features = read_snapshot_from_payload(payload)
            _remember(features, moment, path)
            return [dict(item) for item in features]
    except (OSError, json.JSONDecodeError, TypeError, ValueError):
        pass
    getter = get or requests.get
    if use_network:
        try:
            features = []
            for kind, resource_id in TORONTO_RESOURCES:
                features.extend(_fetch_resource(kind, resource_id, getter))
            if features:
                _write_cache(path, features, moment)
                _remember(features, moment, path)
                return [dict(item) for item in features]
        except Exception:
            pass
    features = read_snapshot(snapshot_path)
    _remember(features, moment, path)
    return [dict(item) for item in features]


def read_snapshot_from_payload(payload: dict) -> list:
    features = []
    for feature in payload.get("features") or []:
        if not isinstance(feature, dict):
            continue
        try:
            lat = float(feature["lat"])
            lon = float(feature["lon"])
        except (KeyError, TypeError, ValueError):
            continue
        kind = feature.get("kind")
        if kind not in {"red_light", "speed_camera", "variable"}:
            continue
        features.append({
            "id": str(feature.get("id")),
            "kind": kind,
            "lat": lat,
            "lon": lon,
            "limit_kmh": parse_limit(feature.get("limit_kmh")),
            "source": feature.get("source") or "toronto",
            "road_class": feature.get("road_class"),
            "name": str(feature.get("name") or ""),
            "points": [[lat, lon]],
        })
    return features


def _remember(features: list, moment: float, path: Path) -> None:
    with _lock:
        _memory["features"] = [dict(item) for item in features]
        _memory["at"] = moment
        _memory["path"] = str(path)


def _write_cache(path: Path, features: list, moment: float) -> None:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        slim = [{
            "id": item["id"],
            "kind": item["kind"],
            "lat": item["lat"],
            "lon": item["lon"],
            "limit_kmh": item.get("limit_kmh"),
            "source": item.get("source") or "toronto",
            "name": item.get("name") or "",
        } for item in features]
        temporary = path.with_suffix(path.suffix + ".tmp")
        temporary.write_text(json.dumps({"fetched_at": moment, "features": slim}), encoding="utf-8")
        temporary.replace(path)
    except OSError:
        pass


def reset_camera_cache() -> None:
    with _lock:
        _memory["features"] = None
        _memory["at"] = 0.0
        _memory["path"] = ""


def public_features(features: list) -> list:
    return [
        {key: feature.get(key) for key in ("id", "kind", "lat", "lon", "limit_kmh", "source", "road_class", "name")}
        for feature in features or []
    ]


def cameras_near(features: list, lat: float, lon: float, radius_m: float = 4000.0) -> list:
    picked = []
    for feature in features:
        if haversine_m(lat, lon, feature["lat"], feature["lon"]) <= radius_m:
            picked.append(feature)
    return public_features(picked)
