# Smart-Shield test suite

Tests live in this folder:

- `test_live_weather.py` — Live_weather.py (Fix 3)
- `test_live_alerts.py` — Live_alerts.py (Fix 2)
- `test_score_routes_e2e.py` — the whole pipeline through the real Flask API

Every file has two kinds of tests:

| Kind | Marker | Needs network? | What it proves |
|---|---|---|---|
| Unit tests | (none) | No | Our logic (caching, fallback, risk math) is correct |
| Live tests | `@pytest.mark.live` | Yes | The data is *actually real-time*, not a stub |

## Setup (once)

```bash
cd demo
pip install -r requirements-test.txt --break-system-packages
```

(Drop `--break-system-packages` if you're using a venv/conda env — you should be, per the top of `api_server.py`.)

## Everyday workflow — run this before you commit

Fast, no network needed, safe for CI:

```bash
pytest -m "not live"
```

## Before a demo / to prove live data really works

Run this on your own machine with internet access:

```bash
pytest -m live
```

If a `live` test fails, it does **not** mean your code is broken — it means Open-Meteo or 511 Ontario is down, slow, or unreachable right now. Check that first before touching code.

## Run everything

```bash
pytest
```

## Run just one file

```bash
pytest testLive/test_live_weather.py
pytest testLive/test_live_alerts.py -m live      # only the live ones in that file
```

## Run with more detail (see each test name + reason for skips)

```bash
pytest -v -m "not live"
```

## Typical output you should see (unit tests, no network)

```
testLive/test_live_weather.py::TestCaching::test_reuses_cache_within_ttl PASSED
testLive/test_live_weather.py::TestFallbackSafety::test_returns_none_on_connection_error PASSED
...
testLive/test_score_routes_e2e.py::TestForcePresetOverride::test_force_preset_ignores_live_data PASSED
======================== X passed in Y.YYs ========================
```

## Suggested CI setup

In your CI pipeline (GitHub Actions, etc.), only run the fast unit tests automatically on every push:

```yaml
- run: pip install -r requirements-test.txt
- run: pytest -m "not live"
```

Run `pytest -m live` manually, or on a schedule (e.g. nightly), since it depends on two external services being up.
