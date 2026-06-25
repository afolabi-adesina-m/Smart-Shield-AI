"""
Fix the 'Evaluate tuned models' cell:
  Old code used lr_grid.best_estimator_, rf_grid.best_estimator_ etc.
  New GridSearchCV cell stores results in best_estimators{} dict.
  Replace the cell to read from best_estimators directly.
"""
import json, os

NB_PATH = os.path.join(os.path.dirname(__file__), "Captone - Draft.ipynb")
with open(NB_PATH, encoding="utf-8") as f:
    nb = json.load(f)

NEW_EVAL_CELL = '''\
# ── 8.3b  Evaluate Tuned Models ──────────────────────────────────────────────
# Reads from best_estimators{} dict populated by the GridSearchCV cell above.

tuned_results = []
for name, clf in best_estimators.items():
    res = evaluate(name, clf, X_train_sc, y_train_sm, X_test_sc, y_test)
    tuned_results.append(res)
    print(f"{name:35s} Acc={res['Accuracy']}  "
          f"Rec(M)={res['Rec (M)']}  MCC={res['MCC']}  "
          f"AUC={res['AUC (OvR)']}  Time={res['Time (s)']}s")

cols = ["Model","Accuracy","Prec (M)","Rec (M)","F1 (M)","F1 (W)","MCC","AUC (OvR)","Time (s)"]
df_tuned = pd.DataFrame(tuned_results)[cols]
print("\\n=== Tuned Model Results ===")
print(df_tuned.to_string(index=False))
'''

found = False
for i, cell in enumerate(nb["cells"]):
    src = "".join(cell.get("source", ""))
    if cell["cell_type"] == "code" and (
        "best_estimator_" in src or
        ("tuned_map" in src and "evaluate" in src) or
        ("tuned_results" in src and "lr_grid" in src)
    ):
        cell["source"] = NEW_EVAL_CELL
        cell["outputs"] = []
        cell["execution_count"] = None
        print(f"Cell {i}: Evaluate tuned models cell fixed")
        found = True
        break

if not found:
    print("ERROR: Evaluate tuned models cell not found")

with open(NB_PATH, "w", encoding="utf-8") as f:
    json.dump(nb, f, indent=1, ensure_ascii=False)

print("DONE")
