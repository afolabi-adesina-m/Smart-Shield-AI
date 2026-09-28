"""Serve the manifest and service worker from the site root.

Scope has to be `/` so the installed app covers the map, not only `/static/`.
"""

from __future__ import annotations

from pathlib import Path

from flask import Flask, send_from_directory

STATIC = Path(__file__).resolve().parent / "static"


def register_pwa_routes(app: Flask) -> None:
    @app.get("/manifest.webmanifest")
    def web_manifest():
        response = send_from_directory(
            STATIC,
            "manifest.webmanifest",
            mimetype="application/manifest+json",
        )
        response.headers["Cache-Control"] = "no-cache"
        return response

    @app.get("/sw.js")
    def service_worker():
        response = send_from_directory(STATIC, "sw.js", mimetype="application/javascript")
        response.headers["Cache-Control"] = "no-cache"
        response.headers["Service-Worker-Allowed"] = "/"
        return response
