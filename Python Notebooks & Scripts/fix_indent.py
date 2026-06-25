"""Fix indentation bug: DATA assignment was inside _resolve_data_dir."""
import json
from pathlib import Path

NB = Path(__file__).parent / "Captone - Draft.ipynb"
nb = json.load(open(NB, encoding="utf-8"))

RESOLVE_FN = """def _resolve_data_dir(start: Path) -> Path:
    \"\"\"Pick Data/ that actually contains CSVs (avoids empty Scripts/Data/).\"\"\"
    candidates = []
    for base in [start, start.parent, start.parent.parent]:
        d = base / "Data"
        if d.is_dir():
            candidates.append(d)
    for d in candidates:
        if any(d.glob("*.csv")):
            return d
    return candidates[0] if candidates else start / "Data"

"""

BROKEN_CELL1 = """else:  # Local
    _nb_dir = Path.cwd()
    try:
        from IPython import get_ipython
        _ip = get_ipython()
        if _ip and "__vsc_ipynb_file__" in _ip.user_ns:
            _nb_dir = Path(_ip.user_ns["__vsc_ipynb_file__"]).parent
    except Exception:
        pass

def _resolve_data_dir(start: Path) -> Path:
    \"\"\"Pick Data/ that actually contains CSVs (avoids empty Scripts/Data/).\"\"\"
    candidates = []
    for base in [start, start.parent, start.parent.parent]:
        d = base / "Data"
        if d.is_dir():
            candidates.append(d)
    for d in candidates:
        if any(d.glob("*.csv")):
            return d
    return candidates[0] if candidates else start / "Data"

    DATA = _resolve_data_dir(_nb_dir)

DATA_DIR = str(DATA)"""

FIXED_CELL1 = """else:  # Local
    _nb_dir = Path.cwd()
    try:
        from IPython import get_ipython
        _ip = get_ipython()
        if _ip and "__vsc_ipynb_file__" in _ip.user_ns:
            _nb_dir = Path(_ip.user_ns["__vsc_ipynb_file__"]).parent
    except Exception:
        pass
    DATA = _resolve_data_dir(_nb_dir)

DATA_DIR = str(DATA)"""

BROKEN_CELL5 = """# ── Resolve DATA directory ────────────────────────────────────────────────────
if "_resolve_data_dir" not in globals():
def _resolve_data_dir(start: Path) -> Path:
    \"\"\"Pick Data/ that actually contains CSVs (avoids empty Scripts/Data/).\"\"\"
    candidates = []
    for base in [start, start.parent, start.parent.parent]:
        d = base / "Data"
        if d.is_dir():
            candidates.append(d)
    for d in candidates:
        if any(d.glob("*.csv")):
            return d
    return candidates[0] if candidates else start / "Data"
_nb_dir = Path.cwd()"""

FIXED_CELL5 = """# ── Resolve DATA directory ────────────────────────────────────────────────────
if "_resolve_data_dir" not in globals():
    def _resolve_data_dir(start: Path) -> Path:
        \"\"\"Pick Data/ that actually contains CSVs (avoids empty Scripts/Data/).\"\"\"
        candidates = []
        for base in [start, start.parent, start.parent.parent]:
            d = base / "Data"
            if d.is_dir():
                candidates.append(d)
        for d in candidates:
            if any(d.glob("*.csv")):
                return d
        return candidates[0] if candidates else start / "Data"

_nb_dir = Path.cwd()"""

for i, c in enumerate(nb["cells"]):
    src = "".join(c.get("source", []))
    if BROKEN_CELL1 in src:
        src = src.replace(BROKEN_CELL1, FIXED_CELL1)
        if "_resolve_data_dir" not in src.split("# ── 4. Mount storage")[0]:
            src = src.replace(
                "# ── 4. Mount storage & set DATA path",
                RESOLVE_FN + "# ── 4. Mount storage & set DATA path",
                1,
            )
        c["source"] = src
        print(f"Patched cell {i} (setup)")

    if BROKEN_CELL5 in src:
        c["source"] = src.replace(BROKEN_CELL5, FIXED_CELL5)
        print(f"Patched cell {i} (imports)")

json.dump(nb, open(NB, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
print("DONE")
