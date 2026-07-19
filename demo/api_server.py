"""
Smart-Shield map demo — localhost API + free OpenStreetMap / OSRM UI.

No Google API key or billing required.

Run:
    conda activate ai_work_final
    cd demo
    pip install -r requirements-demo.txt
    python api_server.py          # Desktop → http://127.0.0.1:5050
    python mobile_server.py       # Mobile  → http://127.0.0.1:5051

Open: http://127.0.0.1:5050  (desktop)
      http://127.0.0.1:5051  (iPhone / Android portrait)
"""

from __future__ import annotations

import os

from dotenv import load_dotenv
from flask import Flask, render_template
from flask_cors import CORS

from flask_common import disable_demo_cache, register_api_routes

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

APP = Flask(__name__, static_folder="static", template_folder="templates")
CORS(APP)
register_api_routes(APP)
disable_demo_cache(APP)

PORT = int(os.getenv("SMART_SHIELD_PORT", "5050"))
MOBILE_PORT = int(os.getenv("SMART_SHIELD_MOBILE_PORT", "5051"))


@APP.get("/")
def index():
    return render_template("index.html")


if __name__ == "__main__":
    print(f"\n  Smart-Shield DESKTOP demo → http://127.0.0.1:{PORT}")
    print(f"  Smart-Shield MOBILE demo  → http://127.0.0.1:{MOBILE_PORT}  (run mobile_server.py)")
    print("  Uses OpenStreetMap + OSRM — no API key or billing.\n")
    APP.run(host="127.0.0.1", port=PORT, debug=False)
