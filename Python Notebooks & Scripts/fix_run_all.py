"""Add Run-All guide and fix cells for top-to-bottom execution."""
import json
from pathlib import Path

NB = Path(__file__).parent / "Captone - Draft.ipynb"
nb = json.load(open(NB, encoding="utf-8"))
cells = nb["cells"]

RUN_ALL_MD = {
    "cell_type": "markdown",
    "id": "run_all_guide",
    "metadata": {},
    "source": """---
## Run All — Start Here

**Run cells top to bottom** (Runtime → Run All, or Shift+Enter through each cell).

| Phase | Cells (approx.) | Time | Notes |
|-------|-----------------|------|-------|
| Setup | 1, 5 | 1–3 min | Installs packages; if torch was just installed, **Kernel → Restart** then rerun from cell 1 |
| Data + EDA | 7–20 | 2–5 min | Loads Toronto + DfT CSVs from `Data/` |
| Preprocess + stats | 23–34 | 2–3 min | |
| Vision Brain | 39–41 | 3–8 min | Downloads sample road images; needs `TORCH_OK=True` |
| Modelling | 44–64 | **20–45 min** | GridSearchCV is the slow step |
| Sprint 3 | 68–74 | 3–5 min | NLP, Safety Score, SHAP, save models |

**Requirements:** `Data/traffic collision data.csv` and `Data/UK Accidents 2024/` in project folder.

**If a cell fails:** note the cell number, fix the error, then **Run All Below** from the next cell — do not restart unless torch was just installed.
""",
}

# Insert after imports cell (index 5)
if not any(c.get("id") == "run_all_guide" for c in cells):
    insert_at = 6
    for i, c in enumerate(cells):
        if c["cell_type"] == "code" and "CELL 3: All imports" in "".join(c.get("source", "")):
            insert_at = i + 1
            break
    cells.insert(insert_at, RUN_ALL_MD)
    print(f"Inserted Run-All guide at {insert_at}")

for c in cells:
    src = "".join(c.get("source", ""))

    # Cell 1: extra packages for Vision + Sprint 3
    if "pkgs_needed = []" in src and "datasets" not in src:
        old = """try:
    import imblearn
except ImportError:
    pkgs_needed.append("imbalanced-learn")"""
        new = """try:
    import imblearn
except ImportError:
    pkgs_needed.append("imbalanced-learn")
for _pkg in ["datasets", "torchvision", "shap"]:
    try:
        __import__(_pkg)
    except ImportError:
        pkgs_needed.append(_pkg)"""
        if old in src:
            c["source"] = src.replace(old, new)
            print("Patched cell 1 extra packages")

    # Cell 64: use gs_rf.best_params_ when available
    if "Final model evaluation" in src and "gs_rf.best_params_" not in src:
        c["source"] = src.replace(
            'print(f"Best params: {rf_grid.best_params_}\\n")',
            'bp = gs_rf.best_params_ if "gs_rf" in dir() else final_model.get_params()\nprint(f"Best params: {bp}\\n")',
        )
        print("Patched cell 64 best_params")

    # Cell 70: softer TC check + nlp_rows guard
    if "10.2  Safety Score fusion" in src:
        c["source"] = src.replace(
            'if "TC" not in dir():\n    raise RuntimeError("Run Section 8.6 (live test cases) first to define TC scenarios.")',
            'if "TC" not in globals():\n    from nlp_brain import SCENARIO_ALERTS\n    TC = {k: [17,7,3,0,1,0,0,1] for k in SCENARIO_ALERTS}  # fallback\n    print("Note: using fallback TC — run Section 8.6 for full live test cases.")\nif "nlp_rows" not in globals():\n    from nlp_brain import fit_tfidf, score_all_scenarios\n    nlp_rows = score_all_scenarios(fit_tfidf())',
        )
        print("Patched cell 70 fusion guards")

    # Cell 72: softer best_estimators check
    if "10.3  SHAP explainability" in src:
        c["source"] = src.replace(
            'if "best_estimators" not in dir():\n    raise RuntimeError("Run Section 8.3 GridSearchCV first.")',
            'if "best_estimators" not in globals() or not best_estimators:\n    raise RuntimeError("Run Section 8.3 GridSearchCV first (cell ~51).")',
        )
        print("Patched cell 72 SHAP guard")

    # Cell 74: guard missing tfidf_vec
    if "10.4  Serialize models" in src and "tfidf_vec" in src:
        c["source"] = src.replace(
            '"tfidf_vectorizer": tfidf_vec,',
            '"tfidf_vectorizer": tfidf_vec if "tfidf_vec" in globals() else fit_tfidf(),',
        )
        if "from nlp_brain import fit_tfidf" not in src:
            c["source"] = c["source"].replace(
                "import joblib",
                "import joblib\nfrom nlp_brain import fit_tfidf",
            )
        print("Patched cell 74 deploy guard")

nb["cells"] = cells
json.dump(nb, open(NB, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
print("DONE")
