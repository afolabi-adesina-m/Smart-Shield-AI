"""
Smart-Shield mobile map demo — portrait-first UI for iPhone & Android.

Run (separate from desktop demo on :5050):
    conda activate ai_work_final
    cd demo
    python mobile_server.py

Open on phone (same Wi‑Fi):
    http://<your-PC-LAN-IP>:5051

Simulator / desktop narrow window:
    http://127.0.0.1:5051
"""

from __future__ import annotations

import os
import socket

from dotenv import load_dotenv
from flask import Flask, render_template
from flask_cors import CORS

from flask_common import disable_demo_cache, register_api_routes

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

APP = Flask(__name__, static_folder="static", template_folder="templates")
CORS(APP)
register_api_routes(APP)
disable_demo_cache(APP)

MOBILE_PORT = int(os.getenv("SMART_SHIELD_MOBILE_PORT", "5051"))


@APP.get("/")
def mobile_index():
    return render_template("mobile.html")


def _lan_ip() -> str:
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except OSError:
        return "127.0.0.1"


if __name__ == "__main__":
    lan = _lan_ip()
    print("\n  Smart-Shield MOBILE demo (iPhone / Android)")
    print(f"  Local:   http://127.0.0.1:{MOBILE_PORT}")
    print(f"  Phone:   http://{lan}:{MOBILE_PORT}  (same Wi‑Fi as this PC)")
    print("  Desktop demo still on http://127.0.0.1:5050\n")
    APP.run(host="0.0.0.0", port=MOBILE_PORT, debug=False)
