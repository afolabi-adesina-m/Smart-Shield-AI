"""
Global search-and-replace across ALL notebook cells:
  Old names (from original GridSearchCV)  →  New names (from optimised GridSearchCV)

  rf_grid.best_estimator_       → best_estimators["Random Forest (Tuned)"]
  lr_grid.best_estimator_       → best_estimators["Logistic Regression (Tuned)"]
  lgbm_grid.best_estimator_     → best_estimators["LightGBM (Tuned)"]
  gs_rf.best_estimator_         → best_estimators["Random Forest (Tuned)"]
  gs_lr.best_estimator_         → best_estimators["Logistic Regression (Tuned)"]
  gs_lgbm.best_estimator_       → best_estimators["LightGBM (Tuned)"]
  lgbm_grid:                    → guard with LGBM_OK check
"""
import json, os, re

NB_PATH = os.path.join(os.path.dirname(__file__), "Captone - Draft.ipynb")
with open(NB_PATH, encoding="utf-8") as f:
    nb = json.load(f)

REPLACEMENTS = [
    # GridSearchCV object references
    ('rf_grid.best_estimator_',   'best_estimators["Random Forest (Tuned)"]'),
    ('lr_grid.best_estimator_',   'best_estimators["Logistic Regression (Tuned)"]'),
    ('lgbm_grid.best_estimator_', 'best_estimators["LightGBM (Tuned)"]'),
    ('gs_rf.best_estimator_',     'best_estimators["Random Forest (Tuned)"]'),
    ('gs_lr.best_estimator_',     'best_estimators["Logistic Regression (Tuned)"]'),
    ('gs_lgbm.best_estimator_',   'best_estimators["LightGBM (Tuned)"]'),
    # Condition checks that used the old grid objects
    ('if lgbm_grid:',             'if LGBM_OK and "LightGBM (Tuned)" in best_estimators:'),
    ('if lgbm_grid ',             'if LGBM_OK and "LightGBM (Tuned)" in best_estimators '),
]

total_fixes = 0
cells_fixed = []

for i, cell in enumerate(nb["cells"]):
    if cell["cell_type"] != "code":
        continue
    src = "".join(cell.get("source", ""))
    original = src
    for old, new in REPLACEMENTS:
        if old in src:
            count = src.count(old)
            src = src.replace(old, new)
            print(f"  Cell {i}: replaced {count}x  '{old}'")
            total_fixes += count
    if src != original:
        cell["source"] = src
        cell["outputs"] = []
        cell["execution_count"] = None
        cells_fixed.append(i)

print(f"\nTotal replacements : {total_fixes}")
print(f"Cells modified     : {cells_fixed}")

with open(NB_PATH, "w", encoding="utf-8") as f:
    json.dump(nb, f, indent=1, ensure_ascii=False)

print("\nDONE — all old grid variable references replaced globally.")
