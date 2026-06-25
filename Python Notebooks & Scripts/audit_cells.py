"""Dumps every code cell source for auditing."""
import json, os, sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
NB_PATH = os.path.join(os.path.dirname(__file__), "Captone - Draft.ipynb")
with open(NB_PATH, encoding="utf-8") as f:
    nb = json.load(f)
for i, c in enumerate(nb["cells"]):
    src = "".join(c.get("source", []))
    print(f"\n{'='*70}")
    print(f"CELL {i}  [{c['cell_type']}]")
    print('='*70)
    print(src[:1200])
