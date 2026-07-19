#!/usr/bin/env python3
"""
Execute a capstone notebook headlessly, save outputs in place, then run post-run updates.

Usage:
  python scripts/run_notebook_pipeline.py
  python scripts/run_notebook_pipeline.py --notebook notebooks/capstone.ipynb
  python scripts/run_notebook_pipeline.py --timeout 7200
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import nbformat
from nbclient import NotebookClient
from nbclient.exceptions import CellExecutionError

from notebook_utils import find_project_root
from post_notebook_run import main as post_run_main


def execute_notebook(nb_path: Path, timeout: int | None) -> None:
    nb = nbformat.read(nb_path, as_version=4)
    client = NotebookClient(
        nb,
        timeout=timeout,
        kernel_name="python3",
        resources={"metadata": {"path": str(nb_path.parent)}},
    )
    try:
        client.execute()
    except CellExecutionError as exc:
        nbformat.write(nb, nb_path)
        raise SystemExit(f"Notebook execution failed — partial outputs saved to {nb_path}\n{exc}") from exc
    nbformat.write(nb, nb_path)


def main() -> int:
    parser = argparse.ArgumentParser(description="Execute notebook and refresh docs")
    parser.add_argument("--notebook", default="notebooks/capstone.ipynb")
    parser.add_argument("--timeout", type=int, default=7200, help="Per-cell timeout in seconds (default 2h)")
    parser.add_argument("--quiet", action="store_true")
    args = parser.parse_args()

    project = find_project_root()
    nb_path = project / args.notebook
    if not nb_path.is_file():
        print(f"Notebook not found: {nb_path}", file=sys.stderr)
        return 1

    if not args.quiet:
        print(f"[pipeline] executing {nb_path.relative_to(project)} …")
    execute_notebook(nb_path, timeout=args.timeout)
    if not args.quiet:
        print(f"[pipeline] saved outputs to {nb_path.name}")

    # Delegate to post-run (sync + enhance + docs)
    post_args = ["--notebook", "notebooks/capstone_with_results.ipynb"]
    if nb_path.name == "capstone.ipynb":
        post_args += ["--sync-from", "notebooks/capstone.ipynb"]
    elif nb_path.name == "capstone_with_results.ipynb":
        post_args = ["--notebook", "notebooks/capstone_with_results.ipynb"]

    if args.quiet:
        post_args.append("--quiet")

    old_argv = sys.argv
    sys.argv = ["post_notebook_run.py", *post_args]
    try:
        return post_run_main()
    finally:
        sys.argv = old_argv


if __name__ == "__main__":
    sys.exit(main())
