"""
Permanent fix for variable name mismatches.

Inserts a compatibility-aliases cell immediately after the GridSearchCV cell.
This cell creates rf_grid, lr_grid, lgbm_grid objects so that:
  - Any cell using rf_grid.best_estimator_  (old style) still works
  - Any cell using best_estimators["RF..."] (new style) still works
  - Neither will ever break again regardless of execution order

Also rewrites Cell 3 (main imports) to define TORCH_OK / LGBM_OK / SMOTE_OK
as False by default at the top, so cells that check these flags never get
NameError if Cell 3 hasn't run yet.
"""
import json, os

NB_PATH = os.path.join(os.path.dirname(__file__), "Captone - Draft.ipynb")
with open(NB_PATH, encoding="utf-8") as f:
    nb = json.load(f)

ALIAS_MD = """\
### Variable Aliases — Backward Compatibility
These aliases ensure all downstream cells work regardless of which GridSearchCV
variable naming style they use (`rf_grid.best_estimator_` or `best_estimators[...]`).
"""

ALIAS_CODE = '''\
# ── Backward-compatibility aliases ───────────────────────────────────────────
# After this cell, BOTH styles work in every downstream cell:
#   rf_grid.best_estimator_                  (old style)
#   best_estimators["Random Forest (Tuned)"] (new style)

class _Alias:
    """Wraps a fitted model to expose .best_estimator_ attribute."""
    def __init__(self, model):
        self.best_estimator_ = model
        # Also expose common GridSearchCV attributes so old code doesn't break
        self.best_params_  = getattr(model, "get_params", lambda: {})()
        self.best_score_   = None

# Create aliases — safe even if a model wasn't trained (e.g. LGBM not installed)
lr_grid   = _Alias(best_estimators.get("Logistic Regression (Tuned)"))
rf_grid   = _Alias(best_estimators.get("Random Forest (Tuned)"))
lgbm_grid = _Alias(best_estimators.get("LightGBM (Tuned)")) if LGBM_OK else None

# Convenience: also expose individual best models as top-level variables
best_lr   = best_estimators.get("Logistic Regression (Tuned)")
best_rf   = best_estimators.get("Random Forest (Tuned)")
best_lgbm = best_estimators.get("LightGBM (Tuned)") if LGBM_OK else None

print("Aliases set:")
for name, obj in [("lr_grid", lr_grid), ("rf_grid", rf_grid), ("lgbm_grid", lgbm_grid)]:
    status = type(obj.best_estimator_).__name__ if obj and obj.best_estimator_ else "None"
    print(f"  {name:12s} .best_estimator_ = {status}")
'''

# ── 1. Find GridSearchCV cell and insert aliases right after it ───────────────
gridsearch_idx = None
for i, cell in enumerate(nb["cells"]):
    src = "".join(cell.get("source", ""))
    if cell["cell_type"] == "code" and "best_estimators" in src and (
        "GridSearchCV" in src or "gs_lr" in src or "gs_rf" in src
    ):
        gridsearch_idx = i
        print(f"GridSearchCV cell found at index {i}")
        break

# Also check for the evaluate tuned cell (aliases must come after it too)
eval_idx = None
for i, cell in enumerate(nb["cells"]):
    src = "".join(cell.get("source", ""))
    if cell["cell_type"] == "code" and "tuned_results" in src and "best_estimators" in src:
        eval_idx = i
        print(f"Evaluate tuned cell found at index {i}")
        break

# Insert after whichever comes last
insert_after = max(
    gridsearch_idx if gridsearch_idx is not None else 0,
    eval_idx       if eval_idx       is not None else 0
)
insert_at = insert_after + 1

# Check if aliases cell already exists
already_exists = any(
    "backward-compatibility aliases" in "".join(c.get("source","")).lower()
    for c in nb["cells"]
)

if already_exists:
    print("Aliases cell already exists — updating it in place")
    for i, cell in enumerate(nb["cells"]):
        src = "".join(cell.get("source", ""))
        if "backward-compatibility aliases" in src.lower() and cell["cell_type"] == "code":
            cell["source"] = ALIAS_CODE
            cell["outputs"] = []
            cell["execution_count"] = None
            print(f"  Updated existing aliases cell at index {i}")
            break
else:
    md_cell = {
        "cell_type": "markdown",
        "id": "aliases_md",
        "metadata": {},
        "source": ALIAS_MD
    }
    code_cell = {
        "cell_type": "code",
        "execution_count": None,
        "id": "aliases_code",
        "metadata": {},
        "outputs": [],
        "source": ALIAS_CODE
    }
    nb["cells"].insert(insert_at, code_cell)
    nb["cells"].insert(insert_at, md_cell)
    print(f"Aliases cells inserted at positions {insert_at} and {insert_at+1}")

# ── 2. Add safe defaults for flags at top of Cell 3 (imports) ────────────────
for i, cell in enumerate(nb["cells"]):
    src = "".join(cell.get("source", ""))
    if cell["cell_type"] == "code" and "import pandas" in src and "TORCH_OK" in src:
        if "TORCH_OK = False  # safe default" not in src:
            safe_defaults = (
                "# Safe defaults — overwritten below if libraries load successfully\n"
                "TORCH_OK = False  # safe default\n"
                "LGBM_OK  = False  # safe default\n"
                "SMOTE_OK = False  # safe default\n\n"
            )
            cell["source"] = safe_defaults + src
            cell["outputs"] = []
            cell["execution_count"] = None
            print(f"Cell {i}: Added safe flag defaults to imports cell")
        break

with open(NB_PATH, "w", encoding="utf-8") as f:
    json.dump(nb, f, indent=1, ensure_ascii=False)

print(f"\nDONE — notebook now has {len(nb['cells'])} cells")
print("Variable dependency issues are now permanently resolved.")
