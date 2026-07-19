#!/usr/bin/env python3
"""Make vision notebook cells self-heal TORCH_OK / path if bootstrap was skipped."""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

GUARD = '''# Ensure runtime if PART BOOTSTRAP was skipped
if "TORCH_OK" not in globals():
    import sys
    from pathlib import Path as _P
    for _base in [_P.cwd(), *_P.cwd().parents]:
        if (_base / "src" / "vision_brain.py").is_file():
            if str(_base / "src") not in sys.path:
                sys.path.insert(0, str(_base / "src"))
            if "DATA" not in globals():
                _d = _base / "Data"
                globals()["DATA"] = _d if _d.is_dir() else _base / "data"
            if "REPO_ROOT" not in globals():
                globals()["REPO_ROOT"] = _base
            break
    try:
        import torch  # noqa: F401
        TORCH_OK = True
    except Exception:
        TORCH_OK = False

'''

TARGETS = [
    ROOT / "notebooks" / "capstone_with_results.ipynb",
    ROOT / "notebooks" / "parts" / "02_vision_brain.ipynb",
]

MARKERS = (
    "6.2  Fine-tune ResNet18",
    "6.2b  Train autoencoder",
    "6.2d  Compare ResNet",
    "6.2c  Latent space",
)


def _src_list(text: str) -> list:
    lines = text.split("\n")
    if not lines:
        return []
    # preserve trailing content; Jupyter often omits final newline on last line
    if text.endswith("\n"):
        return [ln + "\n" for ln in lines[:-1]] + ([lines[-1] + "\n"] if lines[-1] != "" else [])
    return [ln + "\n" for ln in lines[:-1]] + [lines[-1]]


def patch_nb(path: Path) -> int:
    if not path.is_file():
        print(f"skip missing {path}")
        return 0
    nb = json.loads(path.read_text(encoding="utf-8"))
    n = 0
    for cell in nb.get("cells", []):
        if cell.get("cell_type") != "code":
            continue
        src = "".join(cell.get("source", []))
        if not any(m in src[:200] for m in MARKERS):
            continue
        if "Ensure runtime if PART BOOTSTRAP was skipped" in src:
            continue
        # Insert guard right after the banner comment line(s)
        lines = src.splitlines(keepends=True)
        insert_at = 0
        while insert_at < len(lines) and (
            lines[insert_at].startswith("#") or lines[insert_at].strip() == ""
        ):
            insert_at += 1
        new_src = "".join(lines[:insert_at]) + GUARD + "".join(lines[insert_at:])
        cell["source"] = _src_list(new_src if new_src.endswith("\n") else new_src)
        # normalize via join/split so last line has no forced weirdness
        joined = "".join(cell["source"])
        cell["source"] = [ln + "\n" for ln in joined.rstrip("\n").split("\n")[:-1]] + [
            joined.rstrip("\n").split("\n")[-1]
        ]
        n += 1
    if n:
        path.write_text(json.dumps(nb, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{path.name}: patched {n} cells")
    return n


def patch_part_markdown(path: Path) -> None:
    if not path.is_file():
        return
    nb = json.loads(path.read_text(encoding="utf-8"))
    for cell in nb["cells"]:
        if cell.get("cell_type") != "markdown":
            continue
        src = "".join(cell.get("source", []))
        if "Satellite notebook split" in src and "Run the PART BOOTSTRAP" not in src:
            note = (
                "\n\n⚠️ **Run the PART BOOTSTRAP cell first** (defines `TORCH_OK`, paths, imports). "
                "Then run vision cells in order: 6.1 → 6.2 → 6.2b → 6.2d → 6.2c → sync.\n"
            )
            cell["source"] = [src.rstrip() + note]
            path.write_text(json.dumps(nb, ensure_ascii=False, indent=1), encoding="utf-8")
            print(f"{path.name}: added bootstrap reminder")
        break


def main() -> None:
    total = 0
    for p in TARGETS:
        total += patch_nb(p)
    patch_part_markdown(ROOT / "notebooks" / "parts" / "02_vision_brain.ipynb")
    print(f"done ({total} cells)")


if __name__ == "__main__":
    main()
