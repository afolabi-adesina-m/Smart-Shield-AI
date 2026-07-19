"""Clean roadmap duplication and fix Section 10 header order."""
import json
from pathlib import Path

NOTEBOOK = Path(__file__).resolve().parent.parent / "notebooks" / "capstone_with_results.ipynb"

nb = json.loads(NOTEBOOK.read_text(encoding="utf-8"))
cells = nb["cells"]

# ── Fix cell 4 roadmap duplication + HF link ─────────────────────────────────
for c in cells:
    src = "".join(c.get("source", []))
    if "Team Roadmap — Group 2B" in src and "8-Week Roadmap" in src:
        src = src.replace(
            "### **8-Week Roadmap:**\n1.  **Weeks 1-2 (Foundations):** Ingest Ontario Collision CSVs and build the Linear Baseline.\n",
            "### **8-Week Roadmap (Group 2B — all members contribute each week):**\n",
        )
        src = src.replace(
            "https://huggingface.co/datasets/RoadSurfaceClassDataset/RSCD",
            "https://thu-rsxd.com/",
        )
        src = src.replace(
            "HuggingFace RSCD Road Surface Dataset",
            "THU RSXD Road Surface Dataset",
        )
        src = src.replace(
            "| HuggingFace RSCD | https://thu-rsxd.com/ | Road image training scale-up |",
            "| THU RSXD (Road Surface Dataset) | https://thu-rsxd.com/ | Road image training scale-up |",
        )
        c["source"] = [src]

# ── Reorder: Section 10 header must come before 10.2 ───────────────────────
def txt(c):
    return "".join(c.get("source", []))

idx_s10_hdr = next((i for i, c in enumerate(cells) if txt(c).startswith("# Section 10")), None)
idx_s10_2_md = next((i for i, c in enumerate(cells) if "### 10.2" in txt(c) and "Safety Score Fusion" in txt(c)), None)

if idx_s10_hdr is not None and idx_s10_2_md is not None and idx_s10_2_md < idx_s10_hdr:
    hdr = cells.pop(idx_s10_hdr)
    # re-find 10.2 after pop
    idx_s10_2_md = next(i for i, c in enumerate(cells) if "### 10.2" in txt(c) and "Safety Score Fusion" in txt(c))
    cells.insert(idx_s10_2_md, hdr)

nb["cells"] = cells
NOTEBOOK.write_text(json.dumps(nb, indent=1, ensure_ascii=False), encoding="utf-8")
print("Cleaned roadmap + Section 10 order")
