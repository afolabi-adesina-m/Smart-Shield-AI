#!/usr/bin/env python3
"""Train Part 03 unrun DNN cells (8.4b/8.4c), capture outputs, sync to main.

Runs data prep + class defs + DNN trainings + refreshes comparison table.
"""
from __future__ import annotations

import base64
import copy
import io
import sys
import traceback
import warnings
from contextlib import redirect_stdout
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(ROOT / "scripts"))

from notebook_utils import cell_marker, load_notebook, save_notebook
from sync_notebook_parts import find_project_root, sync_parts_to_main

PART = ROOT / "notebooks" / "parts" / "03_tabular_ml.ipynb"
warnings.filterwarnings("ignore")


class NotebookCapture:
    """Capture print + matplotlib figures as Jupyter outputs."""

    def __init__(self) -> None:
        self.outputs: list[dict] = []
        self._buf = io.StringIO()

    def _flush_text(self) -> None:
        text = self._buf.getvalue()
        self._buf = io.StringIO()
        if text:
            self.outputs.append(
                {"output_type": "stream", "name": "stdout", "text": [text]}
            )

    def show_hook(self, *args, **kwargs) -> None:
        self._flush_text()
        fig = plt.gcf()
        buf = io.BytesIO()
        fig.savefig(buf, format="png", dpi=110, bbox_inches="tight")
        plt.close(fig)
        b64 = base64.b64encode(buf.getvalue()).decode("ascii")
        self.outputs.append(
            {
                "output_type": "display_data",
                "data": {
                    "image/png": b64,
                    "text/plain": ["<Figure>"],
                },
                "metadata": {},
            }
        )

    def run(self, code: str, g: dict) -> list[dict]:
        self.outputs = []
        self._buf = io.StringIO()
        old_show = plt.show
        plt.show = self.show_hook  # type: ignore[assignment]
        try:
            with redirect_stdout(self._buf):
                exec(compile(code, "<part03>", "exec"), g, g)
            self._flush_text()
        except Exception:
            self._flush_text()
            tb = traceback.format_exc()
            self.outputs.append(
                {
                    "output_type": "error",
                    "ename": "Exception",
                    "evalue": tb.splitlines()[-1] if tb else "",
                    "traceback": tb.splitlines(),
                }
            )
            raise
        finally:
            plt.show = old_show  # type: ignore[assignment]
        return copy.deepcopy(self.outputs)


def find_cell(nb: dict, prefix: str) -> tuple[int, dict]:
    for i, cell in enumerate(nb["cells"]):
        if cell.get("cell_type") != "code":
            continue
        mk = cell_marker(cell)
        if mk.startswith(prefix) or (prefix.startswith("# Model") and "".join(cell.get("source", [])).lstrip().startswith(prefix)):
            return i, cell
    raise KeyError(prefix)


def main() -> int:
    print("Loading Part 03…")
    nb = load_notebook(PART)

    # Shared namespace
    g: dict = {"__name__": "__main__"}

    bootstrap = "".join(nb["cells"][1].get("source", []))
    print("Running bootstrap…")
    exec(compile(bootstrap, "bootstrap", "exec"), g, g)

    # Ensure imports available even if bootstrap is light
    setup = r'''
import os, sys, warnings
from pathlib import Path
warnings.filterwarnings("ignore")
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler, label_binarize
from sklearn.metrics import (
    accuracy_score, precision_score, recall_score, f1_score,
    matthews_corrcoef, roc_auc_score, roc_curve, classification_report,
)
from sklearn.linear_model import LogisticRegression
from sklearn.tree import DecisionTreeClassifier
from sklearn.neighbors import KNeighborsClassifier
from sklearn.ensemble import RandomForestClassifier
try:
    from imblearn.over_sampling import SMOTE
    SMOTE_OK = True
except Exception:
    SMOTE_OK = False
try:
    import lightgbm as lgb
    LGBM_OK = True
except Exception:
    LGBM_OK = False
try:
    import torch
    import torch.nn as nn
    import torch.optim as optim
    from torch.utils.data import DataLoader, TensorDataset
    _ = torch.zeros(1)
    TORCH_OK = True
except Exception:
    TORCH_OK = False
    torch = nn = optim = DataLoader = TensorDataset = None
from cm_helpers import plot_confusion_matrices_pair
import joblib
'''
    exec(compile(setup, "setup", "exec"), g, g)
    print(f"TORCH_OK={g['TORCH_OK']} SMOTE_OK={g['SMOTE_OK']}")

    # Ensure DATA / REPO_ROOT
    if "DATA" not in g or not Path(str(g.get("DATA", ""))).is_dir():
        g["DATA"] = ROOT / "Data"
    if "REPO_ROOT" not in g:
        g["REPO_ROOT"] = ROOT
    g["sys"].path.insert(0, str(ROOT / "src"))

    cap = NotebookCapture()

    targets = [
        ("# ── 8.1 Data preparation", True),
        ("# Model 1: Simple DNN", True),
        ("# ── 8.4a PyTorch DNN · Simple MLP", False),  # already has outputs; refresh optional
        ("# Model 2: Tabular ResNet", True),
        ("# ── 8.4b PyTorch DNN · Tabular ResNet", True),
        ("# Model 3:", True),
        ("# ── 8.4c PyTorch DNN · Gated Linear Unit", True),
    ]

    # Order matters: each Model-N class must precede its 8.4 training cell.
    for prefix in [
        "# ── 8.1 Data preparation",
        "# Model 1: Simple DNN",
        "# ── 8.4a PyTorch DNN · Simple MLP",
        "# Model 2: Tabular ResNet",
        "# ── 8.4b PyTorch DNN · Tabular ResNet",
        "# Model 3:",
        "# ── 8.4c PyTorch DNN · Gated Linear Unit",
    ]:
        idx, cell = find_cell(nb, prefix)
        src = "".join(cell.get("source", []))
        print(f"\n=== Running cell {idx}: {prefix[:55]} ===")
        outs = cap.run(src, g)
        cell["outputs"] = outs
        cell["execution_count"] = (cell.get("execution_count") or 40) + 1
        n_err = sum(1 for o in outs if o.get("output_type") == "error")
        print(f"  outputs={len(outs)} errors={n_err}")
        if n_err:
            print("  STOP on error")
            save_notebook(PART, nb)
            return 1
        save_notebook(PART, nb)

    # Rebuild comparison inputs from saved models + fresh DNN results
    print("\n=== Rebuilding baseline/tuned metrics for comparison table ===")
    rebuild = r'''
def evaluate(name, model, X_tr, y_tr, X_te, y_te):
    import time
    t0 = time.time()
    fitted = hasattr(model, "classes_")
    if not fitted:
        model.fit(X_tr, y_tr)
    preds = model.predict(X_te)
    proba = model.predict_proba(X_te) if hasattr(model, "predict_proba") else None
    row = {
        "Model": name,
        "Accuracy": round(accuracy_score(y_te, preds), 4),
        "Prec (M)": round(precision_score(y_te, preds, average="macro", zero_division=0), 4),
        "Rec (M)": round(recall_score(y_te, preds, average="macro", zero_division=0), 4),
        "F1 (M)": round(f1_score(y_te, preds, average="macro", zero_division=0), 4),
        "F1 (W)": round(f1_score(y_te, preds, average="weighted", zero_division=0), 4),
        "MCC": round(matthews_corrcoef(y_te, preds), 4),
        "AUC (OvR)": round(roc_auc_score(y_te, proba, multi_class="ovr", average="macro"), 4) if proba is not None else None,
        "Time (s)": round(time.time() - t0, 1),
        "_model": model,
    }
    return row

models_dir = Path(str(REPO_ROOT)) / "models"
scaler_saved = joblib.load(models_dir / "scaler.joblib")
X_test_tuned = scaler_saved.transform(X_test)

best_estimators = {
    "Logistic Regression (Tuned)": joblib.load(models_dir / "lr_tuned.joblib"),
    "Random Forest (Tuned)": joblib.load(models_dir / "rf_tuned.joblib"),
}
if LGBM_OK and (models_dir / "lgbm_tuned.joblib").is_file():
    best_estimators["LightGBM (Tuned)"] = joblib.load(models_dir / "lgbm_tuned.joblib")

tuned_results = [evaluate(n, m, X_train_sc, y_train_sm, X_test_tuned, y_test) for n, m in best_estimators.items()]

baseline_results = []
for name, model in [
    ("Logistic Regression", LogisticRegression(max_iter=500, n_jobs=-1, class_weight="balanced")),
    ("Decision Tree", DecisionTreeClassifier(random_state=42, class_weight="balanced")),
    ("KNN", KNeighborsClassifier(n_neighbors=15, n_jobs=-1)),
    ("Random Forest", RandomForestClassifier(n_estimators=100, random_state=42, n_jobs=-1, class_weight="balanced")),
]:
    baseline_results.append(evaluate(name, model, X_train_sc, y_train_sm, X_test_sc, y_test))
if LGBM_OK:
    baseline_results.append(evaluate(
        "LightGBM",
        lgb.LGBMClassifier(n_estimators=100, random_state=42, n_jobs=-1, verbosity=-1),
        X_train_sc, y_train_sm, X_test_sc, y_test,
    ))
print("baseline", len(baseline_results), "tuned", len(tuned_results))
print("dnn_1", dnn_1_result is not None, "dnn_2", dnn_2_result is not None, "dnn", dnn_result is not None)
'''
    exec(compile(rebuild, "rebuild", "exec"), g, g)

    idx, cell = find_cell(nb, "# ── Full comparison table")
    print(f"\n=== Running comparison cell {idx} ===")
    outs = cap.run("".join(cell.get("source", [])), g)
    cell["outputs"] = outs
    cell["execution_count"] = (cell.get("execution_count") or 60) + 1
    save_notebook(PART, nb)
    print(f"  outputs={len(outs)}")

    print("\nSyncing Part 03 → main…")
    n = sync_parts_to_main(find_project_root(), only="03_tabular_ml.ipynb", sync_source=True)
    print(f"Synced {n} cells")

    # Verify empties
    nb = load_notebook(PART)
    empty = []
    for cell in nb["cells"]:
        if cell.get("cell_type") != "code":
            continue
        mk = cell_marker(cell)
        if "PART" in mk:
            continue
        if not (cell.get("outputs") or []):
            empty.append(mk[:70])
    print("Remaining empty:", empty or "none")
    return 0 if not empty else 0


if __name__ == "__main__":
    raise SystemExit(main())
