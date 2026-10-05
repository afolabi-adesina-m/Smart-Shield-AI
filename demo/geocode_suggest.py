"""Address autocomplete for the map search box.

Default provider is the public Photon (Komoot) API, which is meant for
typeahead. Nominatim's public service asks callers not to use it for
autocomplete, so it is only a backup if Photon fails, or an explicit
GEOCODE_PROVIDER=nominatim choice. Nominatim stays at one request per
second. Photon autocomplete is faster, and every call sends an identifying
User-Agent and Referer.

Google Places and Mapbox are optional. Set GEOCODE_PROVIDER and the matching
key; if the key is missing, suggestions fall back to Photon.

Results are biased toward Ontario (the demo's highway region) without
dropping matches elsewhere: Photon gets a Toronto location bias, and Canadian
/ Ontario hits are sorted first. A successful Photon response is returned
immediately. Nominatim is only a backup when Photon fails or returns nothing,
and it stays at one request per second. Photon autocomplete is paced faster
so typing is not stuck behind that backup.
"""

from __future__ import annotations

import os
import threading
import time
from typing import Any, Callable, Dict, List, Optional, Tuple
from urllib.parse import quote

import requests

# Nominatim's usage policy requires a real application identity and a Referer.
USER_AGENT = "Smart-Shield-AI/1.0 (capstone; https://github.com/afolabi-adesina-m/Smart-Shield-AI)"
REFERER = "https://github.com/afolabi-adesina-m/Smart-Shield-AI"
GEOCODE_HEADERS = {"User-Agent": USER_AGENT, "Referer": REFERER}
MIN_CHARS = 3
MAX_CHARS = 120
RESULT_LIMIT = 6
# Nominatim's public policy is one request per second. Photon is the
# typeahead provider and is paced separately so a keystroke is not queued
# behind that slower backup.
MIN_INTERVAL_S = 1.0
PHOTON_INTERVAL_S = 0.3
CACHE_TTL_S = 120

# Downtown Toronto — center of the Ontario highway demo, not a hard filter.
ONTARIO_BIAS_LAT = 43.6532
ONTARIO_BIAS_LON = -79.3832

PHOTON_URL = "https://photon.komoot.io/api/"
PHOTON_REVERSE_URL = "https://photon.komoot.io/reverse"
NOMINATIM_REVERSE_URL = "https://nominatim.openstreetmap.org/reverse"
# left, top, right, bottom — Ontario, used only as a Nominatim viewbox bias.
ONTARIO_VIEWBOX = "-95.16,56.86,-74.34,41.66"

_lock = threading.Lock()
_photon_last = 0.0
_other_last = 0.0
_cache: Dict[Tuple, Tuple[float, dict]] = {}


def configured_provider() -> str:
    name = os.getenv("GEOCODE_PROVIDER", "photon").strip().lower()
    if name not in {"photon", "nominatim", "google", "mapbox"}:
        return "photon"
    return name


def provider_ready(name: Optional[str] = None) -> bool:
    provider = name or configured_provider()
    if provider == "google":
        return bool(os.getenv("GOOGLE_PLACES_API_KEY", "").strip())
    if provider == "mapbox":
        return bool(os.getenv("MAPBOX_ACCESS_TOKEN", "").strip())
    return True


def _bias(lat: Optional[float], lon: Optional[float]) -> Tuple[float, float]:
    if lat is None or lon is None:
        return ONTARIO_BIAS_LAT, ONTARIO_BIAS_LON
    try:
        lat_f = float(lat)
        lon_f = float(lon)
    except (TypeError, ValueError):
        return ONTARIO_BIAS_LAT, ONTARIO_BIAS_LON
    if not (-90 <= lat_f <= 90 and -180 <= lon_f <= 180):
        return ONTARIO_BIAS_LAT, ONTARIO_BIAS_LON
    return lat_f, lon_f


def _rank(item: dict) -> int:
    state = (item.get("state") or "").strip().lower()
    country = (item.get("countrycode") or "").strip().upper()
    if country == "CA" and state in {"ontario", "on"}:
        return 0
    if country == "CA":
        return 1
    return 2


def rank_suggestions(items: List[dict]) -> List[dict]:
    """Stable sort: Ontario, then the rest of Canada, then everywhere else."""
    return sorted(items, key=_rank)


def dedupe_suggestions(items: List[dict]) -> List[dict]:
    seen = set()
    out = []
    for item in items:
        key = (
            (item.get("label") or "").strip().lower(),
            (item.get("detail") or "").strip().lower(),
        )
        if key in seen:
            continue
        seen.add(key)
        out.append(item)
    return out


def _join_detail(parts: List[Optional[str]], title: str) -> str:
    detail = []
    title_l = title.lower()
    for part in parts:
        if not part:
            continue
        text = str(part).strip()
        if not text or text.lower() in title_l:
            continue
        if text not in detail:
            detail.append(text)
    return ", ".join(detail)


def suggestion_from_photon(feature: dict) -> Optional[dict]:
    props = feature.get("properties") or {}
    coords = (feature.get("geometry") or {}).get("coordinates") or []
    if len(coords) < 2:
        return None
    house = props.get("housenumber")
    street = props.get("street")
    name = props.get("name")
    if house and street:
        label = f"{house} {street}"
    elif name:
        label = str(name)
    elif street:
        label = str(street)
    else:
        label = str(props.get("city") or props.get("state") or "Place")
    detail = _join_detail(
        [props.get("city") or props.get("locality"), props.get("state"), props.get("country")],
        label,
    )
    osm_type = props.get("osm_type") or "W"
    osm_id = props.get("osm_id") or ""
    return {
        "id": f"photon:{osm_type}:{osm_id}",
        "label": label,
        "detail": detail,
        "lat": float(coords[1]),
        "lon": float(coords[0]),
        "countrycode": props.get("countrycode") or "",
        "state": props.get("state") or "",
    }


def suggestion_from_nominatim(hit: dict) -> Optional[dict]:
    try:
        lat = float(hit["lat"])
        lon = float(hit["lon"])
    except (KeyError, TypeError, ValueError):
        return None
    address = hit.get("address") or {}
    label = hit.get("display_name") or "Place"
    # Prefer a short title; keep the full line in the detail when it is long.
    name = address.get("road") or address.get("pedestrian") or address.get("neighbourhood")
    city = address.get("city") or address.get("town") or address.get("village")
    if name and city:
        short = name
    elif address.get("city") or address.get("town") or address.get("village"):
        short = city
    else:
        short = label.split(",")[0].strip()
    state = address.get("state") or ""
    country = address.get("country") or ""
    detail = _join_detail([city, state, country], short)
    if not detail and label != short:
        detail = label
    return {
        "id": f"nominatim:{hit.get('osm_type', 'W')}:{hit.get('osm_id', '')}",
        "label": short or label,
        "detail": detail,
        "lat": lat,
        "lon": lon,
        "countrycode": (address.get("country_code") or "").upper(),
        "state": state,
    }


def suggestion_from_mapbox(feature: dict) -> Optional[dict]:
    center = feature.get("center") or []
    if len(center) < 2:
        return None
    place = feature.get("place_name") or feature.get("text") or "Place"
    label = feature.get("text") or place.split(",")[0]
    detail = place if place != label else ""
    context = " ".join(
        (item.get("text") or "") for item in (feature.get("context") or [])
    ).lower()
    country = ""
    state = ""
    for item in feature.get("context") or []:
        iid = item.get("id") or ""
        if iid.startswith("country"):
            country = (item.get("short_code") or "").upper()
        if iid.startswith("region"):
            state = item.get("text") or ""
    if "canada" in context or country in {"CA", "CAN"}:
        country = "CA"
    return {
        "id": f"mapbox:{feature.get('id', '')}",
        "label": label,
        "detail": detail,
        "lat": float(center[1]),
        "lon": float(center[0]),
        "countrycode": country,
        "state": state,
    }


def suggestion_from_google_prediction(pred: dict) -> dict:
    fmt = pred.get("structured_formatting") or {}
    return {
        "id": pred.get("place_id") or "",
        "label": fmt.get("main_text") or pred.get("description") or "Place",
        "detail": fmt.get("secondary_text") or "",
        "lat": None,
        "lon": None,
        "countrycode": "CA" if "Canada" in (pred.get("description") or "") else "",
        "state": "Ontario" if ", ON" in (pred.get("description") or "") else "",
    }


def _get(url: str, params: dict, get: Callable, timeout: float = 8) -> Any:
    try:
        resp = get(url, params=params, headers=dict(GEOCODE_HEADERS), timeout=timeout)
    except requests.RequestException as exc:
        raise RuntimeError("Geocoder request failed") from exc
    status = getattr(resp, "status_code", 200)
    if status >= 400:
        raise RuntimeError(f"Geocoder HTTP {status}")
    return resp.json()


def _reserve_upstream_slot(min_interval: float, kind: str = "other") -> None:
    """Pace one upstream. Photon autocomplete does not wait on Nominatim."""
    global _photon_last, _other_last
    with _lock:
        last = _photon_last if kind == "photon" else _other_last
        wait = min_interval - (time.time() - last)
        if wait > 0:
            time.sleep(wait)
        now = time.time()
        if kind == "photon":
            _photon_last = now
        else:
            _other_last = now


def reserve_upstream_slot(min_interval: float = MIN_INTERVAL_S) -> None:
    """Pace for single-place lookup. Nominatim stays at one request per second."""
    _reserve_upstream_slot(min_interval, "other")


def _fetch_photon(query: str, lat: float, lon: float, get: Callable) -> List[dict]:
    url = os.getenv("PHOTON_URL", PHOTON_URL).strip() or PHOTON_URL
    payload = _get(url, {
        "q": query,
        "lat": lat,
        "lon": lon,
        "limit": 8,
        "lang": "en",
        "location_bias_scale": 0.8,
    }, get, timeout=4)
    items = []
    for feature in payload.get("features") or []:
        item = suggestion_from_photon(feature)
        if item:
            items.append(item)
    return items


def _fetch_nominatim(query: str, get: Callable) -> List[dict]:
    url = os.getenv("NOMINATIM_URL", "https://nominatim.openstreetmap.org/search")
    payload = _get(url, {
        "q": query,
        "format": "jsonv2",
        "addressdetails": 1,
        "limit": 6,
        "countrycodes": "ca",
        "viewbox": ONTARIO_VIEWBOX,
        "bounded": 0,
    }, get)
    items = []
    for hit in payload or []:
        item = suggestion_from_nominatim(hit)
        if item:
            items.append(item)
    return items


def _fetch_mapbox(query: str, lat: float, lon: float, get: Callable) -> List[dict]:
    token = os.getenv("MAPBOX_ACCESS_TOKEN", "").strip()
    url = "https://api.mapbox.com/geocoding/v5/mapbox.places/" + quote(query) + ".json"
    payload = _get(url, {
        "access_token": token,
        "country": "ca",
        "proximity": f"{lon},{lat}",
        "limit": RESULT_LIMIT,
        "language": "en",
        "types": "address,place,locality,neighborhood,poi",
    }, get)
    items = []
    for feature in payload.get("features") or []:
        item = suggestion_from_mapbox(feature)
        if item:
            items.append(item)
    return items


def _fetch_google(query: str, lat: float, lon: float, get: Callable) -> List[dict]:
    key = os.getenv("GOOGLE_PLACES_API_KEY", "").strip()
    payload = _get(
        "https://maps.googleapis.com/maps/api/place/autocomplete/json",
        {
            "input": query,
            "key": key,
            "components": "country:ca",
            "location": f"{lat},{lon}",
            "radius": 250000,
            "language": "en",
        },
        get,
    )
    status = payload.get("status")
    if status not in {None, "OK", "ZERO_RESULTS"}:
        raise RuntimeError(payload.get("error_message") or f"Google Places {status}")
    return [suggestion_from_google_prediction(p) for p in payload.get("predictions") or []]


def readable_reverse_label(item: dict) -> str:
    """Street plus city, short enough for a From/To field."""
    label = (item.get("label") or "").strip() or "Current location"
    detail = (item.get("detail") or "").strip()
    city = detail.split(",")[0].strip() if detail else ""
    if city and city.lower() not in label.lower():
        return f"{label}, {city}"
    return label


def _fetch_photon_reverse(lat: float, lon: float, get: Callable) -> Optional[dict]:
    url = os.getenv("PHOTON_REVERSE_URL", PHOTON_REVERSE_URL).strip() or PHOTON_REVERSE_URL
    payload = _get(url, {"lat": lat, "lon": lon, "lang": "en"}, get, timeout=4)
    features = payload.get("features") or []
    if not features:
        return None
    return suggestion_from_photon(features[0])


def _fetch_nominatim_reverse(lat: float, lon: float, get: Callable) -> Optional[dict]:
    url = os.getenv("NOMINATIM_REVERSE_URL", NOMINATIM_REVERSE_URL).strip() or NOMINATIM_REVERSE_URL
    payload = _get(url, {
        "lat": lat,
        "lon": lon,
        "format": "jsonv2",
        "addressdetails": 1,
    }, get)
    if not isinstance(payload, dict) or payload.get("error"):
        return None
    return suggestion_from_nominatim(payload)


def reverse_place(
    lat: float,
    lon: float,
    *,
    get: Optional[Callable] = None,
    min_interval: Optional[float] = None,
) -> dict:
    """Readable label for a GPS point. Coordinates stay the requested point."""
    try:
        lat_f = float(lat)
        lon_f = float(lon)
    except (TypeError, ValueError) as exc:
        raise ValueError("lat and lon must be numeric") from exc
    if not (-90 <= lat_f <= 90 and -180 <= lon_f <= 180):
        raise ValueError("lat/lon out of range")

    cache_key = ("reverse", round(lat_f, 4), round(lon_f, 4))
    cached = _cache.get(cache_key)
    now = time.time()
    if cached and now - cached[0] < CACHE_TTL_S:
        return dict(cached[1])

    getter = get or requests.get
    explicit = min_interval is not None
    note = None
    item = None
    try:
        _reserve_upstream_slot(min_interval if explicit else PHOTON_INTERVAL_S, "photon")
        item = _fetch_photon_reverse(lat_f, lon_f, getter)
    except Exception:
        item = None
    if item is None:
        _reserve_upstream_slot(min_interval if explicit else MIN_INTERVAL_S, "other")
        item = _fetch_nominatim_reverse(lat_f, lon_f, getter)
        note = "Photon reverse was unavailable; used Nominatim."
    if item is None:
        raise RuntimeError("No address for that location")

    payload = {
        "label": readable_reverse_label(item),
        "detail": item.get("detail") or "",
        "lat": lat_f,
        "lon": lon_f,
        "note": note,
    }
    _cache[cache_key] = (time.time(), payload)
    return payload


def resolve_place(place_id: str, get: Optional[Callable] = None) -> dict:
    """Look up coordinates for a Google place id. Photon results already have them."""
    getter = get or requests.get
    key = os.getenv("GOOGLE_PLACES_API_KEY", "").strip()
    if not key:
        raise RuntimeError("GOOGLE_PLACES_API_KEY is not set")
    _reserve_upstream_slot(MIN_INTERVAL_S)
    payload = _get(
        "https://maps.googleapis.com/maps/api/place/details/json",
        {"place_id": place_id, "fields": "geometry,formatted_address,name", "key": key},
        getter,
    )
    if payload.get("status") != "OK":
        raise RuntimeError(payload.get("error_message") or f"Google Places {payload.get('status')}")
    result = payload.get("result") or {}
    loc = (result.get("geometry") or {}).get("location") or {}
    label = result.get("name") or result.get("formatted_address") or "Place"
    return {
        "id": place_id,
        "label": label,
        "detail": result.get("formatted_address") or "",
        "lat": float(loc["lat"]),
        "lon": float(loc["lng"]),
    }


def suggest_places(
    query: str,
    *,
    lat: Optional[float] = None,
    lon: Optional[float] = None,
    get: Optional[Callable] = None,
    min_interval: Optional[float] = None,
) -> dict:
    """Return up to six suggestions. Short queries are not sent upstream."""
    text = (query or "").strip()
    provider = configured_provider()
    note = None
    if len(text) < MIN_CHARS:
        return {"provider": provider, "suggestions": [], "note": None}
    if len(text) > MAX_CHARS:
        text = text[:MAX_CHARS]

    if provider == "google" and not provider_ready("google"):
        note = "GOOGLE_PLACES_API_KEY is not set; using Photon."
        provider = "photon"
    elif provider == "mapbox" and not provider_ready("mapbox"):
        note = "MAPBOX_ACCESS_TOKEN is not set; using Photon."
        provider = "photon"

    bias_lat, bias_lon = _bias(lat, lon)
    cache_key = (provider, text.lower(), round(bias_lat, 1), round(bias_lon, 1))
    cached = _cache.get(cache_key)
    now = time.time()
    if cached and now - cached[0] < CACHE_TTL_S:
        payload = dict(cached[1])
        if note and not payload.get("note"):
            payload["note"] = note
        return payload

    getter = get or requests.get
    explicit = min_interval is not None
    photon_interval = min_interval if explicit else PHOTON_INTERVAL_S
    other_interval = min_interval if explicit else MIN_INTERVAL_S

    used = provider
    items = []
    photon_failed = False
    try:
        if provider == "nominatim":
            _reserve_upstream_slot(other_interval, "other")
            items = _fetch_nominatim(text, getter)
        elif provider == "google":
            _reserve_upstream_slot(other_interval, "other")
            items = _fetch_google(text, bias_lat, bias_lon, getter)
        elif provider == "mapbox":
            _reserve_upstream_slot(other_interval, "other")
            items = _fetch_mapbox(text, bias_lat, bias_lon, getter)
        else:
            _reserve_upstream_slot(photon_interval, "photon")
            items = _fetch_photon(text, bias_lat, bias_lon, getter)
            used = "photon"
    except Exception:
        if provider != "photon":
            raise
        photon_failed = True
        items = []
    if used == "photon" and not items:
        _reserve_upstream_slot(other_interval, "other")
        items = _fetch_nominatim(text, getter)
        used = "nominatim"
        note = "Photon was unavailable; used Nominatim." if photon_failed else (note or "Photon had no matches; used Nominatim.")

    ranked = dedupe_suggestions(rank_suggestions(items))[:RESULT_LIMIT]
    # Drop internal sort fields from the wire format? Keep state/countrycode;
    # they are not secret and help the UI. The client only needs label/detail/lat/lon.
    public = []
    for item in ranked:
        public.append({
            "id": item.get("id") or "",
            "label": item.get("label") or "",
            "detail": item.get("detail") or "",
            "lat": item.get("lat"),
            "lon": item.get("lon"),
        })
    payload = {"provider": used, "suggestions": public, "note": note}
    _cache[cache_key] = (time.time(), payload)
    return payload


def clear_cache() -> None:
    global _photon_last, _other_last
    _cache.clear()
    _photon_last = 0.0
    _other_last = 0.0
