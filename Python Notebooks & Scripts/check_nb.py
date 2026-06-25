import json, sys, os
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

NB_PATH = os.path.join(os.path.dirname(__file__), "Captone - Draft.ipynb")
nb = json.load(open(NB_PATH, encoding="utf-8"))
print(f"Total cells: {len(nb['cells'])}")
for i, c in enumerate(nb["cells"]):
    t = c["cell_type"]
    src = "".join(c.get("source", []))[:70].replace("\n", " ")
    print(f"Cell {i:>2}  [{t:<8}]  {src}")
