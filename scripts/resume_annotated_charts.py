#!/usr/bin/env python3
"""Resume annotated-chart refresh from cell 96 after warm-start bootstrap."""
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

RESUME_CELLS = [96, 98, 102, 104, 106]


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
        "dnn_result": None,
        "dnn_1_result": None,
        "dnn_2_result": None,
        "model_dnn": None,
        "device": None,
        "vision_model": None,
        "vision_val_acc": None,
    }

    # Bootstrap imports + data prep + warm models by reusing notebook cells
    boot = [1, 6, 70, 80]
    # cell 80 will be replaced with warm-start inline
    print("Bootstrap…", flush=True)
    for idx in [1, 6, 70]:
        src = "".join(nb.cells[idx].source)
        exec(compile("import matplotlib\nmatplotlib.use('Agg')\n" + src, f"boot_{idx}", "exec"), g, g)
        print(f"  boot cell {idx} ok", flush=True)

    warm = r'''
import joblib
from pathlib import Path
_mdir = Path(REPO_ROOT) / "models"
best_estimators = {}
for _label, _file in [
    ("Logistic Regression (Tuned)", "lr_tuned.joblib"),
    ("Random Forest (Tuned)", "rf_tuned.joblib"),
    ("LightGBM (Tuned)", "lgbm_tuned.joblib"),
]:
    _p = _mdir / _file
    if _p.is_file():
        best_estimators[_label] = joblib.load(_p)
        print("loaded", _label)
class _FakeGS:
    def __init__(self, est):
        self.best_params_ = est.get_params() if est is not None else {}
        self.best_estimator_ = est
gs_rf = _FakeGS(best_estimators.get("Random Forest (Tuned)"))
'''
    exec(compile(warm, "warm", "exec"), g, g)

    # Ensure available feature names for SHAP/FI plots
    if "available" not in g:
        import joblib
        fn = ROOT / "models" / "feature_names.joblib"
        if fn.is_file():
            g["available"] = list(joblib.load(fn))

    t0 = time.time()
    exec_count = 200
    for idx in RESUME_CELLS:
        cell = nb.cells[idx]
        src = "".join(cell.source)
        preview = src.strip().split("\n")[0][:80]
        print(f"run cell {idx}: {preview}", flush=True)
        buf_out, buf_err = io.StringIO(), io.StringIO()
        exec_count += 1
        cell["execution_count"] = exec_count
        cell["outputs"] = []
        try:
            with redirect_stdout(buf_out), redirect_stderr(buf_err):
                exec(compile("import matplotlib\nmatplotlib.use('Agg')\n" + src, f"cell_{idx}", "exec"), g, g)
            if buf_out.getvalue():
                cell["outputs"].append(
                    new_output(output_type="stream", name="stdout", text=buf_out.getvalue())
                )
                for line in buf_out.getvalue().strip().splitlines()[-6:]:
                    print(f"  | {line}", flush=True)
            if buf_err.getvalue():
                cell["outputs"].append(
                    new_output(output_type="stream", name="stderr", text=buf_err.getvalue())
                )
            capture(cell, new_output)
            print("  ok", flush=True)
            nbformat.write(nb, nb_path)
        except Exception as e:
            tb = traceback.format_exc()
            cell["outputs"].append(
                new_output(
                    output_type="error",
                    ename=type(e).__name__,
                    evalue=str(e),
                    traceback=tb.splitlines(),
                )
            )
            nbformat.write(nb, nb_path)
            print(f"  FAIL: {e}\n{tb[-2000:]}", flush=True)
            return 1

    try:
        from sync_notebook_parts import sync_main_to_parts

        sync_main_to_parts(ROOT, only=None, sync_source=True)
        print("Parts synced", flush=True)
    except Exception as e:
        print(f"Parts sync skipped: {e}", flush=True)

    print(f"SUCCESS resume in {(time.time()-t0)/60:.1f} min", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
