"""Keyless travel modes for /api/directions.

Drive and motorcycle stay on the existing car router in flask_common.
Cycle and walk use public OSRM profiles. Transit uses the community
Transitous MOTIS API. Nothing here invents a time, stop, or line colour.
"""

from __future__ import annotations

import time

import requests

USER_AGENT = "SmartShieldCapstone/1.0 (Sheridan PAIDA academic demo)"
CACHE_TTL_S = 600
FAIL_TTL_S = 45

BIKE_HOSTS = (
    "https://routing.openstreetmap.de/routed-bike/route/v1/bike",
    "https://router.project-osrm.org/route/v1/bike",
)
FOOT_HOSTS = (
    "https://routing.openstreetmap.de/routed-foot/route/v1/foot",
    "https://router.project-osrm.org/route/v1/foot",
)
TRANSIT_URL = "https://api.transitous.org/api/v1/plan"

MODE_LABELS = {
    "BUS": "Bus",
    "TRAM": "Streetcar",
    "SUBWAY": "Subway",
    "RAIL": "Train",
    "REGIONAL_RAIL": "Train",
    "FERRY": "Ferry",
    "WALK": "Walk",
}

NEUTRAL_COLOUR = "#5f6368"

# Keep these in step with mobile/src/modeRoute.ts. A public OSRM bike or
# foot profile sometimes returns a driving-like duration; those are replaced.
CYCLE_KMH = 16.5
WALK_KMH = 4.8
CYCLE_FAST_KMH = 25
WALK_FAST_KMH = 7

_CACHE: dict[str, tuple[float, dict | None]] = {}


class _TryNext(Exception):
    pass


def clear_cache() -> None:
    _CACHE.clear()


def decode_polyline_auto(encoded: str) -> list[list[float]]:
    """Pick the precision whose first point lands on Earth.

    OSRM GeoJSON is not involved here. Transitous MOTIS polylines use
    1e7, while the older Google encoding uses 1e5.
    """
    if not encoded:
        return []
    for precision in (5, 6, 7):
        points = decode_polyline(encoded, precision)
        if _on_earth(points):
            return points
    return []


def _on_earth(points: list[list[float]]) -> bool:
    if not points:
        return False
    lon, lat = points[0]
    return -180 <= lon <= 180 and -90 <= lat <= 90


def decode_polyline(encoded: str, precision: int = 5) -> list[list[float]]:
    """Google-encoded polyline to [lon, lat] pairs. Empty input stays empty."""
    if not encoded:
        return []
    factor = 10 ** precision
    points: list[list[float]] = []
    index = 0
    lat = 0
    lon = 0
    length = len(encoded)
    while index < length:
        lat_change, index = _polyline_delta(encoded, index, length)
        lon_change, index = _polyline_delta(encoded, index, length)
        lat += lat_change
        lon += lon_change
        points.append([lon / factor, lat / factor])
    return points


def _polyline_delta(encoded: str, index: int, length: int) -> tuple[int, int]:
    shift = 0
    result = 0
    while index < length:
        byte = ord(encoded[index]) - 63
        index += 1
        result |= (byte & 0x1F) << shift
        shift += 5
        if byte < 0x20:
            break
    delta = ~(result >> 1) if result & 1 else (result >> 1)
    return delta, index


def directions_for_mode(
    mode: str,
    from_lat: float,
    from_lon: float,
    to_lat: float,
    to_lon: float,
    summary: bool,
) -> dict:
    key = f"{mode}:{round(from_lat, 4)}:{round(from_lon, 4)}:{round(to_lat, 4)}:{round(to_lon, 4)}"
    cached = _CACHE.get(key)
    now = time.time()
    if cached and cached[0] > now:
        if cached[1] is None:
            raise LookupError(_unavailable(mode))
        return _present(cached[1], summary)
    try:
        if mode == "transit":
            payload = _transit(from_lat, from_lon, to_lat, to_lon)
        else:
            payload = _profile(mode, from_lat, from_lon, to_lat, to_lon)
    except LookupError:
        _CACHE[key] = (now + FAIL_TTL_S, None)
        raise
    _CACHE[key] = (now + CACHE_TTL_S, payload)
    return _present(payload, summary)


def _present(payload: dict, summary: bool) -> dict:
    if not summary:
        return payload
    routes = []
    for route in payload.get("routes") or []:
        routes.append({
            "distance": route.get("distance"),
            "duration": route.get("duration"),
            "summary": route.get("summary"),
        })
    body = {
        "mode": payload.get("mode"),
        "routes": routes,
        "note": payload.get("note"),
        "scheduled": payload.get("scheduled"),
    }
    if payload.get("itineraries"):
        body["itineraries"] = [
            {
                "duration_s": item.get("duration_s"),
                "start": item.get("start"),
                "end": item.get("end"),
                "transfers": item.get("transfers"),
                "walk_min": item.get("walk_min"),
                "distance_m": item.get("distance_m"),
                "summary": item.get("summary"),
                "scheduled": item.get("scheduled"),
            }
            for item in payload["itineraries"]
        ]
    return body


def realistic_duration(mode: str, distance_m, duration_s):
    """Return (seconds, estimated). Driving-like bike and walk times are replaced."""
    if mode not in ("cycle", "walk"):
        return duration_s, False
    if not isinstance(distance_m, (int, float)) or distance_m <= 0:
        return duration_s, False
    limit = CYCLE_FAST_KMH if mode == "cycle" else WALK_FAST_KMH
    pace = CYCLE_KMH if mode == "cycle" else WALK_KMH
    if isinstance(duration_s, (int, float)) and duration_s > 0:
        speed = (distance_m / duration_s) * 3.6
        if speed <= limit:
            return duration_s, False
    return round(distance_m / (pace * 1000 / 3600), 1), True


def _unavailable(mode: str) -> str:
    if mode == "cycle":
        return "Bicycle routing is unavailable right now."
    if mode == "walk":
        return "Walking routing is unavailable right now."
    return "Transit routing is unavailable right now."


def _profile(mode: str, from_lat: float, from_lon: float, to_lat: float, to_lon: float) -> dict:
    hosts = BIKE_HOSTS if mode == "cycle" else FOOT_HOSTS
    coords = f"{from_lon},{from_lat};{to_lon},{to_lat}"
    last_error = _unavailable(mode)
    for base in hosts:
        try:
            data = _get_json(f"{base}/{coords}", {
                "alternatives": "true",
                "overview": "full",
                "geometries": "geojson",
                "steps": "true",
            })
        except _TryNext as exc:
            last_error = str(exc) or last_error
            continue
        if data.get("code") != "Ok" or not data.get("routes"):
            last_error = data.get("message") or last_error
            continue
        estimated = False
        built = []
        for index, route in enumerate(data["routes"][:3]):
            duration, changed = realistic_duration(mode, route.get("distance"), route.get("duration"))
            if changed:
                route = dict(route)
                route["duration"] = duration
                estimated = True
            built.append(_osrm_route(index, route))
        note = None
        if estimated:
            pace = CYCLE_KMH if mode == "cycle" else WALK_KMH
            kind = "Bicycle" if mode == "cycle" else "Walking"
            note = (
                f"{kind} time is estimated at {pace} km/h from the route distance. "
                "The router returned a driving-like duration."
            )
        body = {
            "mode": mode,
            "router": base,
            "routes": built,
        }
        if note:
            body["note"] = note
        return body
    raise LookupError(last_error if last_error else _unavailable(mode))


def _osrm_route(index: int, route: dict) -> dict:
    from flask_common import _route_label
    from road_preview import steps_from_route

    geom = (route.get("geometry") or {}).get("coordinates") or []
    mid = geom[len(geom) // 2] if geom else None
    distance = route.get("distance")
    duration = route.get("duration")
    km = (distance or 0) / 1000
    minutes = (duration or 0) / 60
    return {
        "distance": distance,
        "duration": duration,
        "summary": _route_label(index, km, minutes),
        "geometry": geom,
        "mid_lon": mid[0] if mid else None,
        "mid_lat": mid[1] if mid else None,
        "steps": steps_from_route(route),
    }


def _transit(from_lat: float, from_lon: float, to_lat: float, to_lon: float) -> dict:
    try:
        data = _get_json(TRANSIT_URL, {
            "fromPlace": f"{from_lat},{from_lon}",
            "toPlace": f"{to_lat},{to_lon}",
            "numItineraries": "3",
        })
    except _TryNext as exc:
        raise LookupError(str(exc) or _unavailable("transit")) from exc
    itineraries = []
    for raw in (data.get("itineraries") or [])[:3]:
        built = _itinerary(raw)
        if built:
            itineraries.append(built)
    if not itineraries:
        raise LookupError("No transit itinerary was returned for these places.")
    scheduled = any(item["scheduled"] for item in itineraries)
    note = None
    if scheduled:
        note = "Scheduled times from Transitous. Not live departures."
    routes = [_itinerary_route(item) for item in itineraries]
    return {
        "mode": "transit",
        "router": "api.transitous.org",
        "scheduled": scheduled,
        "note": note,
        "itineraries": itineraries,
        "routes": routes,
    }


def _itinerary(raw: dict) -> dict | None:
    legs = [_leg(item) for item in (raw.get("legs") or [])]
    legs = [leg for leg in legs if leg]
    if not legs or raw.get("duration") is None:
        return None
    distances = [leg["distance_m"] for leg in legs if isinstance(leg.get("distance_m"), (int, float))]
    # A bus or train leg often omits distance. Summing the walks alone would
    # look like a tiny trip, so the distance stays blank instead of a guess.
    distance_known = all(
        leg["mode"] == "WALK" or isinstance(leg.get("distance_m"), (int, float)) for leg in legs
    )
    walk_seconds = [
        leg["duration_s"] for leg in legs
        if leg["mode"] == "WALK" and isinstance(leg.get("duration_s"), (int, float))
    ]
    scheduled = any(not leg["realtime"] for leg in legs)
    return {
        "duration_s": raw.get("duration"),
        "start": raw.get("startTime"),
        "end": raw.get("endTime"),
        "transfers": raw.get("transfers"),
        "walk_min": round(sum(walk_seconds) / 60) if walk_seconds else None,
        "distance_m": sum(distances) if distance_known and distances else None,
        "summary": _summary(legs),
        "scheduled": scheduled,
        "walk_notes": _walk_notes(legs),
        "legs": legs,
    }


def _walk_notes(legs: list[dict]) -> list[str]:
    """Say when Transitous left a walk out. Do not invent a path."""
    notes: list[str] = []
    if not legs:
        return notes
    if legs[0]["mode"] != "WALK":
        notes.append("Transitous did not include the walk to the first stop.")
    for index, leg in enumerate(legs[:-1]):
        nxt = legs[index + 1]
        if leg["mode"] != "WALK" and nxt["mode"] != "WALK":
            origin = leg.get("to_name") or "the vehicle"
            dest = nxt.get("from_name") or "the next vehicle"
            notes.append(f"Transitous did not include the walk between {origin} and {dest}.")
    if legs[-1]["mode"] != "WALK":
        notes.append("Transitous did not include the walk from the last stop to the destination.")
    for leg in legs:
        if leg["mode"] == "WALK" and len(leg.get("geometry") or []) < 2:
            notes.append(f"Transitous did not include a path for the walk to {leg.get('to_name') or 'the stop'}.")
    return notes


def _leg(raw: dict) -> dict | None:
    mode = str(raw.get("mode") or "").upper()
    if mode == "FOOT":
        mode = "WALK"
    if not mode:
        return None
    geometry = decode_polyline_auto(((raw.get("legGeometry") or {}).get("points")) or "")
    colour = _hex_colour(raw.get("routeColor"))
    stops = []
    for stop in raw.get("intermediateStops") or []:
        name = (stop.get("name") or "").strip()
        if not name and stop.get("lat") is None:
            continue
        stops.append({
            "name": name,
            "lat": stop.get("lat"),
            "lon": stop.get("lon"),
        })
    origin = raw.get("from") or {}
    dest = raw.get("to") or {}
    duration = raw.get("duration")
    distance = raw.get("distance")
    walk_min = None
    if mode == "WALK" and isinstance(duration, (int, float)):
        walk_min = max(1, round(duration / 60)) if duration >= 30 else 0
    line = (raw.get("routeShortName") or "").strip() or None
    return {
        "mode": mode,
        "line": line,
        "long_name": (raw.get("routeLongName") or "").strip() or None,
        "color": colour,
        "color_missing": colour is None and mode != "WALK",
        "draw_color": colour or ("#1a73e8" if mode == "WALK" else NEUTRAL_COLOUR),
        "headsign": (raw.get("headsign") or "").strip() or None,
        "agency": (raw.get("agencyName") or "").strip() or None,
        "from_name": (origin.get("name") or "").strip() or None,
        "to_name": (dest.get("name") or "").strip() or None,
        "departure": origin.get("departure") or raw.get("startTime"),
        "arrival": dest.get("arrival") or raw.get("endTime"),
        "stop_count": len(stops),
        "stops": stops,
        "duration_s": duration,
        "distance_m": distance if isinstance(distance, (int, float)) else None,
        "walk_min": walk_min,
        "realtime": bool(raw.get("realTime")),
        "geometry": geometry,
    }


def _itinerary_route(item: dict) -> dict:
    geometry: list[list[float]] = []
    for leg in item["legs"]:
        for point in leg.get("geometry") or []:
            if geometry and geometry[-1] == point:
                continue
            geometry.append(point)
    mid = geometry[len(geometry) // 2] if geometry else None
    return {
        "distance": item.get("distance_m"),
        "duration": item.get("duration_s"),
        "summary": item.get("summary"),
        "geometry": geometry,
        "mid_lon": mid[0] if mid else None,
        "mid_lat": mid[1] if mid else None,
        "steps": [],
        "legs": item["legs"],
    }


def _summary(legs: list[dict]) -> str:
    parts = []
    for leg in legs:
        if leg["mode"] == "WALK":
            continue
        label = MODE_LABELS.get(leg["mode"], leg["mode"].replace("_", " ").title())
        parts.append(f"{label} {leg['line']}".strip() if leg.get("line") else label)
    if not parts:
        return "Walk"
    return " · ".join(parts)


def _hex_colour(raw) -> str | None:
    text = str(raw or "").strip().lstrip("#")
    if len(text) == 6 and all(ch in "0123456789abcdefABCDEF" for ch in text):
        return "#" + text.lower()
    return None


def _get_json(url: str, params: dict) -> dict:
    try:
        response = requests.get(
            url,
            params=params,
            headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
            timeout=12,
        )
    except requests.RequestException as exc:
        raise _TryNext("The routing service did not respond.") from exc
    if response.status_code in (429, 500, 502, 503, 504):
        raise _TryNext("The routing service is busy.")
    if response.status_code >= 400:
        raise _TryNext("The routing service rejected the request.")
    try:
        return response.json()
    except ValueError as exc:
        raise _TryNext("The routing service returned an unreadable response.") from exc
