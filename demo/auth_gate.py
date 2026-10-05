"""Optional sign-in for the demo API.

Off unless AUTH_REQUIRED is true and an admin user is configured.
One env-seeded account. Not a production identity provider.
Passwords are checked with bcrypt. The browser and the phone send a
signed token. Nothing here is written into git.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import os
import sys
import time
from typing import Any

log = logging.getLogger("smartshield.auth")

TOKEN_TTL_S = 12 * 60 * 60
LOGIN_WINDOW_S = 10 * 60
LOGIN_LIMIT = 8

# Scoring and navigation. Health and the sign-in routes stay public.
PROTECTED = {
    ("POST", "/api/score-routes"),
    ("GET", "/api/directions"),
    ("POST", "/api/road-context"),
    ("POST", "/api/road-corridor"),
    ("GET", "/api/speed-limit"),
    ("GET", "/api/safe-speed"),
    ("POST", "/api/test-loop"),
}

_state: dict[str, Any] = {
    "enforced": False,
    "user": "",
    "password_hash": "",
    "secret": "",
    "open_warning": False,
}
_failures: dict[str, list[float]] = {}


def _flag(name: str) -> bool:
    return os.getenv(name, "").strip().lower() in {"1", "true", "yes", "on"}


def _warn(message: str) -> None:
    log.warning(message)
    print(f"Smart-Shield auth: {message}", file=sys.stderr)


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _b64decode(text: str) -> bytes:
    pad = "=" * (-len(text) % 4)
    return base64.urlsafe_b64decode((text + pad).encode("ascii"))


def _same(left: str, right: str) -> bool:
    a = left.encode("utf-8")
    b = right.encode("utf-8")
    if len(a) != len(b):
        return False
    return hmac.compare_digest(a, b)


def configure_auth() -> bool:
    """Read the environment and decide whether sign-in is enforced."""
    required = _flag("AUTH_REQUIRED")
    user = os.getenv("ADMIN_USER", "").strip()
    password_hash = os.getenv("ADMIN_PASSWORD_HASH", "").strip()
    password = os.getenv("ADMIN_PASSWORD", "")
    secret = os.getenv("AUTH_SECRET", "").strip()

    if not required:
        if not _state["open_warning"]:
            _warn("AUTH_REQUIRED is off. Scoring and navigation APIs are open. This is the demo default.")
            _state["open_warning"] = True
        _state.update(enforced=False, user="", password_hash="", secret="")
        _failures.clear()
        return False

    if not user or (not password_hash and not password):
        _warn(
            "AUTH_REQUIRED is set but ADMIN_USER and a password hash are missing. "
            "Staying open so a teammate can still demo."
        )
        _state.update(enforced=False, user="", password_hash="", secret="")
        return False

    if not password_hash:
        import bcrypt

        password_hash = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("ascii")
        _warn(
            "ADMIN_PASSWORD was hashed in memory at boot. Copy this into ADMIN_PASSWORD_HASH, "
            f"then remove ADMIN_PASSWORD: {password_hash}"
        )

    if not secret:
        import secrets

        secret = secrets.token_urlsafe(32)
        _warn("AUTH_SECRET is unset. Tokens stop working when this process restarts.")

    _state.update(enforced=True, user=user, password_hash=password_hash, secret=secret)
    _warn("Sign-in is on for scoring and navigation. One env-seeded admin. Not a production identity provider.")
    return True


def enforced() -> bool:
    return bool(_state["enforced"])


def issue_token(username: str) -> str:
    payload = {"sub": username, "exp": int(time.time()) + TOKEN_TTL_S}
    body = _b64(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    sig = hmac.new(_state["secret"].encode("utf-8"), body.encode("ascii"), hashlib.sha256).digest()
    return f"{body}.{_b64(sig)}"


def verify_token(token: str) -> str | None:
    if not token or "." not in token or not _state["secret"]:
        return None
    body, sig = token.split(".", 1)
    expected = hmac.new(_state["secret"].encode("utf-8"), body.encode("ascii"), hashlib.sha256).digest()
    try:
        given = _b64decode(sig)
    except Exception:
        return None
    if not hmac.compare_digest(expected, given):
        return None
    try:
        payload = json.loads(_b64decode(body))
    except Exception:
        return None
    if int(payload.get("exp") or 0) < time.time():
        return None
    subject = str(payload.get("sub") or "")
    if not _same(subject, _state["user"]):
        return None
    return subject


def check_password(username: str, password: str) -> bool:
    import bcrypt

    user_ok = _same(username, _state["user"])
    try:
        secret_ok = bcrypt.checkpw(password.encode("utf-8"), _state["password_hash"].encode("utf-8"))
    except ValueError:
        secret_ok = False
    return bool(user_ok and secret_ok)


def login_blocked(ip: str) -> bool:
    now = time.time()
    recent = [stamp for stamp in _failures.get(ip, []) if now - stamp < LOGIN_WINDOW_S]
    _failures[ip] = recent
    return len(recent) >= LOGIN_LIMIT


def note_failure(ip: str) -> None:
    _failures.setdefault(ip, []).append(time.time())


def bearer_token() -> str:
    from flask import request

    header = request.headers.get("Authorization", "")
    if header.lower().startswith("bearer "):
        return header[7:].strip()
    return ""


def current_user() -> str | None:
    if not enforced():
        return None
    return verify_token(bearer_token())


def client_ip() -> str:
    from flask import request

    forwarded = request.headers.get("X-Forwarded-For", "")
    if forwarded:
        return forwarded.split(",")[0].strip() or "local"
    return request.remote_addr or "local"


def guard():
    """Block scoring and navigation when sign-in is enforced."""
    from flask import jsonify, request

    if request.method == "OPTIONS" or not enforced():
        return None
    if request.path == "/api/health" or request.path.startswith("/api/auth/"):
        return None
    if (request.method, request.path) not in PROTECTED:
        return None
    if current_user():
        return None
    return jsonify({"error": "Sign in required"}), 401
