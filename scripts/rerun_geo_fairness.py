#!/usr/bin/env python3
"""Re-run fairness cell after geo-audit fix (skip slow KNN for this refresh)."""
from __future__ import annotations

import base64
import io
import os
import sys
import time
import traceback
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
os.chdir(ROOT / "notebooks")
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(ROOT / "scripts"))
os.environ.setdefault("MPLBACKEND", "Agg")


def pick_gpu():
    try:
        import subprocess

        out = subprocess.check_output(
            ["nvidia-smi", "--query-gpu=index,name,memory.free", "--format=csv,noheader,nounits"],
            text=True,
        )
    except Exception:
        return None
    best_idx, best_free = None, -1
    for line in out.strip().splitlines():
        parts = [p.strip() for p in line.split(",")]
        if len(parts) < 3:
            continue
        idx, name, free = int(parts[0]), parts[1], float(parts[2])
        if "Display" in name:
            continue
        if free > best_free:
            best_idx, best_free = idx, free
    return str(best_idx) if best_idx is not None else None


def capture(cell, new_output):
    import matplotlib.pyplot as plt

    if not plt.get_fignums():
        return
    for fignum in list(plt.get_fignums()):
        fig = plt.figure(fignum)
        bio = io.BytesIO()
        fig.savefig(bio, format="png", bbox_inches="tight", dpi=120)
        b64 = base64.b64encode(bio.getvalue()).decode("ascii")
        cell["outputs"].append(
            new_output(
                output_type="display_data",
                data={"image/png": b64, "text/plain": f"<Figure {fignum}>"},
                metadata={},
            )
        )
    plt.close("all")


def main() -> int:
    gpu = pick_gpu()
    if gpu:
        os.environ["CUDA_VISIBLE_DEVICES"] = gpu

    import matplotlib

    matplotlib.use("Agg")
    import nbformat
    from nbformat.v4 import new_output

    nb_path = ROOT / "notebooks" / "capstone_with_results.ipynb"
    nb = nbformat.read(nb_path, as_version=4)

    g = {
        "__name__": "__main__",
        "REPO_ROOT": ROOT,
        "DATA": ROOT / "Data",
        "display": lambda *a, **k: print(*a),
        "get_ipython": lambda: None,
    }

    def run_src(label, src):
        t1 = time.time()
        print(f"→ {label}", flush=True)
        buf_out, buf_err = io.StringIO(), io.StringIO()
        with redirect_stdout(buf_out), redirect_stderr(buf_err):
            exec(compile("import matplotlib\nmatplotlib.use('Agg')\n" + src, label, "exec"), g, g)
        for line in buf_out.getvalue().strip().splitlines()[-8:]:
            print(f"  | {line}", flush=True)
        if buf_err.getvalue().strip():
            for line in buf_err.getvalue().strip().splitlines()[-4:]:
                print(f"  ! {line}", flush=True)
        print(f"  ok ({time.time()-t1:.1f}s)", flush=True)
        return buf_out.getvalue(), buf_err.getvalue()

    # Setup + imports + Sec 8.1
    for idx in (1, 6, 70):
        run_src(f"cell_{idx}", "".join(nb.cells[idx].source))

    # Fast baselines (skip KNN — was ~7 min and not required for geo RF check)
    fast_bl = r'''
import time
baseline_results = []

def evaluate(name, model, X_tr, y_tr, X_te, y_te):
    t0 = time.time()
    model.fit(X_tr, y_tr)
    preds = model.predict(X_te)
    proba = model.predict_proba(X_te) if hasattr(model, "predict_proba") else None
    auc = (round(roc_auc_score(y_te, proba, multi_class="ovr", average="macro"), 4)
           if proba is not None else None)
    return {
        "Model": name,
        "Accuracy": round(accuracy_score(y_te, preds), 4),
        "Prec (M)": round(precision_score(y_te, preds, average="macro", zero_division=0), 4),
        "Rec (M)": round(recall_score(y_te, preds, average="macro", zero_division=0), 4),
        "F1 (M)": round(f1_score(y_te, preds, average="macro", zero_division=0), 4),
        "F1 (W)": round(f1_score(y_te, preds, average="weighted", zero_division=0), 4),
        "MCC": round(matthews_corrcoef(y_te, preds), 4),
        "AUC (OvR)": auc,
        "Time (s)": round(time.time() - t0, 1),
        "_model": model,
        "_preds": preds,
    }

baseline_models = [
    ("Logistic Regression",
     LogisticRegression(max_iter=1000, class_weight="balanced", n_jobs=-1, solver="lbfgs")),
    ("Decision Tree",
     DecisionTreeClassifier(max_depth=15, class_weight="balanced", random_state=42)),
    ("Random Forest",
     RandomForestClassifier(n_estimators=100, class_weight="balanced", n_jobs=-1, random_state=42)),
]
if LGBM_OK:
    baseline_models.append(
        ("LightGBM",
         lgb.LGBMClassifier(n_estimators=200, class_weight="balanced",
                            n_jobs=-1, random_state=42, verbosity=-1))
    )

print("Training fast baselines (KNN skipped for geo-fix refresh)...")
for name, model in baseline_models:
    res = evaluate(name, model, X_train_sc, y_train_sm, X_test_sc, y_test)
    baseline_results.append(res)
    print(f"  {name}: Acc={res['Accuracy']} Rec(M)={res['Rec (M)']} MCC={res['MCC']} ({res['Time (s)']}s)")
'''
    run_src("fast_baselines", fast_bl)

    # Fairness cell (includes fixed geo audit)
    cell = nb.cells[76]
    src = "".join(cell.source)
    print("→ cell 76 fairness + geo", flush=True)
    t1 = time.time()
    buf_out, buf_err = io.StringIO(), io.StringIO()
    cell["outputs"] = []
    cell["execution_count"] = (cell.get("execution_count") or 0) + 1
    try:
        with redirect_stdout(buf_out), redirect_stderr(buf_err):
            exec(compile("import matplotlib\nmatplotlib.use('Agg')\n" + src, "cell_76", "exec"), g, g)
        out_text = buf_out.getvalue()
        err_text = buf_err.getvalue()
        if out_text:
            cell["outputs"].append(new_output(output_type="stream", name="stdout", text=out_text))
            for line in out_text.strip().splitlines():
                if "Geo" in line or "Demographic" in line or "parity" in line.lower() or "Urban" in line or "Suburban" in line or "INCOMPLETE" in line or "DONE" in line or "PASS" in line or "FAIL" in line:
                    print(f"  | {line}", flush=True)
        if err_text:
            cell["outputs"].append(new_output(output_type="stream", name="stderr", text=err_text))
        capture(cell, new_output)
        print(f"  ok ({time.time()-t1:.1f}s)  geo_audit_ok={g.get('geo_audit_ok')}", flush=True)
    except Exception as e:
        tb = traceback.format_exc()
        cell["outputs"].append(
            new_output(output_type="error", ename=type(e).__name__, evalue=str(e), traceback=tb.splitlines())
        )
        print(f"FAIL: {e}\n{tb[-2000:]}", flush=True)
        nbformat.write(nb, nb_path)
        return 1

    nbformat.write(nb, nb_path)
    try:
        from sync_notebook_parts import sync_main_to_parts

        sync_main_to_parts(ROOT, only=None, sync_source=True)
        print("Parts synced", flush=True)
    except Exception as e:
        print(f"Parts sync skipped: {e}", flush=True)

    print("SUCCESS" if g.get("geo_audit_ok") else "DONE_BUT_GEO_STILL_FALSE", flush=True)
    return 0 if g.get("geo_audit_ok") else 2


if __name__ == "__main__":
    raise SystemExit(main())
