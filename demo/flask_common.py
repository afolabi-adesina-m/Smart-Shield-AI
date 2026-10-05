"""Shared Flask API routes for desktop and mobile Smart-Shield demos."""

from __future__ import annotations

import json
import os
from pathlib import Path

import requests
from flask import Flask, jsonify, request

from flask_cors import CORS

from engine_loader import engine_status
from inference import WEATHER_PRESETS, score_routes_batch, DEFAULT_VISION_MODE
from map_tiles import map_tile_settings
from test_prep import DISCLAIMER, TestPrepError, build_practice_loop, list_centres
from geocode_suggest import (
    configured_provider,
    provider_ready,
    resolve_place,
    reverse_place,
    suggest_places,
)
from place_geocode import FRIENDLY_UNAVAILABLE, GeocodeLookupError, geocode_place
from road_preview import steps_from_route
from road_rules import load_demo_route, load_rules, prefetch_corridor, road_context
from speed_limit import lookup_posted_speed, overpass_urls, safe_speed_kmh
from vision_runtime import get_vision_runtime
from cameras import DISCLAIMER as CAMERA_DISCLAIMER, cameras_near, load_toronto_cameras, public_features

NOMINATIM_URL = os.getenv("NOMINATIM_URL", "https://nominatim.openstreetmap.org/search")
OSRM_URL = os.getenv("OSRM_URL", "https://router.project-osrm.org/route/v1/driving")
USER_AGENT = "SmartShieldCapstone/1.0 (Sheridan PAIDA academic demo)"


def apply_public_cors(app: Flask) -> None:
    """Allow the map API to be called when the page is hosted on another origin.

    Default remains open (``*``), matching the previous demo. Set
    SMART_SHIELD_CORS_ORIGINS to a comma-separated list to restrict it.
    """
    raw = os.getenv("SMART_SHIELD_CORS_ORIGINS", "*").strip()
    if not raw or raw == "*":
        CORS(app)
        return
    origins = [part.strip() for part in raw.split(",") if part.strip()]
    CORS(app, origins=origins)


def _public_geocode_error(exc: Exception) -> str:
    text = str(exc)
    for secret in (
        os.getenv("GOOGLE_PLACES_API_KEY", ""),
        os.getenv("MAPBOX_ACCESS_TOKEN", ""),
    ):
        if secret:
            text = text.replace(secret, "***")
    return text


def _optional_float(name: str):
    raw = (request.args.get(name) or "").strip()
    if raw == "":
        return None
    return float(raw)


def _osm_get(url: str, params: dict) -> dict:
    headers = {"User-Agent": USER_AGENT}
    resp = requests.get(url, params=params, headers=headers, timeout=30)
    resp.raise_for_status()
    return resp.json()


def _route_label(index: int, km: float, minutes: float) -> str:
    labels = ["Fastest route", "Alternate route", "Scenic / longer route"]
    return f"{labels[index] if index < len(labels) else f'Route {index + 1}'} · {km:.0f} km · {minutes:.0f} min"


def register_api_routes(app: Flask) -> None:
    from auth_gate import (
        check_password,
        client_ip,
        configure_auth,
        current_user,
        enforced,
        guard,
        issue_token,
        login_blocked,
        note_failure,
    )

    configure_auth()

    @app.before_request
    def _require_sign_in():
        return guard()

    @app.get("/api/auth/status")
    def auth_status():
        user = current_user() or ""
        return jsonify({
            "auth_required": enforced(),
            "authenticated": bool(user),
            "user": user,
        })

    @app.post("/api/auth/login")
    def auth_login():
        if not enforced():
            return jsonify({"auth_required": False, "token": "", "user": ""})
        ip = client_ip()
        if login_blocked(ip):
            return jsonify({"error": "Too many sign-in attempts. Wait a few minutes."}), 429
        body = request.get_json(force=True, silent=True) or {}
        username = str(body.get("username") or "")
        password = str(body.get("password") or "")
        if not check_password(username, password):
            note_failure(ip)
            return jsonify({"error": "Wrong username or password."}), 401
        return jsonify({
            "auth_required": True,
            "token": issue_token(username),
            "user": username,
        })

    @app.post("/api/auth/logout")
    def auth_logout():
        # The token is kept on the client. Signing out deletes it there.
        return jsonify({"ok": True})

    @app.get("/api/health")
    def health():
        models_dir = Path(__file__).resolve().parent.parent / "models"
        vision = get_vision_runtime().status()
        return jsonify({
            "status": "ok",
            "map_provider": "OpenStreetMap + OSRM (free)",
            "billing_required": False,
            "models_dir": str(models_dir),
            "models_present": models_dir.is_dir() and any(models_dir.glob("*.joblib")),
            "vision": vision,
            "default_vision_mode": DEFAULT_VISION_MODE,
            "speed_limit": "osm-maxspeed",
            "road_rules": "street-exit",
            "edition": "Smart-Shield AI Enterprise",
            "engine": engine_status(),
        })

    @app.get("/api/config")
    def public_config():
        """Public runtime settings for the browser. No secrets."""
        return jsonify({
            "desktop_url": os.getenv("SMART_SHIELD_DESKTOP_URL", "").strip(),
            "mobile_url": os.getenv("SMART_SHIELD_MOBILE_URL", "").strip(),
            "desktop_port": int(os.getenv("SMART_SHIELD_PORT", "5050")),
            "mobile_port": int(os.getenv("SMART_SHIELD_MOBILE_PORT", "5051")),
            "mobile_path": "/mobile",
            "geolocation_requires_https": True,
            "overpass_urls": overpass_urls(),
            "osrm_url": OSRM_URL,
            "nominatim_url": NOMINATIM_URL,
            "geocode_provider": configured_provider(),
            "geocode_key_configured": provider_ready(),
            "map_tiles": map_tile_settings(),
        })

    @app.get("/api/suggest")
    def suggest():
        """Address autocomplete. Proxied so the browser does not call Photon directly."""
        q = (request.args.get("q") or "").strip()
        if len(q) > 120:
            return jsonify({"error": "Query is too long"}), 400
        lat = lon = None
        try:
            if request.args.get("lat"):
                lat = float(request.args["lat"])
            if request.args.get("lon"):
                lon = float(request.args["lon"])
        except ValueError:
            return jsonify({"error": "lat and lon must be numeric"}), 400
        try:
            return jsonify(suggest_places(q, lat=lat, lon=lon))
        except Exception as exc:
            return jsonify({"error": _public_geocode_error(exc)}), 502

    @app.get("/api/reverse")
    def reverse_lookup():
        """Readable label for a GPS point. The phone and website do not call Photon directly."""
        try:
            lat = float(request.args["lat"])
            lon = float(request.args["lon"])
        except (KeyError, ValueError):
            return jsonify({"error": "Need numeric lat and lon"}), 400
        if not (-90 <= lat <= 90 and -180 <= lon <= 180):
            return jsonify({"error": "lat/lon out of range"}), 400
        try:
            return jsonify(reverse_place(lat, lon))
        except Exception as exc:
            return jsonify({"error": _public_geocode_error(exc)}), 502

    @app.get("/api/place")
    def place():
        """Resolve a Google place id to coordinates. Photon hits already include lat/lon."""
        place_id = (request.args.get("id") or "").strip()
        if not place_id:
            return jsonify({"error": "Missing place id"}), 400
        try:
            return jsonify(resolve_place(place_id))
        except Exception as exc:
            return jsonify({"error": _public_geocode_error(exc)}), 502

    @app.get("/api/speed-limit")
    def speed_limit():
        """Posted limit for a point, plus Safe Speed from the current risk signal."""
        try:
            lat = float(request.args["lat"])
            lon = float(request.args["lon"])
        except (KeyError, ValueError):
            return jsonify({"error": "Need numeric lat and lon"}), 400
        if not (-90 <= lat <= 90 and -180 <= lon <= 180):
            return jsonify({"error": "lat/lon out of range"}), 400
        try:
            recommended = _optional_float("recommended_kmh")
        except ValueError:
            return jsonify({"error": "recommended_kmh must be numeric"}), 400
        posted = lookup_posted_speed(lat, lon)
        safe = safe_speed_kmh(
            posted["posted_kmh"],
            highway=posted.get("highway"),
            tier=request.args.get("tier"),
            recommended_kmh=recommended,
            weather=request.args.get("weather"),
        )
        return jsonify({**posted, **safe})

    @app.get("/api/safe-speed")
    def safe_speed():
        """Recompute Safe Speed when risk changes, without another Overpass call."""
        try:
            posted = float(request.args["posted"])
            recommended = _optional_float("recommended_kmh")
        except (KeyError, ValueError):
            return jsonify({"error": "Need numeric posted (and numeric recommended_kmh if set)"}), 400
        return jsonify(safe_speed_kmh(
            posted,
            highway=request.args.get("highway"),
            tier=request.args.get("tier"),
            recommended_kmh=recommended,
            weather=request.args.get("weather"),
        ))

    @app.get("/api/test-centres")
    def test_centres():
        return jsonify({"centres": list_centres(), "disclaimer": DISCLAIMER})

    @app.post("/api/test-loop")
    def test_loop():
        body = request.get_json(force=True, silent=True) or {}
        try:
            payload = build_practice_loop(
                body.get("centre_id"),
                body.get("level") or "G2",
                osrm_url=OSRM_URL,
            )
        except TestPrepError as exc:
            return jsonify({"error": str(exc)}), exc.status
        except Exception as exc:
            return jsonify({"error": str(exc)}), 502
        return jsonify(payload)

    @app.get("/api/street-rules")
    def street_rules():
        return jsonify(load_rules())

    @app.get("/api/fleet-demo-route")
    def fleet_demo_route():
        # The decrypted engine looks for this JSON beside the temp copy of
        # road_rules.py. The file itself stays in the demo folder, so read it
        # from here when that lookup comes back empty.
        try:
            payload = load_demo_route()
        except Exception:
            payload = None
        if isinstance(payload, dict) and payload.get("coordinates"):
            return jsonify(payload)
        path = Path(__file__).resolve().parent / "fleet_demo_route.json"
        return jsonify(json.loads(path.read_text(encoding="utf-8")))

    @app.post("/api/road-context")
    def road_context_route():
        """Posted limit, safe speed, and ahead-of-car hazards for one position."""
        body = request.get_json(force=True, silent=True) or {}
        try:
            lat = float(body["lat"])
            lon = float(body["lon"])
        except (KeyError, TypeError, ValueError):
            return jsonify({"error": "Need numeric lat and lon"}), 400
        if not (-90 <= lat <= 90 and -180 <= lon <= 180):
            return jsonify({"error": "lat/lon out of range"}), 400
        recommended = body.get("recommended_kmh")
        try:
            if recommended is not None and recommended != "":
                recommended = float(recommended)
            else:
                recommended = None
        except (TypeError, ValueError):
            return jsonify({"error": "recommended_kmh must be numeric"}), 400
        try:
            payload = road_context(
                lat,
                lon,
                geometry=body.get("geometry"),
                weather=body.get("weather"),
                tier=body.get("tier"),
                recommended_kmh=recommended,
                bearing=body.get("bearing"),
                demo=bool(body.get("demo")),
            )
        except Exception as exc:
            payload = {
                "lat": lat,
                "lon": lon,
                "road_mode": "STREET",
                "posted_kmh": 50,
                "posted_label": "estimated",
                "posted_source": "estimated",
                "estimated": True,
                "safe_kmh": 50,
                "summary": "Estimated urban default",
                "detail": f"Map lookup failed ({exc}). Estimated Ontario urban default of 50 km/h.",
                "rule": "Fallback estimated limit because road context failed.",
                "lookup_ok": False,
                "lookup_error": str(exc),
                "alerts": [],
                "hazards": [],
                "active_caps": [],
                "school_active": False,
                "exit_warning": None,
                "highway": "unknown",
                "road_name": None,
            }
        return jsonify(payload)

    @app.post("/api/road-corridor")
    def road_corridor():
        """Prefetch OSM roads and hazards for a route. Overpass failures stay HTTP 200."""
        body = request.get_json(force=True, silent=True) or {}
        if body.get("demo"):
            route = load_demo_route()
            return jsonify({
                "ok": True,
                "lookup_ok": True,
                "source": "demo",
                "cached": True,
                "hazards": len(route.get("hazards") or []),
            })
        try:
            return jsonify(prefetch_corridor(body.get("geometry")))
        except Exception as exc:
            return jsonify({
                "ok": False,
                "lookup_ok": False,
                "cached": False,
                "error": str(exc),
                "hazards": 0,
            })

    @app.get("/api/cameras")
    def cameras():
        """City of Toronto enforcement cameras. OpenStreetMap features stay on the client."""
        try:
            lat = float(request.args["lat"]) if request.args.get("lat") else None
            lon = float(request.args["lon"]) if request.args.get("lon") else None
        except ValueError:
            return jsonify({"error": "lat and lon must be numeric", "disclaimer": CAMERA_DISCLAIMER}), 400
        if (lat is None) != (lon is None):
            return jsonify({"error": "Provide both lat and lon", "disclaimer": CAMERA_DISCLAIMER}), 400
        if lat is not None and not (-90 <= lat <= 90 and -180 <= lon <= 180):
            return jsonify({"error": "lat/lon out of range", "disclaimer": CAMERA_DISCLAIMER}), 400
        features = load_toronto_cameras()
        if lat is not None:
            try:
                radius = float(request.args.get("radius") or 4000)
            except ValueError:
                return jsonify({"error": "radius must be numeric", "disclaimer": CAMERA_DISCLAIMER}), 400
            features = cameras_near(features, lat, lon, min(8000.0, max(100.0, radius)))
        else:
            features = public_features(features)
        return jsonify({
            "features": features,
            "count": len(features),
            "disclaimer": CAMERA_DISCLAIMER,
        })

    @app.get("/api/geocode")
    def geocode():
        q = (request.args.get("q") or "").strip()
        if not q:
            return jsonify({"error": "Missing query parameter q"}), 400
        if len(q) > 200:
            return jsonify({"error": "Query is too long"}), 400
        try:
            hit = geocode_place(q)
        except GeocodeLookupError as exc:
            return jsonify({"error": str(exc)}), exc.status
        except Exception:
            return jsonify({"error": FRIENDLY_UNAVAILABLE}), 502
        return jsonify({
            "lat": hit["lat"],
            "lon": hit["lon"],
            "display_name": hit.get("display_name") or q,
        })

    @app.get("/api/directions")
    def directions():
        try:
            from_lat = float(request.args["from_lat"])
            from_lon = float(request.args["from_lon"])
            to_lat = float(request.args["to_lat"])
            to_lon = float(request.args["to_lon"])
        except (KeyError, ValueError):
            return jsonify({"error": "Need from_lat, from_lon, to_lat, to_lon"}), 400

        mode = (request.args.get("mode") or "drive").strip().lower()
        if mode not in ("drive", "motorcycle", "cycle", "walk", "transit"):
            return jsonify({"error": "Unknown travel mode"}), 400
        summary = request.args.get("summary") == "1"
        if mode in ("cycle", "walk", "transit"):
            from travel_modes import directions_for_mode
            try:
                return jsonify(directions_for_mode(
                    mode, from_lat, from_lon, to_lat, to_lon, summary,
                ))
            except LookupError as exc:
                return jsonify({"error": str(exc)}), 404
            except Exception as exc:
                return jsonify({"error": str(exc)}), 502

        coords = f"{from_lon},{from_lat};{to_lon},{to_lat}"
        url = f"{OSRM_URL}/{coords}"
        try:
            data = _osm_get(url, {
                "alternatives": "false" if summary else "true",
                "overview": "false" if summary else "full",
                "geometries": "geojson",
                "steps": "false" if summary else "true",
            })
            if data.get("code") != "Ok":
                return jsonify({"error": data.get("message", "Routing failed")}), 404

            routes = []
            for i, route in enumerate(data.get("routes", [])[:3]):
                if summary:
                    routes.append({
                        "distance": route["distance"],
                        "duration": route["duration"],
                        "summary": _route_label(i, route["distance"] / 1000, route["duration"] / 60),
                    })
                    continue
                geom = route["geometry"]["coordinates"]
                mid = geom[len(geom) // 2] if geom else None
                routes.append({
                    "distance": route["distance"],
                    "duration": route["duration"],
                    "summary": _route_label(i, route["distance"] / 1000, route["duration"] / 60),
                    "geometry": geom,
                    # Fix 2/3: midpoint used for live 511 alert + live weather
                    # lookups. Frontend should echo these back as "lat"/"lon"
                    # per route when calling /api/score-routes.
                    "mid_lon": mid[0] if mid else None,
                    "mid_lat": mid[1] if mid else None,
                    "steps": steps_from_route(route),
                })
            body = {
                "routes": routes,
                "mode": "motorcycle" if mode == "motorcycle" else "drive",
            }
            if mode == "motorcycle":
                body["note"] = "Motorcycle uses the car route. Motorways are allowed in Ontario."
            return jsonify(body)
        except Exception as exc:
            return jsonify({"error": str(exc)}), 502

    @app.get("/api/presets")
    def presets():
        # Fix 2/3: live 511 alerts + live weather are now the default source
        # for /api/score-routes (see mid_lat/mid_lon on /api/directions
        # routes). These presets are kept only as a manual override (e.g.
        # "show me what an ice storm would look like") or as the fallback
        # used automatically when live data can't be reached.
        return jsonify({
            "mode": "manual_override_and_fallback",
            "weather": list(WEATHER_PRESETS.keys()),
            "labels": {
                "clear": "Clear — summer highway",
                "wet": "Wet / dawn — reduced grip",
                "blizzard": "Blizzard — Hwy 400 night",
                "ice_storm": "Ice storm — QEW rush",
            },
            "vision_modes": {
                "real": "Trained ResNet18 on live 511 CCTV (cache fallback)",
                "proxy": "Hardcoded VISION_BY_PRESET (old demo)",
                "auto": "Real ResNet when available, else proxy",
            },
            "default_vision_mode": DEFAULT_VISION_MODE,
            "vision": get_vision_runtime().status(),
        })

    @app.post("/api/score-routes")
    def score_routes():
        body = request.get_json(force=True, silent=True) or {}
        routes = body.get("routes", [])
        if not routes:
            return jsonify({"error": "No routes provided"}), 400

        weather = body.get("weather", "auto")
        custom_alert = body.get("custom_alert", "")
        # Legacy flag only. UI removed Force checkbox: Auto → live,
        # named presets → that scenario only (see inference.score_route).
        force_preset = bool(body.get("force_preset", False))
        vision_mode = (body.get("vision_mode") or DEFAULT_VISION_MODE)
        scored = score_routes_batch(
            routes,
            weather=weather,
            custom_alert=custom_alert,
            force_preset=force_preset,
            vision_mode=vision_mode,
        )
        return jsonify({
            "routes": scored,
            "best_route_index": scored[0]["route_index"] if scored else 0,
            "vision_mode": (vision_mode or DEFAULT_VISION_MODE),
        })


def disable_demo_cache(app: Flask) -> None:
    @app.after_request
    def _no_cache(response):
        if request.path == "/" or request.path.startswith("/static/"):
            response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        return response
