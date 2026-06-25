"""
Move the two ethics cells (Section 7) to the correct position:
just before the first Section 8 CODE cell (Data Prep / 8.1).
Also fix the SyntaxWarning by escaping the pipe char properly.
"""
import json, os

NB_PATH = os.path.join(os.path.dirname(__file__), "Captone - Draft.ipynb")
with open(NB_PATH, encoding="utf-8") as f:
    nb = json.load(f)

cells = nb["cells"]

# ── 1. Pull out the two ethics cells (by their ids) ───────────────────────────
ethics_ids = {"ethics_md_7", "ethics_code_7"}
ethics_cells = []
remaining   = []
for cell in cells:
    if cell.get("id","") in ethics_ids:
        ethics_cells.append(cell)
    else:
        remaining.append(cell)

if len(ethics_cells) != 2:
    print(f"ERROR: Expected 2 ethics cells, found {len(ethics_cells)}. Aborting.")
    exit(1)
print(f"Found {len(ethics_cells)} ethics cells. Removing from current position.")

# Fix the SyntaxWarning: replace raw \| in markdown string with |
for cell in ethics_cells:
    src = "".join(cell.get("source",""))
    if "\\|" in src:
        cell["source"] = src.replace("\\|", "|")
        print("  Fixed SyntaxWarning: replaced \\| with | in ethics markdown")

# ── 2. Find the correct insertion point in remaining cells ────────────────────
# Target: the first CODE cell that belongs to Section 8
# Markers: contains "8.1" OR "Data Prep" OR "train_test_split" or "SMOTE"
insert_at = None
for i, cell in enumerate(remaining):
    src = "".join(cell.get("source",""))
    if cell["cell_type"] == "code" and (
        "train_test_split" in src or "SMOTE" in src or
        ("8.1" in src and ("X_train" in src or "scaler" in src.lower()))
    ):
        # Insert BEFORE the markdown header that precedes this code cell
        # Walk back to find the preceding markdown
        j = i - 1
        while j >= 0 and remaining[j]["cell_type"] == "markdown":
            src_md = "".join(remaining[j].get("source",""))
            if "8." in src_md or "Modell" in src_md or "Data Prep" in src_md:
                insert_at = j
                break
            j -= 1
        if insert_at is None:
            insert_at = i   # fallback: insert right before the code cell
        break

if insert_at is None:
    # Last resort: find a markdown cell containing "8.1" or "Section 8"
    for i, cell in enumerate(remaining):
        src = "".join(cell.get("source",""))
        if cell["cell_type"] == "markdown" and ("## Section 8" in src or "8.1" in src):
            insert_at = i
            break

if insert_at is None:
    insert_at = len(remaining) - 2   # near the end, before summary
    print(f"WARNING: Could not find Section 8 marker — inserting at position {insert_at}")
else:
    print(f"Inserting ethics cells at position {insert_at} "
          f"(before: {remaining[insert_at].get('cell_type')} cell)")

# ── 3. Rebuild cells list with ethics section in the right place ──────────────
new_cells = remaining[:insert_at] + ethics_cells + remaining[insert_at:]
nb["cells"] = new_cells

with open(NB_PATH, "w", encoding="utf-8") as f:
    json.dump(nb, f, indent=1, ensure_ascii=False)

print(f"\nDONE — notebook now has {len(new_cells)} cells")
print(f"Ethics Section 7 is at cells {insert_at} and {insert_at+1}")
