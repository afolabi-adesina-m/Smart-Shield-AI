"""Capture post-fix ice-storm demo screenshot (requires playwright: pip install playwright)."""
from __future__ import annotations

import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
EVIDENCE = ROOT.parent / "improvements" / "speed-advisory-audit" / "evidence"
OUT = EVIDENCE / "ice_storm_toronto_barrie_postfix.png"


def main() -> int:
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("Install playwright: pip install playwright && playwright install chromium")
        return 1

    server = subprocess.Popen(
        [sys.executable, str(ROOT / "api_server.py")],
        cwd=str(ROOT),
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    time.sleep(2)

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            page = browser.new_page(viewport={"width": 1400, "height": 900})
            page.goto("http://127.0.0.1:5050", wait_until="networkidle", timeout=60000)
            page.select_option("#weather", "ice_storm")
            page.click("#btn-route")
            page.wait_for_selector(".route-card.best", timeout=120000)
            page.wait_for_selector("#high-risk-banner:not([hidden])", timeout=30000)
            EVIDENCE.mkdir(parents=True, exist_ok=True)
            page.screenshot(path=str(OUT), full_page=True)
            browser.close()
        print(f"Saved {OUT}")
        return 0
    finally:
        server.terminate()
        server.wait(timeout=10)


if __name__ == "__main__":
    raise SystemExit(main())
