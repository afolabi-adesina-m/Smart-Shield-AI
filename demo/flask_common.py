"""Shared Flask API routes for desktop and mobile Smart-Shield demos."""

from __future__ import annotations

import os
from pathlib import Path

import requests
from flask import Flask, jsonify, request

from inference import WEATHER_PRESETS, score_routes_batch

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
OSRM_URL = os.getenv("OSRM_URL", "https://router.project-osrm.org/route/v1/driving")
USER_AGENT = "SmartShieldCapstone/1.0 (Sheridan PAIDA academic demo)"


def _osm_get(url: str, params: dict) -> dict:
    headers = {"User-Agent": USER_AGENT}
    resp = requests.get(url, params=params, headers=headers, timeout=30)
    resp.raise_for_status()
    return resp.json()


def _route_label(index: int, km: float, minutes: float) -> str:
    labels = ["Fastest route", "Alternate route", "Scenic / longer route"]
    return f"{labels[index] if index < len(labels) else f'Route {index + 1}'} · {km:.0f} km · {minutes:.0f} min"


def register_api_routes(app: Flask) -> None:
    @app.get("/api/health")
    def health():
        models_dir = Path(__file__).resolve().parent.parent / "models"
        return jsonify({
            "status": "ok",
            "map_provider": "OpenStreetMap + OSRM (free)",
            "billing_required": False,
            "models_dir": str(models_dir),
            "models_present": models_dir.is_dir() and any(models_dir.glob("*.joblib")),
        })

    @app.get("/api/geocode")
    def geocode():
        q = (request.args.get("q") or "").strip()
        if not q:
            return jsonify({"error": "Missing query parameter q"}), 400
        try:
            data = _osm_get(NOMINATIM_URL, {
                "q": q,
                "format": "json",
                "limit": 1,
                "countrycodes": "ca",
            })
            if not data:
                return jsonify({"error": f"Address not found: {q}"}), 404
            hit = data[0]
            return jsonify({
                "lat": float(hit["lat"]),
                "lon": float(hit["lon"]),
                "display_name": hit.get("display_name", q),
            })
        except Exception as exc:
            return jsonify({"error": str(exc)}), 502

    @app.get("/api/directions")
    def directions():
        try:
            from_lat = float(request.args["from_lat"])
            from_lon = float(request.args["from_lon"])
            to_lat = float(request.args["to_lat"])
            to_lon = float(request.args["to_lon"])
        except (KeyError, ValueError):
            return jsonify({"error": "Need from_lat, from_lon, to_lat, to_lon"}), 400

        coords = f"{from_lon},{from_lat};{to_lon},{to_lat}"
        url = f"{OSRM_URL}/{coords}"
        try:
            data = _osm_get(url, {
                "alternatives": "true",
                "overview": "full",
                "geometries": "geojson",
                "steps": "false",
            })
            if data.get("code") != "Ok":
                return jsonify({"error": data.get("message", "Routing failed")}), 404

            routes = []
            for i, route in enumerate(data.get("routes", [])[:3]):
                routes.append({
                    "distance": route["distance"],
                    "duration": route["duration"],
                    "summary": _route_label(i, route["distance"] / 1000, route["duration"] / 60),
                    "geometry": route["geometry"]["coordinates"],
                })
            return jsonify({"routes": routes})
        except Exception as exc:
            return jsonify({"error": str(exc)}), 502

    @app.get("/api/presets")
    def presets():
        return jsonify({
            "weather": list(WEATHER_PRESETS.keys()),
            "labels": {
                "clear": "Clear — summer highway",
                "wet": "Wet / dawn — reduced grip",
                "blizzard": "Blizzard — Hwy 400 night",
                "ice_storm": "Ice storm — QEW rush",
            },
        })

    @app.post("/api/score-routes")
    def score_routes():
        body = request.get_json(force=True, silent=True) or {}
        routes = body.get("routes", [])
        if not routes:
            return jsonify({"error": "No routes provided"}), 400

        weather = body.get("weather", "clear")
        custom_alert = body.get("custom_alert", "")
        scored = score_routes_batch(routes, weather=weather, custom_alert=custom_alert)
        return jsonify({
            "routes": scored,
            "best_route_index": scored[0]["route_index"] if scored else 0,
        })


def disable_demo_cache(app: Flask) -> None:
    @app.after_request
    def _no_cache(response):
        if request.path == "/" or request.path.startswith("/static/"):
            response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        return response
