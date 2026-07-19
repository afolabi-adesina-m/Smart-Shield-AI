#!/usr/bin/env python3
"""Install or refresh the post-run auto-update cell in both capstone notebooks."""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from notebook_utils import ensure_post_run_cell, find_project_root


def main() -> int:
    project = find_project_root()
    changed = []
    for nb, sync in [
        ("notebooks/capstone.ipynb", "capstone.ipynb"),
        ("notebooks/capstone_with_results.ipynb", None),
    ]:
        path = project / nb
        if ensure_post_run_cell(path, sync_from=sync):
            changed.append(nb)
            print(f"Added/updated post-run cell in {nb}")
        else:
            print(f"Post-run cell already present in {nb}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
