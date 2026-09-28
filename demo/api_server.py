"""
Smart-Shield map demo — Flask API + OpenStreetMap / OSRM UI.

No Google API key or billing required. Bind address, ports, and upstream
URLs come from the environment so the same app can run locally or on a
public host (see README, Live demo / deployment).

Run:
    cd demo
    pip install -r requirements-demo.txt
    python api_server.py
"""

from __future__ import annotations

import os
import sys

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

from engine_loader import prepare_engine

_ENGINE = prepare_engine()
print(f"Smart-Shield AI Enterprise: {_ENGINE['message']}", file=sys.stderr)

from flask import Flask, render_template

from flask_common import apply_public_cors, disable_demo_cache, register_api_routes
from pwa_routes import register_pwa_routes

APP = Flask(__name__, static_folder="static", template_folder="templates")
apply_public_cors(APP)
register_api_routes(APP)
register_pwa_routes(APP)
disable_demo_cache(APP)

# PORT is what Render, Railway, and Hugging Face set. SMART_SHIELD_PORT remains
# the local override when PORT is unset.
PORT = int(os.getenv("PORT", os.getenv("SMART_SHIELD_PORT", "5050")))
MOBILE_PORT = int(os.getenv("SMART_SHIELD_MOBILE_PORT", "5051"))
HOST = os.getenv("SMART_SHIELD_HOST", "0.0.0.0")


@APP.get("/")
def index():
    return render_template("index.html")


@APP.get("/mobile")
def mobile():
    """Same-origin mobile layout so one public process can serve both UIs."""
    return render_template("mobile.html")


if __name__ == "__main__":
    try:
        from vision_runtime import get_vision_runtime

        ready = get_vision_runtime().warmup()
        print(f"  Vision ResNet warmup: {'ready (GPU/CPU)' if ready else 'unavailable — proxy fallback'}")
    except Exception as exc:
        print(f"  Vision warmup skipped: {exc}")
    print(f"\n  Smart-Shield desktop UI on port {PORT}  (path /)")
    print(f"  Smart-Shield mobile UI  on port {PORT}  (path /mobile)")
    print(f"  Separate phone server: python mobile_server.py  (port {MOBILE_PORT})")
    print("  Uses OpenStreetMap + OSRM — no API key or billing.\n")
    APP.run(host=HOST, port=PORT, debug=False)
