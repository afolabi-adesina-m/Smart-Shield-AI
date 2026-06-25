"""
Fixes all known runtime errors in Captone - Draft.ipynb:

  Fix 1  (Cell 3)  – Add DATA_DIR definition so later cells can find CSVs
                     even if the user jumps straight to Section 8.
  Fix 2  (Cell 38) – Section 8.1 data prep: self-load df_toronto & dft
                     if they are not already defined in the session.
"""
import json, os

NB_PATH = os.path.join(os.path.dirname(__file__), "Captone - Draft.ipynb")

with open(NB_PATH, encoding="utf-8") as f:
    nb = json.load(f)

# ─────────────────────────────────────────────────────────────────────────────
# FIX 1 – Cell 3: imports + DATA_DIR
# Add a robust DATA_DIR that works from both the old root location AND
# the new "Python Notebooks & Scripts" subfolder.
# ─────────────────────────────────────────────────────────────────────────────
CELL3_NEW = """\
# -- Core libraries -------------------------------------------------------------
import os, warnings
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import matplotlib
matplotlib.rcParams["figure.dpi"] = 110
import seaborn as sns
sns.set_theme(style="whitegrid", palette="muted")
warnings.filterwarnings("ignore")

# -- Resolve DATA_DIR regardless of where this notebook lives ------------------
# Supports two folder layouts:
#   Layout A (old): <project>/Captone - Draft.ipynb
#   Layout B (new): <project>/Python Notebooks & Scripts/Captone - Draft.ipynb
_nb_dir  = os.path.abspath("")          # directory Jupyter was launched from
_parent  = os.path.dirname(_nb_dir)

# Try sibling 'Data' folder first (Layout B), then current dir (Layout A)
for _candidate in [os.path.join(_nb_dir, "Data"),
                   os.path.join(_parent, "Data"),
                   os.path.join(_nb_dir, "..", "Data")]:
    if os.path.isdir(_candidate):
        DATA_DIR = os.path.abspath(_candidate)
        break
else:
    DATA_DIR = os.path.join(_nb_dir, "Data")   # best guess fallback

print(f"DATA_DIR resolved to: {DATA_DIR}")
print(f"  Exists: {os.path.isdir(DATA_DIR)}")
if os.path.isdir(DATA_DIR):
    print(f"  Files : {os.listdir(DATA_DIR)[:6]}")
\
"""

# ─────────────────────────────────────────────────────────────────────────────
# FIX 2 – Cell 38: Section 8.1 data preparation
# Self-loads df_toronto (and dft) if not already in the kernel session,
# then engineers all required features.
# ─────────────────────────────────────────────────────────────────────────────
CELL38_NEW = """\
# -- 8.1 Data preparation -------------------------------------------------------
import warnings, os
warnings.filterwarnings("ignore")

import pandas as pd
import numpy as np
from sklearn.model_selection import train_test_split, StratifiedKFold
from sklearn.preprocessing   import StandardScaler
from sklearn.pipeline        import Pipeline

# -- Auto-load df_toronto if not already defined --------------------------------
if "df_toronto" not in dir() or df_toronto is None:
    print("df_toronto not found in session - loading now...")
    # Try common CSV names in DATA_DIR
    _nb_dir  = os.path.abspath("")
    _parent  = os.path.dirname(_nb_dir)
    _candidates = [
        os.path.join(_nb_dir,  "Data"),
        os.path.join(_parent,  "Data"),
    ]
    DATA_DIR = next((d for d in _candidates if os.path.isdir(d)), _nb_dir)

    _toronto_names = [
        "traffic collision data.csv",
        "traffic_collision_data.csv",
        "Traffic Collision Data.csv",
    ]
    _loaded = False
    for _name in _toronto_names:
        _path = os.path.join(DATA_DIR, _name)
        if os.path.exists(_path):
            df_toronto = pd.read_csv(_path, low_memory=False)
            print(f"  Loaded: {_name}  ({len(df_toronto):,} rows)")
            _loaded = True
            break
    if not _loaded:
        raise FileNotFoundError(
            f"Toronto collision CSV not found in {DATA_DIR}.\\n"
            f"Tried: {_toronto_names}\\n"
            f"Please run Cell 5 first or ensure the Data folder is accessible."
        )
else:
    print(f"df_toronto already in session  ({len(df_toronto):,} rows)")

# Final feature set (voted by chi2 + mutual-info + RF importance in Section 5)
SELECTED = ["OCC_HOUR", "MONTH_NUM", "SEASON_NUM",
            "IS_NIGHT", "IS_RUSHHOUR",
            "PEDESTRIAN_BIN", "BICYCLE_BIN", "AUTOMOBILE_BIN"]

# -- Engineer SEVERITY target ---------------------------------------------------
df_model = df_toronto.copy()

if "SEVERITY" not in df_model.columns:
    df_model["SEVERITY"] = 0
    for col in df_model.columns:
        if "FATAL" in col.upper():
            df_model.loc[df_model[col].astype(str).str.upper().str.strip() == "YES", "SEVERITY"] = 2
        elif "INJURY" in col.upper():
            df_model.loc[(df_model["SEVERITY"] < 2) &
                         (df_model[col].astype(str).str.upper().str.strip() == "YES"), "SEVERITY"] = 1

# -- Engineer temporal features -------------------------------------------------
MONTH_MAP  = {"January":1,"February":2,"March":3,"April":4,"May":5,"June":6,
              "July":7,"August":8,"September":9,"October":10,"November":11,"December":12}
SEASON_MAP = {1:1,2:1,3:2,4:2,5:2,6:3,7:3,8:3,9:4,10:4,11:4,12:1}

if "MONTH_NUM" not in df_model.columns:
    df_model["MONTH_NUM"]  = df_model["MONTH"].map(MONTH_MAP).fillna(6).astype(int)
if "SEASON_NUM" not in df_model.columns:
    df_model["SEASON_NUM"] = df_model["MONTH_NUM"].map(SEASON_MAP)

# OCC_HOUR: try multiple candidate column names
for _hcol in ["OCC_HOUR", "HOUR", "TIME", "OCC_TIME"]:
    if _hcol in df_model.columns:
        df_model["OCC_HOUR"] = pd.to_numeric(df_model[_hcol], errors="coerce").fillna(12).astype(int)
        break
if "OCC_HOUR" not in df_model.columns:
    df_model["OCC_HOUR"] = 12   # default midday if column missing

if "IS_NIGHT" not in df_model.columns:
    df_model["IS_NIGHT"]    = df_model["OCC_HOUR"].apply(lambda h: 1 if h < 6 or h >= 22 else 0)
if "IS_RUSHHOUR" not in df_model.columns:
    df_model["IS_RUSHHOUR"] = df_model["OCC_HOUR"].apply(lambda h: 1 if (7<=h<=9) or (16<=h<=18) else 0)

# -- Engineer involvement binary flags ------------------------------------------
INVOLVEMENT_MAP = {
    "PEDESTRIAN_BIN": ["PEDESTRIAN", "PEDESTRIANS"],
    "BICYCLE_BIN":    ["CYCLIST", "BICYCLE", "BICYCLIST"],
    "AUTOMOBILE_BIN": ["AUTOMOBILE", "AUTO", "CAR"],
}
for bin_col, candidates in INVOLVEMENT_MAP.items():
    if bin_col not in df_model.columns:
        for src in candidates:
            if src in df_model.columns:
                df_model[bin_col] = (df_model[src].astype(str).str.upper().str.strip() == "YES").astype(int)
                break
        else:
            df_model[bin_col] = 0   # column absent; default to 0

# -- Build feature matrix -------------------------------------------------------
available = [c for c in SELECTED if c in df_model.columns]
missing   = [c for c in SELECTED if c not in df_model.columns]
if missing:
    print(f"  Warning: these features could not be engineered and will be excluded: {missing}")

df_clean = df_model[available + ["SEVERITY"]].dropna()
X = df_clean[available].values
y = df_clean["SEVERITY"].values

print(f"\\nFeature matrix : {X.shape}")
print(f"Features used  : {available}")
print("Class distribution:")
for cls, cnt in zip(*np.unique(y, return_counts=True)):
    print(f"  Class {cls} : {cnt:,}  ({cnt/len(y)*100:.1f}%)")

# -- Stratified 80/20 train-test split ------------------------------------------
X_train, X_test, y_train, y_test = train_test_split(
    X, y, test_size=0.20, random_state=42, stratify=y
)
print(f"\\nTrain: {X_train.shape[0]:,}   Test: {X_test.shape[0]:,}")

# -- SMOTE oversampling on training set only ------------------------------------
try:
    from imblearn.over_sampling import SMOTE
    sm = SMOTE(random_state=42, k_neighbors=3)
    X_train_sm, y_train_sm = sm.fit_resample(X_train, y_train)
    print(f"After SMOTE - train: {X_train_sm.shape[0]:,}")
    SMOTE_AVAILABLE = True
except ImportError:
    print("imbalanced-learn not installed. Run:  pip install imbalanced-learn")
    print("Using class_weight='balanced' as fallback.")
    X_train_sm, y_train_sm = X_train, y_train
    SMOTE_AVAILABLE = False

# -- StandardScaler -------------------------------------------------------------
scaler = StandardScaler()
X_train_sc = scaler.fit_transform(X_train_sm)
X_test_sc  = scaler.transform(X_test)
print("Scaling done. Ready for modelling.")
\
"""

# ── Apply fixes ────────────────────────────────────────────────────────────────
nb["cells"][3]["source"]          = CELL3_NEW
nb["cells"][3]["outputs"]         = []
nb["cells"][3]["execution_count"] = None

nb["cells"][38]["source"]          = CELL38_NEW
nb["cells"][38]["outputs"]         = []
nb["cells"][38]["execution_count"] = None

with open(NB_PATH, "w", encoding="utf-8") as f:
    json.dump(nb, f, indent=1, ensure_ascii=False)

print(f"DONE - {NB_PATH}")
print(f"Total cells: {len(nb['cells'])}")
print("Fixed: Cell 3  (DATA_DIR resolution)")
print("Fixed: Cell 38 (Section 8.1 self-loading data prep)")
