"""
Fix NameError: name 'mticker' is not defined.
Adds  import matplotlib.ticker as mticker  to Cell 3 (imports cell).
"""
import json, os

NB_PATH = os.path.join(os.path.dirname(__file__), "Captone - Draft.ipynb")

with open(NB_PATH, encoding="utf-8") as f:
    nb = json.load(f)

CELL3_NEW = """\
# -- Core libraries -------------------------------------------------------------
import os, warnings
from pathlib import Path

import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import matplotlib
import matplotlib.ticker as mticker
matplotlib.rcParams["figure.dpi"] = 110
import seaborn as sns
sns.set_theme(style="whitegrid", palette="muted")
warnings.filterwarnings("ignore")

# -- Resolve DATA path regardless of where this notebook lives -----------------
# Supports two layouts:
#   Layout A (root):      <project>/Captone - Draft.ipynb
#   Layout B (subfolder): <project>/Python Notebooks & Scripts/Captone - Draft.ipynb
_nb_dir = Path(os.path.abspath(""))
_candidates = [
    _nb_dir / "Data",
    _nb_dir.parent / "Data",
]
DATA = next((p for p in _candidates if p.is_dir()), _nb_dir / "Data")
DATA_DIR = str(DATA)

print(f"DATA resolved to : {DATA}")
print(f"  Exists         : {DATA.is_dir()}")
if DATA.is_dir():
    csv_files = list(DATA.glob("*.csv"))
    print(f"  CSV files found: {[f.name for f in csv_files[:6]]}")
\
"""

nb["cells"][3]["source"]          = CELL3_NEW
nb["cells"][3]["outputs"]         = []
nb["cells"][3]["execution_count"] = None

with open(NB_PATH, "w", encoding="utf-8") as f:
    json.dump(nb, f, indent=1, ensure_ascii=False)

print("DONE - import matplotlib.ticker as mticker added to Cell 3.")
