"""Unlock the Enterprise engine at process start, or leave a safe fallback.

Call ``prepare_engine()`` before importing ``inference``, ``speed_limit``,
``road_rules``, or ``vision_runtime``.

* Plaintext sources on disk: do nothing. Scoring stays exactly as it is now.
* Plaintext removed and ``protected/manifest.json`` present, with a key:
  decrypt into a temporary directory and put that directory on ``sys.path``.
* Ciphertext present and no key: install a fallback so the server still
  starts and tells the caller the engine is locked.
"""

from __future__ import annotations

import json
import sys
import tempfile
import types
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence

from engine_crypto import EngineCryptoError, decrypt_bytes, load_key
from engine_files import ENGINE_SOURCES, LOCKED_MESSAGE

_ROOT = Path(__file__).resolve().parent.parent
_STATUS: Dict[str, Any] = {
    "mode": "unknown",
    "message": "",
    "locked": False,
}
_HOLD: List[tempfile.TemporaryDirectory] = []


def engine_status() -> Dict[str, Any]:
    if _STATUS["mode"] == "unknown":
        prepare_engine()
    return dict(_STATUS)


def _sources_present(root: Path, sources: Sequence[str]) -> bool:
    return all((root / rel).is_file() for rel in sources)


def _set(mode: str, message: str, locked: bool = False) -> Dict[str, Any]:
    _STATUS.update(mode=mode, message=message, locked=locked)
    return dict(_STATUS)


def prepare_engine(
    root: Optional[Path] = None,
    sources: Optional[Sequence[str]] = None,
    environ: Optional[dict] = None,
) -> Dict[str, Any]:
    """Decide whether the engine is plaintext, unlocked, or locked."""
    repo = Path(root) if root is not None else _ROOT
    names = tuple(sources) if sources is not None else ENGINE_SOURCES
    manifest_path = repo / "protected" / "manifest.json"

    if _sources_present(repo, names):
        return _set(
            "plaintext",
            "Engine source is on disk. Encrypt it with tools/protect.py before publishing a locked copy.",
        )

    if not manifest_path.is_file():
        _install_locked_modules()
        return _set(
            "missing",
            "Engine locked. The scoring source is not on disk and no encrypted copy was found.",
            locked=True,
        )

    try:
        key = load_key(repo, environ)
    except EngineCryptoError:
        _install_locked_modules()
        return _set("locked", LOCKED_MESSAGE, locked=True)

    try:
        tree = _materialize(repo, manifest_path, key)
    except EngineCryptoError as exc:
        _install_locked_modules()
        return _set("locked", str(exc), locked=True)

    demo_path = tree / "demo"
    src_path = tree / "src"
    if demo_path.is_dir():
        sys.path.insert(0, str(demo_path))
    if src_path.is_dir():
        sys.path.insert(0, str(src_path))
    return _set("unlocked", "Engine decrypted in a temporary directory for this process.")


def _materialize(repo: Path, manifest_path: Path, key: bytes) -> Path:
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    hold = tempfile.TemporaryDirectory(prefix="smart-shield-engine-")
    _HOLD.append(hold)
    dest = Path(hold.name)
    for item in manifest.get("files") or []:
        rel = str(item["path"])
        enc_rel = str(item.get("enc") or f"protected/{rel}.enc")
        blob = (repo / enc_rel).read_bytes()
        plain = decrypt_bytes(key, blob, rel.encode("utf-8"))
        out = dest / rel
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(plain)
    return dest


def _install_locked_modules() -> None:
    """Stubs so Flask can import the engine after the plaintext files are gone."""
    if "inference" not in sys.modules:
        inference = types.ModuleType("inference")
        inference.DEFAULT_VISION_MODE = "auto"
        inference.WEATHER_PRESETS = {}
        inference.score_routes_batch = _locked_score_routes
        sys.modules["inference"] = inference

    if "vision_runtime" not in sys.modules:
        vision = types.ModuleType("vision_runtime")
        vision.get_vision_runtime = lambda: _LockedVision()
        sys.modules["vision_runtime"] = vision

    if "speed_limit" not in sys.modules:
        speed = types.ModuleType("speed_limit")
        speed.overpass_urls = lambda: [
            "https://overpass.openstreetmap.fr/api/interpreter",
            "https://overpass-api.de/api/interpreter",
            "https://overpass.kumi.systems/api/interpreter",
        ]
        speed.safe_speed_kmh = _locked_safe_speed
        speed.lookup_posted_speed = _locked_lookup
        sys.modules["speed_limit"] = speed

    if "road_rules" not in sys.modules:
        rules = types.ModuleType("road_rules")
        rules.load_rules = lambda: {"locked": True, "score": {"formula": LOCKED_MESSAGE}}
        rules.load_demo_route = lambda: {"coordinates": [], "error": LOCKED_MESSAGE}
        rules.prefetch_corridor = lambda geometry=None, fetch=None: {
            "ok": False,
            "lookup_ok": False,
            "cached": False,
            "error": LOCKED_MESSAGE,
            "hazards": 0,
        }
        rules.road_context = _locked_road_context
        sys.modules["road_rules"] = rules


def _locked_score_routes(routes: List[dict], **_kwargs: Any) -> List[dict]:
    scored = []
    for index, route in enumerate((routes or [])[:3]):
        distance_m = float(route.get("distance_m") or 0)
        minutes = float(route.get("duration_s") or 0) / 60.0
        scored.append({
            "route_index": index,
            "summary": route.get("summary") or f"Route {index + 1}",
            "safety_score": None,
            "tier": "LOCKED",
            "tier_color": "#526072",
            "safety_rank": index + 1,
            "operational_message": LOCKED_MESSAGE,
            "relative_speed_text": "",
            "guidance_steps": ["Engine locked. This is not a model safety score."],
            "recommended_speed_kmh": None,
            "duration_text": f"{int(round(minutes))} min" if minutes else "",
            "distance_km": round(distance_m / 1000.0, 1),
            "T_nlp": None,
            "V_vision": None,
            "E_index": None,
            "vision_source": "engine_locked",
            "engine_locked": True,
        })
    return scored


def _locked_safe_speed(posted_kmh: float, **_kwargs: Any) -> Dict[str, Any]:
    posted = int(round(float(posted_kmh)))
    return {
        "safe_kmh": posted,
        "posted_kmh": posted,
        "fraction": 1.0,
        "source": "engine_locked",
        "tier": None,
        "floor_applied": False,
        "summary": "Engine locked. Safe speed is unavailable; showing the posted limit only.",
        "rule": LOCKED_MESSAGE,
    }


def _locked_lookup(lat: float, lon: float) -> Dict[str, Any]:
    return {
        "lat": lat,
        "lon": lon,
        "posted_kmh": 50,
        "posted_source": "estimated",
        "estimated": True,
        "highway": "unknown",
        "road_name": None,
        "distance_m": None,
        "osm_way_id": None,
        "safe_kmh": 50,
        "detail": "Engine locked. Speed limit unavailable, showing estimate.",
        "summary": LOCKED_MESSAGE,
        "rule": LOCKED_MESSAGE,
    }


def _locked_road_context(lat: float, lon: float, **_kwargs: Any) -> Dict[str, Any]:
    return {
        "lat": lat,
        "lon": lon,
        "road_mode": "STREET",
        "posted_kmh": 50,
        "safe_kmh": 50,
        "posted_label": "estimated",
        "posted_source": "estimated",
        "estimated": True,
        "summary": LOCKED_MESSAGE,
        "detail": "Engine locked. Speed limit unavailable, showing estimate.",
        "rule": LOCKED_MESSAGE,
        "lookup_ok": False,
        "lookup_error": "engine locked",
        "alerts": [],
        "hazards": [],
        "active_caps": [],
        "school_active": False,
        "exit_warning": None,
        "highway": "unknown",
        "road_name": None,
    }


class _LockedVision:
    ready = False

    def available(self) -> bool:
        return False

    def warmup(self) -> bool:
        return False

    def status(self) -> Dict[str, Any]:
        return {
            "ready": False,
            "weights_present": False,
            "cache_present": False,
            "backend": None,
            "load_error": LOCKED_MESSAGE,
            "note": LOCKED_MESSAGE,
        }
