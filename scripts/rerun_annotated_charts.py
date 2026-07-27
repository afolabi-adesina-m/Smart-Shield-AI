#!/usr/bin/env python3
"""Re-run only what is needed to refresh annotated chart outputs.

Skips apt-get, Vision fine-tune, GridSearchCV (loads models/*.joblib), and DNN
training. Still rebuilds baselines + fairness + fusion/SHAP/NLP plots so the
new callouts land in the notebook PNGs.

Usage:
  python scripts/rerun_annotated_charts.py
"""
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

# Stop after SHAP cell (106). Skip serialize so we do not overwrite models mid-demo.
LAST_CELL_IDX = 106

SKIP_MARKERS = (
    "apt-get",
    "apt install",
    "fine_tune_vision_model",
    "GridSearchCV – Hyperparameter Tuning",
    "GridSearchCV - Hyperparameter Tuning",
    "PyTorch DNN · Simple MLP",
    "PyTorch DNN · Tabular ResNet",
    "PyTorch DNN · Gated Linear Unit",
)

GRID_WARMSTART = r'''
# Warm-start tuned models from disk (skip GridSearch for chart refresh)
import joblib
from pathlib import Path
_mdir = Path(REPO_ROOT) / "models" if "REPO_ROOT" in dir() else Path("../models")
best_estimators = {}
for _label, _file in [
    ("Logistic Regression (Tuned)", "lr_tuned.joblib"),
    ("Random Forest (Tuned)", "rf_tuned.joblib"),
    ("LightGBM (Tuned)", "lgbm_tuned.joblib"),
]:
    _p = _mdir / _file
    if _p.is_file():
        best_estimators[_label] = joblib.load(_p)
        print(f"  loaded {_label} <- {_p.name}")
    else:
        print(f"  missing {_p.name} (skip {_label})")

class _FakeGS:
    def __init__(self, est):
        self.best_params_ = est.get_params() if est is not None else {}
        self.best_estimator_ = est

gs_rf = _FakeGS(best_estimators.get("Random Forest (Tuned)"))
gs_lr = _FakeGS(best_estimators.get("Logistic Regression (Tuned)"))
print(f"Warm-start complete: {list(best_estimators)}")
'''

DNN_SKIP = r'''
# DNN training skipped in annotated-chart refresh (weights already on disk).
dnn_result = None
dnn_1_result = None
dnn_2_result = None
model_dnn = None
print("DNN cells skipped for chart refresh — comparison uses sklearn + loaded tuned models.")
'''

VISION_SKIP = r'''
# Vision fine-tune skipped — fusion dashboard uses V_PRIORS; weights already in models/.
vision_model = None
vision_history = None
vision_class_names = None
vision_val_acc = None
print("Vision fine-tune skipped for chart refresh.")
'''


def pick_gpu() -> str | None:
    try:
        import subprocess

        out = subprocess.check_output(
            [
                "nvidia-smi",
                "--query-gpu=index,name,memory.free",
                "--format=csv,noheader,nounits",
            ],
            text=True,
        )
    except Exception as e:
        print(f"nvidia-smi failed: {e}", flush=True)
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
    if best_idx is None:
        return None
    print(f"Selected GPU {best_idx} with {best_free:.0f} MiB free", flush=True)
    return str(best_idx)


def _capture_figures(cell, new_output) -> None:
    try:
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
    except Exception:
        pass


def main() -> int:
    gpu = pick_gpu()
    if gpu is not None:
        os.environ["CUDA_VISIBLE_DEVICES"] = gpu
    else:
        os.environ.pop("CUDA_VISIBLE_DEVICES", None)

    import matplotlib

    matplotlib.use("Agg")
    import nbformat
    from nbformat.v4 import new_output

    nb_path = ROOT / "notebooks" / "capstone_with_results.ipynb"
    log_path = ROOT / "logs" / f"annotated_charts_{time.strftime('%Y%m%d_%H%M%S')}.log"
    log_path.parent.mkdir(parents=True, exist_ok=True)

    class Tee:
        def __init__(self, *streams):
            self.streams = streams

        def write(self, data):
            for s in self.streams:
                s.write(data)
                s.flush()

        def flush(self):
            for s in self.streams:
                s.flush()

    log_f = open(log_path, "w", encoding="utf-8")
    sys.stdout = Tee(sys.__stdout__, log_f)
    sys.stderr = Tee(sys.__stderr__, log_f)

    print(f"Executing annotated-chart refresh → {nb_path}", flush=True)
    print(f"Log: {log_path}", flush=True)
    print(f"CUDA_VISIBLE_DEVICES={os.environ.get('CUDA_VISIBLE_DEVICES')}", flush=True)

    import torch

    print(
        f"torch={torch.__version__} cuda={torch.cuda.is_available()} "
        f"name={torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'cpu'}",
        flush=True,
    )

    nb = nbformat.read(nb_path, as_version=4)

    def _display(*args, **kwargs):
        for a in args:
            try:
                print(a)
            except Exception:
                print(repr(a))

    g = {
        "__name__": "__main__",
        "REPO_ROOT": ROOT,
        "DATA": ROOT / "Data",
        "display": _display,
        "get_ipython": lambda: None,
    }

    code_idxs = [
        i
        for i, c in enumerate(nb.cells)
        if c.cell_type == "code" and i <= LAST_CELL_IDX
    ]
    print(f"Code cells to consider: {len(code_idxs)} (through cell {LAST_CELL_IDX})", flush=True)

    t0 = time.time()
    failed = None
    exec_count = 0

    for n, idx in enumerate(code_idxs, 1):
        cell = nb.cells[idx]
        src = "".join(cell.source) if isinstance(cell.source, list) else cell.source
        preview = src.strip().split("\n")[0][:90] if src.strip() else "(empty)"

        # Decide replacement / skip
        run_src = src
        action = "run"
        if any(m in src for m in ("apt-get", "apt install")):
            action = "skip"
        elif "fine_tune_vision_model" in src:
            action, run_src = "vision-skip", VISION_SKIP
        elif "GridSearchCV" in src and "Hyperparameter Tuning" in src:
            action, run_src = "grid-warm", GRID_WARMSTART
        elif "PyTorch DNN ·" in src or "PyTorch DNN ·" in preview:
            action, run_src = "dnn-skip", DNN_SKIP
        elif src.strip().startswith("# 8.4a") or src.strip().startswith("# 8.4b") or src.strip().startswith("# 8.4c"):
            action, run_src = "dnn-skip", DNN_SKIP

        if action == "skip":
            print(f"[{n}/{len(code_idxs)}] SKIP cell {idx}: {preview}", flush=True)
            cell["outputs"] = [
                new_output(
                    output_type="stream",
                    name="stdout",
                    text="[skipped in annotated-chart refresh]\n",
                )
            ]
            continue

        print(f"[{n}/{len(code_idxs)}] {action} cell {idx}: {preview}", flush=True)
        t1 = time.time()
        buf_out, buf_err = io.StringIO(), io.StringIO()
        exec_count += 1
        cell["execution_count"] = exec_count
        cell["outputs"] = []
        try:
            with redirect_stdout(buf_out), redirect_stderr(buf_err):
                code = "import matplotlib\nmatplotlib.use('Agg')\n" + run_src
                exec(compile(code, f"cell_{idx}", "exec"), g, g)
            out_text = buf_out.getvalue()
            err_text = buf_err.getvalue()
            if out_text:
                cell["outputs"].append(
                    new_output(output_type="stream", name="stdout", text=out_text)
                )
                for line in out_text.strip().splitlines()[-8:]:
                    print(f"    | {line}", flush=True)
            if err_text:
                cell["outputs"].append(
                    new_output(output_type="stream", name="stderr", text=err_text)
                )
            _capture_figures(cell, new_output)
            print(f"  ok ({time.time() - t1:.1f}s)", flush=True)
            if n % 2 == 0:
                nbformat.write(nb, nb_path)
                print("  checkpoint saved", flush=True)
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
            print(f"  FAIL ({time.time() - t1:.1f}s): {type(e).__name__}: {e}", flush=True)
            print(tb[-2500:], flush=True)
            failed = (idx, e)
            nbformat.write(nb, nb_path)
            break

    nbformat.write(nb, nb_path)
    # Sync parts outputs
    try:
        from sync_notebook_parts import sync_main_to_parts

        sync_main_to_parts(ROOT, only=None, sync_source=True)
        print("Parts synced from main.", flush=True)
    except Exception as e:
        print(f"Parts sync skipped: {e}", flush=True)

    mins = (time.time() - t0) / 60
    print(f"\nWrote notebook in {mins:.1f} min", flush=True)
    if failed:
        print("FAILED", flush=True)
        return 1
    print("SUCCESS — annotated charts refreshed", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
