"""
Place ethics cells AFTER the baseline models cell
(ethics code depends on baseline_results which is defined there).
"""
import json, os

NB_PATH = os.path.join(os.path.dirname(__file__), "Captone - Draft.ipynb")
with open(NB_PATH, encoding="utf-8") as f:
    nb = json.load(f)

cells = nb["cells"]

# ── 1. Extract ethics cells ───────────────────────────────────────────────────
ethics_ids = {"ethics_md_7", "ethics_code_7"}
ethics_cells = [c for c in cells if c.get("id","") in ethics_ids]
remaining    = [c for c in cells if c.get("id","") not in ethics_ids]

if len(ethics_cells) != 2:
    print(f"ERROR: found {len(ethics_cells)} ethics cells. Aborting.")
    exit(1)

# Sort: markdown first, then code
ethics_cells.sort(key=lambda c: 0 if c["cell_type"] == "markdown" else 1)
print(f"Ethics cells extracted: {[c['cell_type'] for c in ethics_cells]}")

# ── 2. Find the baseline models code cell (defines baseline_results) ──────────
baseline_idx = None
for i, cell in enumerate(remaining):
    src = "".join(cell.get("source",""))
    if cell["cell_type"] == "code" and "baseline_results" in src and "evaluate" in src:
        baseline_idx = i
        print(f"Baseline cell found at index {i}")
        break

if baseline_idx is None:
    print("ERROR: baseline_results cell not found.")
    exit(1)

# ── 3. Insert ethics cells right after the baseline cell ──────────────────────
insert_at = baseline_idx + 1
new_cells  = remaining[:insert_at] + ethics_cells + remaining[insert_at:]
nb["cells"] = new_cells

with open(NB_PATH, "w", encoding="utf-8") as f:
    json.dump(nb, f, indent=1, ensure_ascii=False)

print(f"Ethics cells inserted at positions {insert_at} and {insert_at+1} "
      f"(right after baseline models cell {baseline_idx})")
print(f"Notebook now has {len(new_cells)} cells")
print("DONE")
