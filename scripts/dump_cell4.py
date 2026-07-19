import json
from pathlib import Path
p = Path(__file__).resolve().parent.parent / "notebooks" / "capstone_with_results.ipynb"
nb = json.loads(p.read_text(encoding="utf-8"))
for i in [4, 5, 6]:
    c = nb["cells"][i]
    Path(__file__).resolve().parent.joinpath(f"_cell{i}.txt").write_text("".join(c.get("source",[])), encoding="utf-8")
