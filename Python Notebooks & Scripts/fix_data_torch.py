"""Fix DATA path resolution (prefer folder with CSVs) and torch>=2.4 for transformers."""
import json
from pathlib import Path

NB = Path(__file__).parent / "Captone - Draft.ipynb"
nb = json.load(open(NB, encoding="utf-8"))

RESOLVE_DATA_FN = '''
def _resolve_data_dir(start: Path) -> Path:
    """Pick Data/ that actually contains CSVs (avoids empty Scripts/Data/)."""
    candidates = []
    for base in [start, start.parent, start.parent.parent]:
        d = base / "Data"
        if d.is_dir():
            candidates.append(d)
    for d in candidates:
        if any(d.glob("*.csv")):
            return d
    return candidates[0] if candidates else start / "Data"
'''

OLD_LOCAL = """else:  # Local
    _nb_dir     = Path(os.path.abspath(""))
    _candidates = [_nb_dir / "Data", _nb_dir.parent / "Data"]
    DATA        = next((p for p in _candidates if p.is_dir()), _nb_dir / "Data")"""

NEW_LOCAL = """else:  # Local
    _nb_dir = Path.cwd()
    try:
        from IPython import get_ipython
        _ip = get_ipython()
        if _ip and "__vsc_ipynb_file__" in _ip.user_ns:
            _nb_dir = Path(_ip.user_ns["__vsc_ipynb_file__"]).parent
    except Exception:
        pass
""" + RESOLVE_DATA_FN + """
    DATA = _resolve_data_dir(_nb_dir)"""

OLD_IMPORTS_DATA = """# ── Resolve DATA directory ────────────────────────────────────────────────────
_nb_dir = Path(os.path.abspath(""))
_candidates = [_nb_dir / "Data", _nb_dir.parent / "Data"]
DATA     = next((p for p in _candidates if p.is_dir()), _nb_dir / "Data")
DATA_DIR = str(DATA)"""

NEW_IMPORTS_DATA = """# ── Resolve DATA directory ────────────────────────────────────────────────────
if "_resolve_data_dir" not in globals():
""" + RESOLVE_DATA_FN.strip() + """
_nb_dir = Path.cwd()
try:
    from IPython import get_ipython
    _ip = get_ipython()
    if _ip and "__vsc_ipynb_file__" in _ip.user_ns:
        _nb_dir = Path(_ip.user_ns["__vsc_ipynb_file__"]).parent
except Exception:
    pass
if "DATA" not in globals() or not any(Path(DATA).glob("*.csv")):
    DATA = _resolve_data_dir(_nb_dir)
DATA_DIR = str(DATA)"""

OLD_TORCH_CHECK = """try:
    import torch
    _ = torch.__version__
    _ = torch.zeros(1)
except Exception:
    if IN_COLAB or IN_KAGGLE:
        pkgs_needed.append("torch --index-url https://download.pytorch.org/whl/cu121")
    else:
        pkgs_needed.append("torch --index-url https://download.pytorch.org/whl/cpu")"""

NEW_TORCH_CHECK = """_torch_index = "https://download.pytorch.org/whl/cu121" if (IN_COLAB or IN_KAGGLE) else "https://download.pytorch.org/whl/cpu"
try:
    import torch
    from packaging import version as _pkg_version
    if _pkg_version.parse(torch.__version__.split("+")[0]) < _pkg_version.parse("2.4.0"):
        pkgs_needed.append(f"torch>=2.4 torchvision --index-url {_torch_index}")
    else:
        _ = torch.zeros(1)
except Exception:
    pkgs_needed.append(f"torch>=2.4 torchvision --index-url {_torch_index}")"""

for c in nb["cells"]:
    src = "".join(c.get("source", []))
    changed = False
    if OLD_LOCAL in src:
        c["source"] = src.replace(OLD_LOCAL, NEW_LOCAL)
        changed = True
        print("Patched cell 1 DATA resolution")
    if OLD_TORCH_CHECK in src:
        c["source"] = c["source"].replace(OLD_TORCH_CHECK, NEW_TORCH_CHECK)
        changed = True
        print("Patched cell 1 torch>=2.4 check")
    if OLD_IMPORTS_DATA in src:
        c["source"] = c["source"].replace(OLD_IMPORTS_DATA, NEW_IMPORTS_DATA)
        changed = True
        print("Patched imports cell DATA resolution")

json.dump(nb, open(NB, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
print("DONE")
