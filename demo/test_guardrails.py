"""Rate limit, CORS, security headers, and input checks. No live geocoder."""

from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "demo"))

from engine_loader import prepare_engine  # noqa: E402

prepare_engine()

from flask import Flask  # noqa: E402

from flask_common import apply_public_cors, register_api_routes  # noqa: E402
from http_guard import DEFAULT_ORIGINS  # noqa: E402
from rate_limit import reset_rate_limits  # noqa: E402

ENV_KEYS = (
    "ALLOWED_ORIGINS",
    "SMART_SHIELD_CORS_ORIGINS",
    "RATE_LIMIT_ENABLED",
    "RATE_LIMIT_PER_MIN",
    "MAX_CONTENT_LENGTH",
)


def _app() -> Flask:
    app = Flask(__name__)
    apply_public_cors(app)
    register_api_routes(app)
    return app


class GuardrailTests(unittest.TestCase):
    def setUp(self):
        self._saved = {name: os.environ.get(name) for name in ENV_KEYS}
        for name in ENV_KEYS:
            os.environ.pop(name, None)
        reset_rate_limits()

    def tearDown(self):
        for name, value in self._saved.items():
            if value is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = value
        reset_rate_limits()

    def test_health_stays_open_when_a_route_is_limited(self):
        os.environ["RATE_LIMIT_PER_MIN"] = "2"
        client = _app().test_client()
        for _ in range(2):
            ok = client.get("/api/suggest?q=ab")
            self.assertEqual(ok.status_code, 200)
        blocked = client.get("/api/suggest?q=ab")
        self.assertEqual(blocked.status_code, 429)
        self.assertIn("Too many requests", blocked.get_json()["error"])
        health = client.get("/api/health")
        self.assertEqual(health.status_code, 200)
        self.assertEqual(health.get_json()["status"], "ok")

    def test_rate_limit_can_be_turned_off(self):
        os.environ["RATE_LIMIT_ENABLED"] = "false"
        os.environ["RATE_LIMIT_PER_MIN"] = "1"
        client = _app().test_client()
        self.assertEqual(client.get("/api/suggest?q=ab").status_code, 200)
        self.assertEqual(client.get("/api/suggest?q=ab").status_code, 200)

    def test_cors_allows_the_render_origin_and_blocks_others(self):
        client = _app().test_client()
        allowed = client.get("/api/health", headers={"Origin": "https://smart-shield-ai.onrender.com"})
        self.assertEqual(allowed.status_code, 200)
        self.assertEqual(allowed.headers.get("Access-Control-Allow-Origin"), "https://smart-shield-ai.onrender.com")
        expo = client.get("/api/health", headers={"Origin": "http://localhost:8081"})
        self.assertEqual(expo.headers.get("Access-Control-Allow-Origin"), "http://localhost:8081")
        foreign = client.get("/api/health", headers={"Origin": "https://evil.example"})
        self.assertEqual(foreign.status_code, 200)
        self.assertNotEqual(foreign.headers.get("Access-Control-Allow-Origin"), "https://evil.example")
        native = client.get("/api/health")
        self.assertEqual(native.status_code, 200)
        self.assertEqual(native.get_json()["status"], "ok")
        self.assertIsNone(native.headers.get("Access-Control-Allow-Origin"))
        self.assertIn("https://smart-shield-ai.onrender.com", DEFAULT_ORIGINS)

    def test_security_headers_on_api_responses(self):
        client = _app().test_client()
        resp = client.get("/api/health")
        self.assertIn("max-age=31536000", resp.headers.get("Strict-Transport-Security", ""))
        self.assertEqual(resp.headers.get("X-Content-Type-Options"), "nosniff")
        self.assertEqual(resp.headers.get("Referrer-Policy"), "strict-origin-when-cross-origin")
        self.assertEqual(resp.headers.get("X-Frame-Options"), "SAMEORIGIN")
        policy = resp.headers.get("Content-Security-Policy", "")
        self.assertIn("frame-ancestors 'self'", policy)
        self.assertIn("https://unpkg.com", policy)
        self.assertIn("https://tile.openstreetmap.org", policy)
        self.assertIn("https://tiles.openfreemap.org", policy)

    def test_validation_rejects_bad_shapes(self):
        client = _app().test_client()
        long_query = client.get("/api/suggest?q=" + ("a" * 121))
        self.assertEqual(long_query.status_code, 400)
        bad_bias = client.get("/api/suggest?q=Bay&lat=120&lon=-79")
        self.assertEqual(bad_bias.status_code, 400)
        bad_leg = client.get("/api/directions?from_lat=91&from_lon=0&to_lat=43&to_lon=-79")
        self.assertEqual(bad_leg.status_code, 400)
        alert = client.post("/api/score-routes", json={
            "routes": [{"distance_m": 1000, "duration_s": 60, "summary": "Bay"}],
            "custom_alert": "x" * 281,
        })
        self.assertEqual(alert.status_code, 400)
        self.assertIn("too long", alert.get_json()["error"].lower())
        many = client.post("/api/score-routes", json={
            "routes": [{"distance_m": 1, "duration_s": 1}] * 9,
        })
        self.assertEqual(many.status_code, 400)
        points = client.post("/api/score-routes", json={
            "routes": [{"distance_m": 1, "duration_s": 1}],
            "waypoints": [{"lat": 0, "lon": 0}] * 26,
        })
        self.assertEqual(points.status_code, 400)
        odd = client.post("/api/score-routes", json={
            "routes": [{"distance_m": 1, "duration_s": 1, "mid_lat": 400, "mid_lon": 10}],
        })
        self.assertEqual(odd.status_code, 400)

    def test_oversized_body_is_a_clean_400(self):
        os.environ["MAX_CONTENT_LENGTH"] = "64"
        client = _app().test_client()
        resp = client.post(
            "/api/score-routes",
            data="{" + ("x" * 200) + "}",
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, 400)
        self.assertIn("too large", resp.get_json()["error"].lower())


if __name__ == "__main__":
    unittest.main()
