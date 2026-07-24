"""Shared pytest fixtures for the Smart-Shield test suite.

Run from the `demo/` folder (see tests/README.md for exact commands).
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

# tests/ lives inside demo/, so demo/ itself needs to be importable
# (that's where inference.py, Live_weather.py, api_server.py, etc. live).
DEMO_ROOT = Path(__file__).resolve().parent.parent
if str(DEMO_ROOT) not in sys.path:
    sys.path.insert(0, str(DEMO_ROOT))


@pytest.fixture()
def client():
    """Flask test client for the desktop app (api_server.py)."""
    import api_server

    api_server.APP.config.update(TESTING=True)
    with api_server.APP.test_client() as c:
        yield c


@pytest.fixture(autouse=True)
def _clear_live_caches():
    """Every test starts with cold caches so one test can't leak into another."""
    import Live_alerts
    import Live_weather

    Live_weather._cache.clear()
    Live_alerts._cache = (0.0, None)
    yield
    Live_weather._cache.clear()
    Live_alerts._cache = (0.0, None)
