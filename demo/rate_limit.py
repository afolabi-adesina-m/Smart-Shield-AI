"""In-process per-IP limit for the public demo API.

One gunicorn worker shares this memory. /api/health is not limited.
Each limited route has its own counter, so address search does not use up
the budget for directions. Set RATE_LIMIT_ENABLED=false to turn it off.
RATE_LIMIT_PER_MIN is the cap per route per IP per minute (default 120).
"""

from __future__ import annotations

import os
import threading
import time
from typing import Dict, Optional, Tuple

LIMITED = {
    ("POST", "/api/score-routes"),
    ("GET", "/api/directions"),
    ("POST", "/api/road-context"),
    ("GET", "/api/suggest"),
    ("GET", "/api/reverse"),
    ("GET", "/api/cameras"),
    ("POST", "/api/test-loop"),
}

_lock = threading.Lock()
_hits: Dict[Tuple[str, str, str, int], int] = {}


def reset_rate_limits() -> None:
    with _lock:
        _hits.clear()


def limit_per_minute() -> Optional[int]:
    flag = os.getenv("RATE_LIMIT_ENABLED", "true").strip().lower()
    if flag in {"0", "false", "no", "off"}:
        return None
    raw = os.getenv("RATE_LIMIT_PER_MIN", "120").strip() or "120"
    try:
        value = int(raw)
    except ValueError:
        value = 120
    return max(1, min(value, 100000))


def allow(ip: str, method: str, path: str, now: Optional[float] = None) -> bool:
    """True when this request may proceed."""
    if method == "OPTIONS" or (method, path) not in LIMITED:
        return True
    limit = limit_per_minute()
    if limit is None:
        return True
    moment = time.time() if now is None else now
    window = int(moment // 60)
    key = (ip or "local", method, path, window)
    with _lock:
        count = _hits.get(key, 0) + 1
        _hits[key] = count
        if len(_hits) > 4000:
            cutoff = window - 2
            for old in [item for item in _hits if item[3] < cutoff]:
                _hits.pop(old, None)
        return count <= limit
