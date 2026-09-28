"""Single-place lookup for /api/geocode.

The public Nominatim service rate-limits shared hosting IPs. This module
keeps that call polite and replaceable:

- typed ``lat,lon`` is returned immediately, with no network call
- a normalized-query cache (memory, plus a small JSON file) serves repeats
- common Ontario cities are seeded so they never need the network
- Nominatim is sent an identifying User-Agent and Referer, at most once per
  second (shared with address autocomplete), and retried once on 429/5xx
- Photon is the fallback when Nominatim fails or is still rate-limited
- callers see a short message, never the raw HTTP exception text
"""

from __future__ import annotations

import json
import os
import re
import threading
import time
from pathlib import Path
from typing import Callable, Optional

import requests

from geocode_suggest import (
    GEOCODE_HEADERS,
    MIN_INTERVAL_S,
    ONTARIO_BIAS_LAT,
    ONTARIO_BIAS_LON,
    PHOTON_URL,
    reserve_upstream_slot,
)

NOMINATIM_SEARCH = "https://nominatim.openstreetmap.org/search"
FRIENDLY_NOT_FOUND = (
    "No match for that place. Try a city name, or type coordinates as latitude, longitude."
)
FRIENDLY_UNAVAILABLE = (
    "Could not look up that place right now. Try again in a moment, "
    "or type coordinates as latitude, longitude."
)
FRIENDLY_BUSY = (
    "Address lookup is busy right now. Try again in a moment, "
    "or type coordinates as latitude, longitude."
)

# City reference points for the Ontario demo. Toronto matches the map default.
_CITY_SEEDS = (
    ("Toronto", ONTARIO_BIAS_LAT, ONTARIO_BIAS_LON),
    ("Mississauga", 43.5890, -79.6441),
    ("Brampton", 43.6833, -79.7667),
    ("Oakville", 43.4474, -79.6877),
    ("Hamilton", 43.2557, -79.8711),
)

_LATLON = re.compile(
    r"^\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*,\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*$"
)
_RETRY_CAP_S = 2.0
_DEFAULT_BACKOFF_S = 0.5
_MAX_CACHED = 400

_lock = threading.Lock()
_memory: dict[str, dict] = {}
_disk_loaded: Optional[str] = None


class GeocodeLookupError(Exception):
    """A place lookup failed. ``status`` is safe to return to the browser."""

    def __init__(self, message: str, *, status: int = 502, not_found: bool = False):
        super().__init__(message)
        self.status = 404 if not_found else status
        self.not_found = not_found


class _UpstreamError(Exception):
    def __init__(self, status: int, retry_after: Optional[float] = None):
        super().__init__("upstream geocoder failed")
        self.status = status
        self.retry_after = retry_after


def normalize_place_query(query: str) -> str:
    """Cache key: lower case, commas as spaces, collapsed whitespace."""
    return " ".join((query or "").strip().lower().replace(",", " ").split())


def _seed_aliases(name: str) -> tuple[str, ...]:
    city = name.lower()
    return (
        city,
        f"{city} ontario",
        f"{city} on",
        f"{city} ontario canada",
        f"{city} on canada",
    )


def _seed_records() -> dict[str, dict]:
    records = {}
    for name, lat, lon in _CITY_SEEDS:
        payload = {
            "lat": float(lat),
            "lon": float(lon),
            "display_name": f"{name}, Ontario",
            "source": "seed",
        }
        for alias in _seed_aliases(name):
            records[alias] = dict(payload)
    return records


def reset_geocode_cache() -> None:
    """Test helper: drop learned places and keep the Ontario seed."""
    global _disk_loaded
    with _lock:
        _memory.clear()
        _memory.update(_seed_records())
        _disk_loaded = None


reset_geocode_cache()


def _default_cache_path() -> Path:
    raw = os.getenv("GEOCODE_CACHE_PATH", "").strip()
    if raw:
        return Path(raw)
    return Path(__file__).resolve().parent / ".cache" / "geocode.json"


def _hit(lat: float, lon: float, display_name: str, source: str) -> dict:
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        raise _UpstreamError(0)
    return {
        "lat": lat,
        "lon": lon,
        "display_name": display_name,
        "source": source,
    }


def parse_coordinates(query: str) -> Optional[dict]:
    """Accept ``43.65, -79.38`` without calling a geocoder."""
    match = _LATLON.match(query or "")
    if not match:
        return None
    lat = float(match.group(1))
    lon = float(match.group(2))
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        return None
    return _hit(lat, lon, f"{lat}, {lon}", "coordinates")


def _retry_after_seconds(resp) -> float:
    headers = getattr(resp, "headers", None) or {}
    raw = headers.get("Retry-After") if hasattr(headers, "get") else None
    if raw is None or str(raw).strip() == "":
        return _DEFAULT_BACKOFF_S
    try:
        seconds = float(str(raw).strip())
    except ValueError:
        return _DEFAULT_BACKOFF_S
    if seconds < 0:
        seconds = 0.0
    return min(seconds, _RETRY_CAP_S)


def _call(get: Callable, url: str, params: dict):
    try:
        resp = get(url, params=params, headers=dict(GEOCODE_HEADERS), timeout=12)
    except requests.RequestException as exc:
        raise _UpstreamError(0) from exc
    except Exception as exc:
        if isinstance(exc, AssertionError):
            raise
        # Injected test doubles, and anything else, must not leak into the API body.
        raise _UpstreamError(0) from exc
    status = int(getattr(resp, "status_code", 200) or 200)
    if status == 429 or status >= 500:
        raise _UpstreamError(status, _retry_after_seconds(resp))
    if status >= 400:
        raise _UpstreamError(status)
    try:
        return resp.json()
    except Exception as exc:
        raise _UpstreamError(0) from exc


def _retryable(status: int) -> bool:
    return status == 0 or status == 429 or status >= 500


def _with_retry(fetch: Callable, sleep: Callable[[float], None], interval: float):
    """One attempt, then a single retry on 429, 5xx, or a transport error."""
    try:
        reserve_upstream_slot(interval)
        return fetch()
    except _UpstreamError as first:
        if not _retryable(first.status):
            raise
        delay = first.retry_after if first.retry_after is not None else _DEFAULT_BACKOFF_S
        sleep(delay)
        reserve_upstream_slot(interval)
        return fetch()


def _nominatim_hit(payload, query: str) -> Optional[dict]:
    if not payload:
        return None
    hit = payload[0] if isinstance(payload, list) else None
    if not isinstance(hit, dict) or "lat" not in hit or "lon" not in hit:
        return None
    return _hit(
        float(hit["lat"]),
        float(hit["lon"]),
        str(hit.get("display_name") or query),
        "nominatim",
    )


def _photon_hit(payload, query: str) -> Optional[dict]:
    features = payload.get("features") if isinstance(payload, dict) else None
    if not features:
        return None
    feature = features[0] if isinstance(features[0], dict) else None
    if not feature:
        return None
    coords = (feature.get("geometry") or {}).get("coordinates") or []
    if len(coords) < 2:
        return None
    props = feature.get("properties") or {}
    name = str(props.get("name") or props.get("city") or props.get("street") or query)
    detail = []
    for part in (props.get("city"), props.get("state"), props.get("country")):
        text = str(part).strip() if part else ""
        if text and text.lower() not in name.lower() and text not in detail:
            detail.append(text)
    display = name if not detail else f"{name}, {', '.join(detail)}"
    return _hit(float(coords[1]), float(coords[0]), display, "photon")


def _remember(key: str, hit: dict, cache_path: Optional[Path]) -> None:
    stored = dict(hit)
    with _lock:
        _memory[key] = stored
        extras = [item for item, value in _memory.items() if value.get("source") != "seed"]
        overflow = len(extras) - _MAX_CACHED
        for old in extras[: max(overflow, 0)]:
            _memory.pop(old, None)
        if cache_path is not None:
            try:
                _write_disk_locked(cache_path)
            except OSError:
                pass


def _write_disk_locked(path: Path) -> None:
    payload = {}
    for key, value in _memory.items():
        if value.get("source") == "seed":
            continue
        payload[key] = {
            "lat": value["lat"],
            "lon": value["lon"],
            "display_name": value["display_name"],
        }
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")
    tmp.replace(path)


def _load_disk(path: Path) -> None:
    global _disk_loaded
    with _lock:
        if _disk_loaded == str(path):
            return
        _disk_loaded = str(path)
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return
        if not isinstance(raw, dict):
            return
        for key, value in raw.items():
            if not isinstance(key, str) or not isinstance(value, dict):
                continue
            norm = normalize_place_query(key)
            if norm in _memory and _memory[norm].get("source") == "seed":
                continue
            try:
                lat = float(value["lat"])
                lon = float(value["lon"])
            except (KeyError, TypeError, ValueError):
                continue
            if not (-90 <= lat <= 90 and -180 <= lon <= 180):
                continue
            _memory[norm] = {
                "lat": lat,
                "lon": lon,
                "display_name": str(value.get("display_name") or key),
                "source": "cache",
            }


def _cached(key: str) -> Optional[dict]:
    with _lock:
        hit = _memory.get(key)
        return dict(hit) if hit else None


def geocode_place(
    query: str,
    *,
    get: Optional[Callable] = None,
    sleep: Optional[Callable[[float], None]] = None,
    min_interval: Optional[float] = None,
    cache_path: Optional[Path] = None,
    use_disk: Optional[bool] = None,
) -> dict:
    """Resolve one place to ``lat``, ``lon``, and ``display_name``.

    ``get`` and ``sleep`` are injection points for tests. ``use_disk=False``
    skips the JSON file. Network calls are paced to one per second.
    """
    text = (query or "").strip()
    if not text:
        raise GeocodeLookupError("Missing place", status=400)

    direct = parse_coordinates(text)
    if direct:
        return direct

    key = normalize_place_query(text)
    disk = _default_cache_path() if use_disk is None else cache_path
    if use_disk is False:
        disk = None
    if disk is not None:
        _load_disk(Path(disk))

    cached = _cached(key)
    if cached:
        return cached

    getter = get or requests.get
    sleeper = sleep or time.sleep
    interval = MIN_INTERVAL_S if min_interval is None else float(min_interval)
    nominatim_url = os.getenv("NOMINATIM_URL", NOMINATIM_SEARCH).strip() or NOMINATIM_SEARCH
    photon_url = os.getenv("PHOTON_URL", PHOTON_URL).strip() or PHOTON_URL

    failures: list[_UpstreamError] = []

    def nominatim_once():
        return _call(getter, nominatim_url, {
            "q": text,
            "format": "json",
            "limit": 1,
            "countrycodes": "ca",
        })

    def photon_once():
        return _call(getter, photon_url, {
            "q": text,
            "limit": 1,
            "lang": "en",
            "lat": ONTARIO_BIAS_LAT,
            "lon": ONTARIO_BIAS_LON,
        })

    hit = None
    try:
        hit = _nominatim_hit(_with_retry(nominatim_once, sleeper, interval), text)
    except _UpstreamError as exc:
        failures.append(exc)
    if hit:
        _remember(key, hit, disk)
        return hit

    try:
        hit = _photon_hit(_with_retry(photon_once, sleeper, interval), text)
    except _UpstreamError as exc:
        failures.append(exc)
    if hit:
        _remember(key, hit, disk)
        return hit

    if failures:
        if all(item.status == 429 for item in failures):
            raise GeocodeLookupError(FRIENDLY_BUSY, status=429)
        raise GeocodeLookupError(FRIENDLY_UNAVAILABLE, status=502)
    raise GeocodeLookupError(FRIENDLY_NOT_FOUND, not_found=True)
