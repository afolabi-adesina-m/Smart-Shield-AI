import json
from pathlib import Path
p = Path(__file__).resolve().parent.parent / "notebooks" / "capstone_with_results.ipynb"
nb = json.loads(p.read_text(encoding="utf-8"))
lines = []
for i, c in enumerate(nb["cells"]):
    s = "".join(c.get("source", []))
    if any(k in s for k in ["Section 6", "6.2", "Section 7", "Section 10", "Team Roadmap", "Team Member", "Group 2B"]):
        lines.append(f"{i:3d} {c['cell_type'][:4]} | {s.splitlines()[0][:90]}")
Path(__file__).resolve().parent.joinpath("_order_check.txt").write_text("\n".join(lines), encoding="utf-8")
