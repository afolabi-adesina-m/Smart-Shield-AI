"""Sign-in stays off unless AUTH_REQUIRED and an admin are both set."""

from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path

import bcrypt

sys.path.insert(0, str(Path(__file__).resolve().parent))

from engine_loader import prepare_engine  # noqa: E402

prepare_engine()

from flask import Flask  # noqa: E402

from auth_gate import configure_auth  # noqa: E402
from flask_common import register_api_routes  # noqa: E402

PASSWORD = "test-pass-not-real"
USERNAME = "demo-admin"


def _app() -> Flask:
    app = Flask(__name__)
    register_api_routes(app)
    return app


class AuthGateTests(unittest.TestCase):
    def setUp(self):
        self._saved = {
            name: os.environ.get(name)
            for name in ("AUTH_REQUIRED", "ADMIN_USER", "ADMIN_PASSWORD", "ADMIN_PASSWORD_HASH", "AUTH_SECRET")
        }
        for name in self._saved:
            os.environ.pop(name, None)

    def tearDown(self):
        for name, value in self._saved.items():
            if value is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = value
        configure_auth()

    def test_default_is_open(self):
        client = _app().test_client()
        health = client.get("/api/health")
        self.assertEqual(health.status_code, 200)
        status = client.get("/api/auth/status")
        self.assertEqual(status.status_code, 200)
        self.assertFalse(status.get_json()["auth_required"])
        scored = client.post("/api/score-routes", json={})
        self.assertNotEqual(scored.status_code, 401)

    def test_required_without_user_stays_open(self):
        os.environ["AUTH_REQUIRED"] = "true"
        client = _app().test_client()
        self.assertFalse(client.get("/api/auth/status").get_json()["auth_required"])
        self.assertNotEqual(client.post("/api/score-routes", json={}).status_code, 401)

    def test_login_gates_scoring_and_navigation(self):
        os.environ["AUTH_REQUIRED"] = "true"
        os.environ["ADMIN_USER"] = USERNAME
        os.environ["ADMIN_PASSWORD_HASH"] = bcrypt.hashpw(PASSWORD.encode(), bcrypt.gensalt()).decode()
        os.environ["AUTH_SECRET"] = "test-secret-not-for-production"
        client = _app().test_client()
        self.assertEqual(client.get("/api/health").status_code, 200)
        self.assertTrue(client.get("/api/auth/status").get_json()["auth_required"])
        self.assertEqual(client.post("/api/score-routes", json={"routes": []}).status_code, 401)
        self.assertEqual(client.get("/api/directions?from_lat=1&from_lon=2&to_lat=3&to_lon=4").status_code, 401)
        bad = client.post("/api/auth/login", json={"username": USERNAME, "password": "nope"})
        self.assertEqual(bad.status_code, 401)
        good = client.post("/api/auth/login", json={"username": USERNAME, "password": PASSWORD})
        self.assertEqual(good.status_code, 200)
        token = good.get_json()["token"]
        self.assertTrue(token)
        headers = {"Authorization": f"Bearer {token}"}
        self.assertTrue(client.get("/api/auth/status", headers=headers).get_json()["authenticated"])
        scored = client.post("/api/score-routes", json={"routes": []}, headers=headers)
        self.assertNotEqual(scored.status_code, 401)
        self.assertEqual(client.get("/api/config").status_code, 200)


if __name__ == "__main__":
    unittest.main()
