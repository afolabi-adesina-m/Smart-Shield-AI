#!/usr/bin/env python3
"""
Add Excel-style collapsible sections to capstone notebooks.

Cursor / VS Code shows a ▶ arrow on markdown cells whose FIRST line is a heading
(## Section …). This script splits mixed section cells and marks them collapsed.

Usage:
  python scripts/apply_section_folding.py
  python scripts/apply_section_folding.py --expand-all
"""
from __future__ import annotations

import argparse
import json
import re
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NOTEBOOKS = [
    ROOT / "notebooks" / "capstone.ipynb",
    ROOT / "notebooks" / "capstone_with_results.ipynb",
]

NAVIGATOR_MARKER = "SECTION NAVIGATOR"
NAVIGATOR_ID = "section_navigator"
FOLD_TIP = "▶ **Fold arrow:** hover the **left margin** of this markdown cell"

KEEP_EXPANDED = (
    NAVIGATOR_MARKER,
    "Environment Setup",
    "Run All",
)

SECTION_MAIN = re.compile(r"^#{1,2}\s+Section\s", re.MULTILINE)
SECTION_SUB = re.compile(r"^###\s+Section\s", re.MULTILINE)
TITLE_MAIN = re.compile(r"^#\s+Ontario Smart-Shield", re.MULTILINE)
HEADING_LINE = re.compile(r"^(#{1,3})\s+(.+)$")


def _cell_text(cell: dict) -> str:
    return "".join(cell.get("source", []))


def _to_source(text: str) -> list[str]:
    lines = text.strip("\n").split("\n")
    if not lines:
        return []
    out = [ln + "\n" for ln in lines[:-1]]
    out.append(lines[-1])
    return out


def _first_heading_line(text: str) -> tuple[int, str, int] | None:
    for i, line in enumerate(text.splitlines()):
        m = HEADING_LINE.match(line.strip())
        if m:
            return i, line.strip(), len(m.group(1))
    return None


def is_section_header(cell: dict) -> bool:
    if cell.get("cell_type") != "markdown":
        return False
    text = _cell_text(cell)
    if NAVIGATOR_MARKER in text:
        return False
    return bool(SECTION_MAIN.search(text) or SECTION_SUB.search(text) or TITLE_MAIN.search(text))


def is_fold_header_cell(cell: dict) -> bool:
    return cell.get("metadata", {}).get("tags") and "section-fold-header" in cell["metadata"]["tags"]


def should_collapse(cell: dict) -> bool:
    text = _cell_text(cell)
    for keep in KEEP_EXPANDED:
        if keep.lower() in text.lower():
            return False
    return is_section_header(cell) or is_fold_header_cell(cell)


def navigator_cell() -> dict:
    body = f"""## {NAVIGATOR_MARKER}

### How to collapse / expand sections

The **▶ arrow does not appear on code cells** — only on **markdown section headers** below.

1. Find a cell that starts with `## Section 1`, `## Section 2`, etc.
2. **Hover your mouse on the far-left margin** of that markdown cell (not inside the text).
3. Click the **▶** chevron that appears to hide everything under that section.
4. Click again to expand.

If you still see no arrow, enable it in Cursor settings:
**Settings → search `show folding controls` → set to `always`**

| Section | Topic |
|---------|-------|
| Setup | Environment & packages |
| 0b | Literature review |
| 1 | Data inventory |
| 2 | Toronto EDA |
| 2b–2d | UK DfT, stats, Safety Score |
| 3–5 | Preprocessing & features |
| 6 | Vision Brain |
| 7 | Ethics audit |
| 8 | Model training |
| 9 | Summary |
| 10 | Deployment |

**Cell shortcuts:** `Ctrl+Shift+[` collapse all inputs · `Ctrl+Shift+]` collapse all outputs
"""
    return {
        "cell_type": "markdown",
        "id": NAVIGATOR_ID,
        "metadata": {"tags": ["section-navigator"]},
        "source": _to_source(body),
    }


def ensure_navigator(nb: dict) -> bool:
    cells = nb.get("cells", [])
    for i, cell in enumerate(cells):
        if cell.get("id") == NAVIGATOR_ID or NAVIGATOR_MARKER in _cell_text(cell):
            # Refresh instructions in place
            cells[i] = navigator_cell()
            return False

    insert_at = 1
    for i, cell in enumerate(cells):
        if cell.get("cell_type") != "markdown":
            continue
        text = _cell_text(cell)
        if TITLE_MAIN.search(text) or re.search(r"^#\s+Ontario", text, re.MULTILINE):
            insert_at = i + 1
            break

    cells.insert(insert_at, navigator_cell())
    nb["cells"] = cells
    return True


def split_section_headers(nb: dict) -> int:
    """Put each section heading on the first line of its own markdown cell (required for ▶ arrows)."""
    new_cells: list[dict] = []
    splits = 0

    for cell in nb.get("cells", []):
        if cell.get("cell_type") != "markdown" or not is_section_header(cell):
            new_cells.append(cell)
            continue

        if is_fold_header_cell(cell):
            new_cells.append(cell)
            continue

        text = _cell_text(cell)
        found = _first_heading_line(text)
        if not found:
            new_cells.append(cell)
            continue

        _idx, heading, _level = found
        lines = text.splitlines()
        before = "\n".join(lines[: found[0]]).strip()
        after = "\n".join(lines[found[0] + 1 :]).strip()

        # Already thin header cell (heading first, little else)
        first_line = lines[0].strip() if lines else ""
        if HEADING_LINE.match(first_line) and not after and (not before or before == "---"):
            header_cell = dict(cell)
            header_cell["source"] = _to_source(
                f"{heading}\n\n> {FOLD_TIP} — click to hide/show cells below until the next section."
            )
            meta = header_cell.setdefault("metadata", {})
            tags = list(meta.get("tags") or [])
            if "section-fold-header" not in tags:
                tags.append("section-fold-header")
            meta["tags"] = tags
            new_cells.append(header_cell)
            continue

        header_id = cell.get("id") or f"sec_{uuid.uuid4().hex[:8]}"
        header_cell = {
            "cell_type": "markdown",
            "id": f"{header_id}_fold",
            "metadata": {
                "tags": ["section-fold-header", "section-header"],
                "jp-MarkdownHeadingCollapsed": cell.get("metadata", {}).get(
                    "jp-MarkdownHeadingCollapsed", True
                ),
            },
            "source": _to_source(
                f"{heading}\n\n> {FOLD_TIP} — click to hide/show cells below until the next section."
            ),
        }
        new_cells.append(header_cell)
        splits += 1

        body_chunks: list[str] = []
        if before and before not in ("---",):
            body_chunks.append(before)
        if after:
            body_chunks.append(after)
        if body_chunks:
            body_cell = {
                "cell_type": "markdown",
                "id": f"{header_id}_body",
                "metadata": {},
                "source": _to_source("\n\n".join(body_chunks)),
            }
            new_cells.append(body_cell)
        continue

    nb["cells"] = new_cells
    return splits


def apply_folding(nb: dict, *, collapse: bool = True) -> tuple[int, int]:
    collapsed = 0
    expanded = 0
    for cell in nb.get("cells", []):
        if not (is_fold_header_cell(cell) or is_section_header(cell)):
            continue
        meta = cell.setdefault("metadata", {})
        if collapse and should_collapse(cell):
            meta["jp-MarkdownHeadingCollapsed"] = True
            tags = list(meta.get("tags") or [])
            for tag in ("section-fold-header", "section-header"):
                if tag not in tags:
                    tags.append(tag)
            meta["tags"] = tags
            collapsed += 1
        else:
            meta.pop("jp-MarkdownHeadingCollapsed", None)
            expanded += 1
    return collapsed, expanded


def process_notebook(path: Path, *, collapse: bool = True) -> None:
    nb = json.loads(path.read_text(encoding="utf-8"))
    added_nav = ensure_navigator(nb)
    n_splits = split_section_headers(nb)
    n_collapsed, n_expanded = apply_folding(nb, collapse=collapse)
    path.write_text(json.dumps(nb, ensure_ascii=False, indent=1), encoding="utf-8")
    parts = [
        f"{path.name}: {n_splits} headers split",
        f"{n_collapsed} collapsed",
        f"{n_expanded} expanded",
    ]
    if added_nav:
        parts.append("navigator added")
    print("  " + ", ".join(parts))


def main() -> int:
    parser = argparse.ArgumentParser(description="Apply collapsible section folding to capstone notebooks")
    parser.add_argument("--expand-all", action="store_true", help="Remove collapsed metadata (expand all sections)")
    args = parser.parse_args()

    print("[section_folding] applying to capstone notebooks…")
    for nb_path in NOTEBOOKS:
        if not nb_path.is_file():
            print(f"  skip missing {nb_path}")
            continue
        process_notebook(nb_path, collapse=not args.expand_all)
    print("[section_folding] done — reopen notebook; hover LEFT margin of ## Section cells for ▶")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
