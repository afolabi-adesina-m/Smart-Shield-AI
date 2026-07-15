#!/usr/bin/env python3
"""
Bidirectional sync between capstone_with_results.ipynb and notebooks/parts/*.ipynb.

Matching uses code-cell markers (# ── ...). Markdown cells are synced only when
--include-markdown is set (matched by first H2/H3 heading line).

Usage:
  # Push main → parts (after editing the master notebook)
  python scripts/sync_notebook_parts.py --direction main-to-parts

  # Pull parts → main (after running a lighter satellite notebook)
  python scripts/sync_notebook_parts.py --direction parts-to-main

  # Sync both source + outputs (default: outputs only for parts→main, both for main→parts)
  python scripts/sync_notebook_parts.py --direction parts-to-main --sync-source
"""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

from notebook_utils import cell_marker, find_project_root, load_notebook, save_notebook

PART_SPECS = [
    {
        "file": "01_charter_eda_features.ipynb",
        "title": "Part 01 — Charter, Literature, EDA & Features",
        "start_section": "## Section 0b",
        "end_section": "## Section 6.1",  # exclusive
        "fallback_range": (0, 101),
    },
    {
        "file": "02_vision_brain.ipynb",
        "title": "Part 02 — Vision Brain (ResNet + Autoencoder)",
        "start_section": "## Section 6.1",
        "end_section": "## Section 7",
        "fallback_range": (101, 121),
    },
    {
        "file": "03_tabular_ml.ipynb",
        "title": "Part 03 — Tabular ML Training & Ethics",
        "start_section": "## Section 7",
        "end_section": "## Section 9.5",
        "fallback_range": (121, 182),
    },
    {
        "file": "04_fusion_deploy.ipynb",
        "title": "Part 04 — Unseen Eval, Fusion & Deployment",
        "start_section": "## Section 9.5",
        "end_section": None,
        "fallback_range": (182, None),
    },
]


def _md_heading(cell: dict) -> str:
    if cell.get("cell_type") != "markdown":
        return ""
    src = "".join(cell.get("source", [])).strip()
    for line in src.splitlines():
        if line.startswith("## ") or line.startswith("### ") or line.startswith("# "):
            return line.strip()
    return src[:80]


def _find_section_index(cells: list, heading_prefix: str | None) -> int | None:
    if heading_prefix is None:
        return len(cells)
    for i, cell in enumerate(cells):
        if cell.get("cell_type") != "markdown":
            continue
        src = "".join(cell.get("source", [])).lstrip()
        if src.startswith(heading_prefix) or heading_prefix in src.splitlines()[0] if src else False:
            # Prefer startswith on first line
            first = src.splitlines()[0] if src else ""
            if first.startswith(heading_prefix) or heading_prefix in first:
                return i
    # Fuzzy: heading text without emoji quirks
    key = re.sub(r"[^a-z0-9]+", "", heading_prefix.lower())
    for i, cell in enumerate(cells):
        if cell.get("cell_type") != "markdown":
            continue
        first = "".join(cell.get("source", [])).strip().splitlines()
        if not first:
            continue
        compact = re.sub(r"[^a-z0-9]+", "", first[0].lower())
        if key and key in compact:
            return i
    return None


def _bootstrap_cell(part_title: str) -> dict:
    src = f'''# ── PART BOOTSTRAP: {part_title} ──
# Lightweight satellite notebook — syncs back into notebooks/capstone_with_results.ipynb
import sys
from pathlib import Path

def _find_root() -> Path:
    for base in [Path.cwd(), *Path.cwd().parents]:
        if (base / "src" / "vision_brain.py").is_file() and (base / "explanations" / "build_all.py").is_file():
            return base
        if (base / "src" / "vision_brain.py").is_file():
            return base
    return Path.cwd().parent if Path.cwd().name in {{"notebooks", "parts"}} else Path.cwd()

REPO_ROOT = _find_root()
SRC = REPO_ROOT / "src"
DATA = REPO_ROOT / "Data"
if not DATA.is_dir():
    DATA = REPO_ROOT / "data"
sys.path.insert(0, str(SRC))
sys.path.insert(0, str(REPO_ROOT / "scripts")) if (REPO_ROOT / "scripts").is_dir() else None

try:
    import torch
    TORCH_OK = True
except Exception:
    TORCH_OK = False

# Optional shared helpers used by several sections
try:
    from cm_helpers import plot_confusion_matrices_pair  # noqa: F401
except Exception:
    plot_confusion_matrices_pair = None

import numpy as np  # noqa: F401
import pandas as pd  # noqa: F401
import matplotlib.pyplot as plt  # noqa: F401

print(f"Part notebook ready | root={{REPO_ROOT}} | TORCH_OK={{TORCH_OK}} | DATA={{DATA}}")
print("When finished: run the last cell to sync outputs → capstone_with_results.ipynb")
'''
    return {
        "cell_type": "code",
        "execution_count": None,
        "id": "part_bootstrap",
        "metadata": {"tags": ["bootstrap"]},
        "outputs": [],
        "source": [line + "\n" for line in src.strip("\n").split("\n")],
    }


def _part_sync_cell(part_file: str) -> dict:
    src = f'''# ── PART SYNC → main notebook ──
import subprocess
import sys
from pathlib import Path

def _find_root() -> Path:
    for base in [Path.cwd(), *Path.cwd().parents]:
        if (base / "scripts" / "sync_notebook_parts.py").is_file():
            return base
    return Path.cwd()

_ROOT = _find_root()
rc = subprocess.run(
    [sys.executable, str(_ROOT / "scripts" / "sync_notebook_parts.py"),
     "--direction", "parts-to-main", "--only", "{part_file}"],
    cwd=_ROOT,
).returncode
print("Synced to capstone_with_results.ipynb" if rc == 0 else f"Sync failed (exit {{rc}})")
'''
    return {
        "cell_type": "code",
        "execution_count": None,
        "id": "part_sync_to_main",
        "metadata": {"tags": ["post-run", "auto-update"]},
        "outputs": [],
        "source": [line + "\n" for line in src.strip("\n").split("\n")],
    }


def _nb_skeleton(title: str) -> dict:
    return {
        "nbformat": 4,
        "nbformat_minor": 5,
        "metadata": {
            "kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"},
            "language_info": {"name": "python", "pygments_lexer": "ipython3"},
        },
        "cells": [
            {
                "cell_type": "markdown",
                "id": "part_title",
                "metadata": {},
                "source": [
                    f"# {title}\n",
                    "\n",
                    "Satellite notebook split from `capstone_with_results.ipynb` to keep the master lighter to open.\n",
                    "Outputs/source sync automatically via `scripts/sync_notebook_parts.py` "
                    "(run the final sync cell).\n",
                ],
            }
        ],
    }


def slice_main_cells(main_nb: dict, spec: dict) -> list:
    cells = main_nb["cells"]
    start = _find_section_index(cells, spec["start_section"])
    end = _find_section_index(cells, spec["end_section"]) if spec["end_section"] else len(cells)
    if start is None or end is None or start >= (end or 0):
        a, b = spec["fallback_range"]
        return cells[a:b]
    return cells[start:end]


def write_parts_from_main(project: Path) -> list[Path]:
    main_path = project / "notebooks" / "capstone_with_results.ipynb"
    main = load_notebook(main_path)
    parts_dir = project / "notebooks" / "parts"
    parts_dir.mkdir(parents=True, exist_ok=True)
    written = []
    for spec in PART_SPECS:
        out_path = parts_dir / spec["file"]
        body = slice_main_cells(main, spec)
        # Drop existing bootstrap / sync / post-run markers if re-sliced
        clean = []
        for cell in body:
            src = "".join(cell.get("source", []))
            if "PART BOOTSTRAP" in src or "PART SYNC → main" in src or "POST-RUN: save & refresh" in src:
                continue
            clean.append(cell)
        nb = _nb_skeleton(spec["title"])
        # fix bootstrap source last newline
        boot = _bootstrap_cell(spec["title"])
        if boot["source"]:
            boot["source"][-1] = boot["source"][-1].rstrip("\n")
        sync = _part_sync_cell(spec["file"])
        if sync["source"]:
            sync["source"][-1] = sync["source"][-1].rstrip("\n")
        nb["cells"] = [nb["cells"][0], boot, *clean, sync]
        save_notebook(out_path, nb)
        written.append(out_path)
    return written


def _index_by_marker(nb: dict) -> dict[str, dict]:
    out = {}
    for cell in nb.get("cells", []):
        if cell.get("cell_type") != "code":
            continue
        marker = cell_marker(cell)
        if marker and "PART BOOTSTRAP" not in marker and "PART SYNC" not in marker and "POST-RUN" not in marker:
            out[marker] = cell
    return out


def sync_outputs_and_optional_source(
    source_nb: dict,
    target_nb: dict,
    *,
    sync_source: bool,
) -> int:
    src_map = _index_by_marker(source_nb)
    updated = 0
    for cell in target_nb.get("cells", []):
        if cell.get("cell_type") != "code":
            continue
        marker = cell_marker(cell)
        if marker not in src_map:
            continue
        src = src_map[marker]
        cell["execution_count"] = src.get("execution_count")
        cell["outputs"] = src.get("outputs", [])
        if sync_source:
            cell["source"] = src.get("source", cell.get("source"))
        updated += 1
    return updated


def sync_main_to_parts(project: Path, only: str | None, sync_source: bool) -> int:
    # Always refresh part skeletons from main ranges, then overlay marker sync
    write_parts_from_main(project)
    main = load_notebook(project / "notebooks" / "capstone_with_results.ipynb")
    total = 0
    for spec in PART_SPECS:
        if only and spec["file"] != only:
            continue
        part_path = project / "notebooks" / "parts" / spec["file"]
        part = load_notebook(part_path)
        n = sync_outputs_and_optional_source(main, part, sync_source=True)  # main owns source on this direction
        save_notebook(part_path, part)
        total += n
        print(f"  main → {spec['file']}: {n} code cells")
    return total


def sync_parts_to_main(project: Path, only: str | None, sync_source: bool) -> int:
    main_path = project / "notebooks" / "capstone_with_results.ipynb"
    main = load_notebook(main_path)
    total = 0
    for spec in PART_SPECS:
        if only and spec["file"] != only:
            continue
        part_path = project / "notebooks" / "parts" / spec["file"]
        if not part_path.is_file():
            print(f"  skip missing {spec['file']}")
            continue
        part = load_notebook(part_path)
        n = sync_outputs_and_optional_source(part, main, sync_source=sync_source)
        total += n
        print(f"  {spec['file']} → main: {n} code cells (source={'yes' if sync_source else 'outputs only'})")
    save_notebook(main_path, main)
    return total


def main() -> int:
    parser = argparse.ArgumentParser(description="Sync capstone notebook parts")
    parser.add_argument(
        "--direction",
        choices=["main-to-parts", "parts-to-main", "init-parts"],
        default="init-parts",
    )
    parser.add_argument("--only", default=None, help="Single part filename, e.g. 02_vision_brain.ipynb")
    parser.add_argument(
        "--sync-source",
        action="store_true",
        help="Also copy cell source (default for main→parts; optional for parts→main)",
    )
    args = parser.parse_args()
    project = find_project_root()

    if args.direction == "init-parts":
        paths = write_parts_from_main(project)
        print(f"Wrote {len(paths)} satellite notebooks under notebooks/parts/")
        for p in paths:
            print(f"  • {p.relative_to(project)}")
        return 0

    if args.direction == "main-to-parts":
        n = sync_main_to_parts(project, args.only, sync_source=True)
        print(f"Done. Synced {n} cells main → parts.")
        return 0

    n = sync_parts_to_main(project, args.only, sync_source=args.sync_source)
    print(f"Done. Synced {n} cells parts → main.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
