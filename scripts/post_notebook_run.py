#!/usr/bin/env python3
"""
After a notebook Run All (or headless execute), sync outputs, refresh annotations,
and rebuild explanation docs.

Usage:
  python scripts/post_notebook_run.py
  python scripts/post_notebook_run.py --notebook notebooks/capstone_with_results.ipynb
  python scripts/post_notebook_run.py --sync-from notebooks/capstone.ipynb
"""
from __future__ import annotations

import argparse
import subprocess
import sys
import time
from pathlib import Path

from notebook_utils import find_project_root, sync_code_outputs


def _enhance_notebook(project: Path, nb_rel: str) -> None:
    enhance_script = project / "archive" / "scripts" / "enhance_notebook_annotations.py"
    if not enhance_script.is_file():
        print(f"[post_run] skip enhance — missing {enhance_script}")
        return
    subprocess.run(
        [sys.executable, str(enhance_script), "--notebook", nb_rel],
        cwd=project,
        check=True,
    )


def _build_docs(project: Path, quiet: bool) -> None:
    cmd = [sys.executable, str(project / "explanations" / "build_all.py")]
    if quiet:
        cmd.append("--quiet")
    subprocess.run(cmd, cwd=project, check=True)


def main() -> int:
    parser = argparse.ArgumentParser(description="Post-run notebook save + doc refresh")
    parser.add_argument(
        "--notebook",
        default="notebooks/capstone_with_results.ipynb",
        help="Notebook to enhance and use for explanation scans",
    )
    parser.add_argument(
        "--sync-from",
        default=None,
        help="Copy code-cell outputs from this notebook into --notebook first",
    )
    parser.add_argument("--wait", type=float, default=0.0, help="Seconds to wait for editor auto-save")
    parser.add_argument("--skip-enhance", action="store_true")
    parser.add_argument("--skip-docs", action="store_true")
    parser.add_argument("--quiet", action="store_true")
    args = parser.parse_args()

    project = find_project_root()
    target = project / args.notebook
    if not target.is_file():
        print(f"[post_run] error: notebook not found: {target}", file=sys.stderr)
        return 1

    if args.wait:
        time.sleep(args.wait)

    if args.sync_from:
        source = project / args.sync_from
        if not source.is_file():
            print(f"[post_run] error: sync source not found: {source}", file=sys.stderr)
            return 1
        n = sync_code_outputs(source, target)
        if not args.quiet:
            print(f"[post_run] synced outputs for {n} code cells: {args.sync_from} -> {args.notebook}")

    if not args.skip_enhance:
        if not args.quiet:
            print("[post_run] refreshing notebook annotations…")
        _enhance_notebook(project, args.notebook)

    folding_script = project / "scripts" / "apply_section_folding.py"
    if folding_script.is_file():
        if not args.quiet:
            print("[post_run] refreshing collapsible section folding…")
        subprocess.run([sys.executable, str(folding_script)], cwd=project, check=True)

    if not args.skip_docs:
        if not args.quiet:
            print("[post_run] rebuilding explanations/ …")
        _build_docs(project, quiet=args.quiet)

    if not args.quiet:
        print("[post_run] done.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
