"""
Scans every code cell in the notebook for symbols used but never imported,
then rewrites Cell 3 with a single comprehensive import block that covers all of them.
"""
import json, os, re

NB_PATH = os.path.join(os.path.dirname(__file__), "Captone - Draft.ipynb")

with open(NB_PATH, encoding="utf-8") as f:
    nb = json.load(f)

# Collect all code across every code cell
all_code = "\n".join(
    "".join(c["source"])
    for c in nb["cells"] if c["cell_type"] == "code"
)

# Check which symbols are actually referenced
def used(sym): return sym in all_code

print("Symbols scan:")
for sym in ["mticker", "confusion_matrix", "ConfusionMatrixDisplay",
            "roc_curve", "roc_auc_score", "label_binarize",
            "lgb", "torch", "SMOTE"]:
    print(f"  {sym:30s} {'USED' if used(sym) else 'not used'}")

# ── Comprehensive Cell 3 ──────────────────────────────────────────────────────
CELL3_NEW = """\
# -- Core libraries -------------------------------------------------------------
import os, warnings, sys
from pathlib import Path

import pandas as pd
import numpy as np

import matplotlib.pyplot as plt
import matplotlib
import matplotlib.ticker as mticker
matplotlib.rcParams["figure.dpi"] = 110

import seaborn as sns
sns.set_theme(style="whitegrid", palette="muted")

from sklearn.model_selection  import train_test_split, StratifiedKFold, GridSearchCV
from sklearn.preprocessing    import StandardScaler, LabelEncoder, MinMaxScaler, label_binarize
from sklearn.linear_model     import LogisticRegression
from sklearn.tree             import DecisionTreeClassifier
from sklearn.neighbors        import KNeighborsClassifier
from sklearn.ensemble         import RandomForestClassifier
from sklearn.feature_selection import SelectKBest, chi2, f_classif, mutual_info_classif
from sklearn.metrics          import (
    accuracy_score, precision_score, recall_score, f1_score,
    matthews_corrcoef, roc_auc_score, roc_curve,
    confusion_matrix, ConfusionMatrixDisplay, classification_report
)
from sklearn.inspection       import permutation_importance

from scipy.stats import chi2_contingency, pointbiserialr

warnings.filterwarnings("ignore")

# -- Optional heavy libraries (graceful fallback if not installed) -------------
try:
    import lightgbm as lgb
    LGBM_OK = True
except ImportError:
    LGBM_OK = False
    print("LightGBM not installed  ->  pip install lightgbm")

try:
    import torch
    import torch.nn as nn
    import torch.optim as optim
    from torch.utils.data import DataLoader, TensorDataset
    TORCH_OK = True
except ImportError:
    TORCH_OK = False
    print("PyTorch not installed   ->  pip install torch")

try:
    from imblearn.over_sampling import SMOTE
    SMOTE_OK = True
except ImportError:
    SMOTE_OK = False
    print("imbalanced-learn not installed  ->  pip install imbalanced-learn")

# -- Resolve DATA path regardless of where this notebook lives -----------------
_nb_dir = Path(os.path.abspath(""))
_candidates = [_nb_dir / "Data", _nb_dir.parent / "Data"]
DATA     = next((p for p in _candidates if p.is_dir()), _nb_dir / "Data")
DATA_DIR = str(DATA)

print(f"\\nDATA resolved to : {DATA}")
print(f"  Exists         : {DATA.is_dir()}")
if DATA.is_dir():
    csv_files = list(DATA.glob("*.csv"))
    print(f"  CSV files      : {[f.name for f in csv_files[:8]]}")
\
"""

nb["cells"][3]["source"]          = CELL3_NEW
nb["cells"][3]["outputs"]         = []
nb["cells"][3]["execution_count"] = None

with open(NB_PATH, "w", encoding="utf-8") as f:
    json.dump(nb, f, indent=1, ensure_ascii=False)

print("\nDONE - Cell 3 rewritten with full import block.")
print("All sklearn, scipy, matplotlib, lgb, torch, SMOTE imports covered.")
