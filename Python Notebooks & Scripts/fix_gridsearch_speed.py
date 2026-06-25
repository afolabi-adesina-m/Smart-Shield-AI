"""
Speed up Section 8.3 GridSearchCV:
  1. n_jobs=-1 on all GridSearchCV calls  (uses all CPU cores)
  2. cv=3 instead of 5                    (40% fewer fits)
  3. Trim RF grid  (drop n_estimators=300, add n_jobs=-1 to RF itself)
  4. Add 30% stratified sample for search, refit on full data
"""
import json, os

NB_PATH = os.path.join(os.path.dirname(__file__), "Captone - Draft.ipynb")
with open(NB_PATH, encoding="utf-8") as f:
    nb = json.load(f)

NEW_GRIDSEARCH_CELL = '''\
# ── 8.3  GridSearchCV – Hyperparameter Tuning ────────────────────────────────
#
# SPEED OPTIMISATIONS applied (vs. original):
#   • n_jobs=-1  on every GridSearchCV  → uses all CPU cores (3-6× faster)
#   • cv=3       instead of cv=5        → 40 % fewer fits, still statistically valid
#   • RF grid trimmed                   → removed n_estimators=300 (biggest time sink)
#   • RF itself  n_jobs=-1              → each forest built in parallel
#   • Search on 30 % stratified sample  → finds best params fast, then refits on full data
#
# Expected runtime on a typical laptop:  ~20-40 min  (vs. 7 h before)

import time

# ── 30 % stratified sample for the search phase ──────────────────────────────
from sklearn.model_selection import StratifiedShuffleSplit
_sss   = StratifiedShuffleSplit(n_splits=1, test_size=0.70, random_state=42)
_idx   = next(_sss.split(X_train_sc, y_train_sm))[0]
X_srch = X_train_sc[_idx]
y_srch = y_train_sm[_idx]
print(f"Search sample : {X_srch.shape[0]:,} rows  (30 % of {X_train_sc.shape[0]:,})")
print(f"Full train set: {X_train_sc.shape[0]:,} rows  (used for final refit)")

cv3 = StratifiedKFold(n_splits=3, shuffle=True, random_state=42)

best_estimators = {}
t0 = time.time()

# ── Logistic Regression (L1 / L2) ────────────────────────────────────────────
print("\\n[1/3] Logistic Regression GridSearch ...")
lr_grid = {
    "C"      : [0.01, 0.1, 1, 10],
    "penalty": ["l1", "l2"],
    "solver" : ["liblinear"],          # liblinear handles both L1 & L2
}
gs_lr = GridSearchCV(
    LogisticRegression(max_iter=1000, class_weight="balanced"),
    lr_grid, cv=cv3, scoring="f1_macro",
    n_jobs=-1, verbose=1              # n_jobs=-1 = all cores
)
gs_lr.fit(X_srch, y_srch)
# Refit best params on FULL training data
best_lr = LogisticRegression(max_iter=1000, class_weight="balanced",
                              **gs_lr.best_params_).fit(X_train_sc, y_train_sm)
best_estimators["Logistic Regression (Tuned)"] = best_lr
print(f"   Best params : {gs_lr.best_params_}")
print(f"   CV F1-macro : {gs_lr.best_score_:.4f}  ({time.time()-t0:.0f}s elapsed)")

# ── Random Forest ─────────────────────────────────────────────────────────────
print("\\n[2/3] Random Forest GridSearch ...")
rf_grid = {
    "n_estimators"    : [100, 200],        # dropped 300 — not worth the time
    "max_depth"       : [None, 10, 20],
    "min_samples_split": [2, 5],
}
gs_rf = GridSearchCV(
    RandomForestClassifier(class_weight="balanced", n_jobs=-1, random_state=42),
    rf_grid, cv=cv3, scoring="f1_macro",
    n_jobs=-1, verbose=1
)
gs_rf.fit(X_srch, y_srch)
best_rf = RandomForestClassifier(class_weight="balanced", n_jobs=-1, random_state=42,
                                  **gs_rf.best_params_).fit(X_train_sc, y_train_sm)
best_estimators["Random Forest (Tuned)"] = best_rf
print(f"   Best params : {gs_rf.best_params_}")
print(f"   CV F1-macro : {gs_rf.best_score_:.4f}  ({time.time()-t0:.0f}s elapsed)")

# ── LightGBM ─────────────────────────────────────────────────────────────────
if LGBM_OK:
    print("\\n[3/3] LightGBM GridSearch ...")
    lgbm_grid = {
        "n_estimators" : [200, 400],
        "learning_rate": [0.05, 0.1],
        "num_leaves"   : [31, 63],
    }
    gs_lgbm = GridSearchCV(
        lgb.LGBMClassifier(class_weight="balanced", random_state=42,
                            n_jobs=-1, verbose=-1),
        lgbm_grid, cv=cv3, scoring="f1_macro",
        n_jobs=-1, verbose=1
    )
    gs_lgbm.fit(X_srch, y_srch)
    best_lgbm = lgb.LGBMClassifier(class_weight="balanced", random_state=42,
                                    n_jobs=-1, verbose=-1,
                                    **gs_lgbm.best_params_).fit(X_train_sc, y_train_sm)
    best_estimators["LightGBM (Tuned)"] = best_lgbm
    print(f"   Best params : {gs_lgbm.best_params_}")
    print(f"   CV F1-macro : {gs_lgbm.best_score_:.4f}  ({time.time()-t0:.0f}s elapsed)")
else:
    print("\\n[3/3] LightGBM skipped (not installed).")

total = time.time() - t0
print(f"\\nGridSearchCV complete in {total/60:.1f} min  ({len(best_estimators)} models tuned)")
print("best_estimators dict keys:", list(best_estimators.keys()))
'''

found = False
for i, cell in enumerate(nb["cells"]):
    src = "".join(cell.get("source", ""))
    if "GridSearchCV" in src and ("lr_grid" in src or "rf_grid" in src or "lgbm_grid" in src):
        cell["source"] = NEW_GRIDSEARCH_CELL
        cell["outputs"] = []
        cell["execution_count"] = None
        print(f"Cell {i}: GridSearchCV cell replaced with optimised version")
        found = True
        break

if not found:
    print("GridSearchCV cell not found by grid names — searching for alternative markers...")
    for i, cell in enumerate(nb["cells"]):
        src = "".join(cell.get("source", ""))
        if "8.3" in src and "GridSearch" in src:
            cell["source"] = NEW_GRIDSEARCH_CELL
            cell["outputs"] = []
            cell["execution_count"] = None
            print(f"Cell {i}: GridSearchCV cell replaced (matched on '8.3')")
            found = True
            break

if not found:
    print("ERROR: Could not locate the GridSearchCV cell.")

with open(NB_PATH, "w", encoding="utf-8") as f:
    json.dump(nb, f, indent=1, ensure_ascii=False)

print("DONE" if found else "DONE (with warnings)")
