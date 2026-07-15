"""Shared helpers for capstone notebook save/sync pipeline."""
from __future__ import annotations

import json
import re
from pathlib import Path


def find_project_root(start: Path | None = None) -> Path:
    start = start or Path.cwd()
    for base in [start, *start.parents]:
        if (base / "explanations" / "build_all.py").is_file():
            return base
        if (base / "src" / "vision_brain.py").is_file() and (base / "notebooks").is_dir():
            return base
    # Prefer script-relative root when launched from elsewhere
    script_guess = Path(__file__).resolve().parent.parent
    if (script_guess / "src" / "vision_brain.py").is_file():
        return script_guess
    raise FileNotFoundError("Could not locate Smart-Shield project root (missing explanations/build_all.py)")


def cell_marker(cell: dict) -> str:
    if cell.get("cell_type") != "code":
        return ""
    source = "".join(cell.get("source", []))
    for line in source.splitlines():
        line = line.strip()
        if line.startswith("# ──"):
            return line
    return source[:120]


def load_notebook(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def save_notebook(path: Path, nb: dict) -> None:
    path.write_text(json.dumps(nb, ensure_ascii=False, indent=1), encoding="utf-8")


def sync_code_outputs(source_path: Path, target_path: Path) -> int:
    """Copy execution_count + outputs from source code cells onto target (matched by marker)."""
    source = load_notebook(source_path)
    target = load_notebook(target_path)

    src_by_marker: dict[str, dict] = {}
    for cell in source.get("cells", []):
        if cell.get("cell_type") != "code":
            continue
        marker = cell_marker(cell)
        if marker:
            src_by_marker[marker] = cell

    updated = 0
    for cell in target.get("cells", []):
        if cell.get("cell_type") != "code":
            continue
        marker = cell_marker(cell)
        if marker not in src_by_marker:
            continue
        src = src_by_marker[marker]
        cell["execution_count"] = src.get("execution_count")
        cell["outputs"] = src.get("outputs", [])
        updated += 1

    save_notebook(target_path, target)
    return updated


POST_RUN_MARKER = "POST-RUN: save & refresh explanations"


def post_run_cell_source(*, sync_from: str | None) -> str:
  """Return source for the auto post-run code cell."""
  sync_block = ""
  if sync_from:
      sync_block = f'''
_SYNC_FROM = "notebooks/{sync_from}"
'''
  else:
      sync_block = '''
_SYNC_FROM = None
'''

  return f'''# ── {POST_RUN_MARKER} ──
import subprocess
import sys
import time
from pathlib import Path


def _find_root() -> Path:
    for base in [Path.cwd(), *Path.cwd().parents]:
        if (base / "explanations" / "build_all.py").is_file():
            return base
    return Path.cwd()


_ROOT = _find_root()
_TARGET = "notebooks/capstone_with_results.ipynb"
{sync_block}

print("Post-run: waiting for editor auto-save…")
time.sleep(2)

args = [
    sys.executable,
    str(_ROOT / "scripts" / "post_notebook_run.py"),
    "--notebook",
    _TARGET,
]
if _SYNC_FROM:
    args += ["--sync-from", _SYNC_FROM]

rc = subprocess.run(args, cwd=_ROOT).returncode
if rc == 0:
    print("Post-run complete — explanations and annotations updated.")
else:
    print(f"Post-run finished with exit code {{rc}} (see terminal output).")
'''


def ensure_post_run_cell(nb_path: Path, *, sync_from: str | None) -> bool:
    """Insert or refresh the post-run cell at the end of the notebook. Returns True if changed."""
    nb = load_notebook(nb_path)
    cells = nb.get("cells", [])

    # Remove any existing post-run cells
    filtered: list[dict] = []
    for cell in cells:
        if cell.get("cell_type") == "code":
            src = "".join(cell.get("source", []))
            if POST_RUN_MARKER in src:
                continue
        filtered.append(cell)

    new_cell = {
        "cell_type": "code",
        "execution_count": None,
        "id": "post_run_auto_update",
        "metadata": {"tags": ["post-run", "auto-update"]},
        "outputs": [],
        "source": [line + "\n" for line in post_run_cell_source(sync_from=sync_from).strip("\n").split("\n")],
    }
    # Last line without trailing newline per Jupyter convention
    if new_cell["source"]:
        new_cell["source"][-1] = new_cell["source"][-1].rstrip("\n")

    filtered.append(new_cell)
    if len(filtered) == len(cells) and cells and cells[-1].get("id") == "post_run_auto_update":
        return False

    nb["cells"] = filtered
    save_notebook(nb_path, nb)
    return True
