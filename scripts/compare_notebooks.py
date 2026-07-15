"""Compare capstone_with_results.ipynb vs capstone_with_results_fixed_Y_V1.ipynb"""
import json
import re
from pathlib import Path
from collections import Counter

ROOT = Path(__file__).resolve().parent.parent / "notebooks"
NB_A = ROOT / "capstone_with_results.ipynb"
NB_B = ROOT / "capstone_with_results_fixed_Y_V1.ipynb"

KEYWORDS = [
    "6.2b", "6.2c", "autoencoder", "t-SNE", "tsne", "latent",
    "hybrid", "score_frame_hybrid", "_hybrid_v_for_surface",
    "ResNet18", "fine_tune_vision", "Section 10", "SHAP",
    "SMOTE", "LightGBM", "PyTorch DNN", "Safety Score",
    "vision_autoencoder", "softmax", "V_FUSION",
]

SECTION_RE = re.compile(r"^#+\s*(Section\s+\d+[^#\n]*)", re.MULTILINE | re.IGNORECASE)


def analyze(path: Path) -> dict:
    nb = json.loads(path.read_text(encoding="utf-8"))
    cells = nb["cells"]
    all_src = "\n".join("".join(c.get("source", [])) for c in cells)
    sections = SECTION_RE.findall(all_src)
    kw_hits = {k: (k.lower() in all_src.lower() or k in all_src) for k in KEYWORDS}
    return {
        "path": path.name,
        "cells_total": len(cells),
        "markdown": sum(1 for c in cells if c["cell_type"] == "markdown"),
        "code": sum(1 for c in cells if c["cell_type"] == "code"),
        "sections": sections,
        "keywords": kw_hits,
        "has_outputs": sum(1 for c in cells if c.get("outputs")),
        "file_size_mb": round(path.stat().st_size / 1_048_576, 2),
    }


def cell_signatures(path: Path) -> list[str]:
    nb = json.loads(path.read_text(encoding="utf-8"))
    sigs = []
    for c in nb["cells"]:
        src = "".join(c.get("source", [])).strip()
        first = src.split("\n")[0][:100] if src else "(empty)"
        sigs.append(f"{c['cell_type']}|{first}")
    return sigs


a = analyze(NB_A)
b = analyze(NB_B)
sigs_a = cell_signatures(NB_A)
sigs_b = cell_signatures(NB_B)

only_a = [s for s in sigs_a if s not in sigs_b]
only_b = [s for s in sigs_b if s not in sigs_a]

out = Path(__file__).resolve().parent / "_nb_compare.txt"
lines = [
    "=== NOTEBOOK COMPARISON ===",
    f"A: {a['path']}  ({a['file_size_mb']} MB)",
    f"B: {b['path']}  ({b['file_size_mb']} MB)",
    "",
    f"Cells: A={a['cells_total']} (md={a['markdown']}, code={a['code']}) | B={b['cells_total']} (md={b['markdown']}, code={b['code']})",
    f"Cells with saved outputs: A={a['has_outputs']} | B={b['has_outputs']}",
    "",
    "--- Sections in A only ---",
]
for s in a["sections"]:
    if s not in b["sections"]:
        lines.append(f"  + {s}")
lines.append("--- Sections in B only ---")
for s in b["sections"]:
    if s not in a["sections"]:
        lines.append(f"  + {s}")
lines.append("--- Keyword features ---")
for k in KEYWORDS:
    lines.append(f"  {k:<30} A={str(a['keywords'][k]):<5} B={str(b['keywords'][k]):<5}")
lines.append(f"\n--- Cell signatures only in A ({len(only_a)}) ---")
lines.extend(f"  {x}" for x in only_a[:40])
if len(only_a) > 40:
    lines.append(f"  ... and {len(only_a)-40} more")
lines.append(f"\n--- Cell signatures only in B ({len(only_b)}) ---")
lines.extend(f"  {x}" for x in only_b[:40])
if len(only_b) > 40:
    lines.append(f"  ... and {len(only_b)-40} more")

out.write_text("\n".join(lines), encoding="utf-8")
print(out.read_text(encoding="utf-8"))
