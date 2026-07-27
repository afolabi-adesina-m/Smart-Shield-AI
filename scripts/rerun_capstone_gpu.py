#!/usr/bin/env python3
"""Headless GPU re-run of notebooks/capstone_with_results.ipynb.

Pick the freest A100, skip apt-get cells, checkpoint every 3 code cells.
Designed to be launched under nohup/setsid so SSH disconnect does not kill it.
"""
from __future__ import annotations

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


def pick_gpu() -> str | None:
    """Return CUDA index of freest compute GPU (skip display adapters)."""
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


def main() -> int:
    gpu = pick_gpu()
    if gpu is not None:
        os.environ["CUDA_VISIBLE_DEVICES"] = gpu
    else:
        os.environ.pop("CUDA_VISIBLE_DEVICES", None)
        print("WARNING: no GPU selected; PyTorch will fall back to CPU if needed", flush=True)

    import matplotlib

    matplotlib.use("Agg")
    import nbformat
    from nbformat.v4 import new_output

    nb_path = ROOT / "notebooks" / "capstone_with_results.ipynb"
    print(f"Executing {nb_path}", flush=True)
    print(f"CUDA_VISIBLE_DEVICES={os.environ.get('CUDA_VISIBLE_DEVICES')}", flush=True)

    import torch

    print(
        f"torch={torch.__version__} cuda_available={torch.cuda.is_available()} "
        f"device_count={torch.cuda.device_count()}",
        flush=True,
    )
    if torch.cuda.is_available():
        print(f"Using: {torch.cuda.get_device_name(0)}", flush=True)

    nb = nbformat.read(nb_path, as_version=4)
    g = {"__name__": "__main__", "REPO_ROOT": ROOT, "DATA": ROOT / "Data"}
    code_idxs = [i for i, c in enumerate(nb.cells) if c.cell_type == "code"]
    print(f"Code cells: {len(code_idxs)}", flush=True)

    t0 = time.time()
    failed = None
    exec_count = 0

    for n, idx in enumerate(code_idxs, 1):
        cell = nb.cells[idx]
        src = "".join(cell.source) if isinstance(cell.source, list) else cell.source
        preview = src.strip().split("\n")[0][:90] if src.strip() else "(empty)"
        if "apt-get" in src or "apt install" in src:
            print(f"[{n}/{len(code_idxs)}] SKIP cell {idx}: {preview}", flush=True)
            cell["outputs"] = [
                new_output(
                    output_type="stream",
                    name="stdout",
                    text="[skipped apt-get cell in headless re-run]\n",
                )
            ]
            continue

        print(f"[{n}/{len(code_idxs)}] cell {idx}: {preview}", flush=True)
        t1 = time.time()
        buf_out, buf_err = io.StringIO(), io.StringIO()
        exec_count += 1
        cell["execution_count"] = exec_count
        cell["outputs"] = []
        try:
            with redirect_stdout(buf_out), redirect_stderr(buf_err):
                code = "import matplotlib\nmatplotlib.use('Agg')\n" + src
                exec(compile(code, f"cell_{idx}", "exec"), g, g)
            out_text = buf_out.getvalue()
            err_text = buf_err.getvalue()
            if out_text:
                cell["outputs"].append(
                    new_output(output_type="stream", name="stdout", text=out_text)
                )
                for line in out_text.strip().splitlines()[-12:]:
                    print(f"    | {line}", flush=True)
            if err_text:
                cell["outputs"].append(
                    new_output(output_type="stream", name="stderr", text=err_text)
                )
                for line in err_text.strip().splitlines()[-6:]:
                    print(f"    ! {line}", flush=True)
            try:
                import matplotlib.pyplot as plt
                import base64
                from io import BytesIO

                if plt.get_fignums():
                    for fignum in list(plt.get_fignums()):
                        fig = plt.figure(fignum)
                        bio = BytesIO()
                        fig.savefig(bio, format="png", bbox_inches="tight")
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
            print(f"  ok ({time.time() - t1:.1f}s)", flush=True)
            if n % 3 == 0:
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
            print(tb[-3000:], flush=True)
            failed = (idx, e)
            nbformat.write(nb, nb_path)
            break

    nbformat.write(nb, nb_path)
    print(f"\nWrote notebook in {(time.time() - t0) / 60:.1f} min", flush=True)
    if failed:
        return 1
    print("SUCCESS", flush=True)
    for k in [
        "CANONICAL_TORONTO_CSV",
        "STAGE_A_RECALL",
        "STAGE_A_THRESHOLD",
        "STAGE_A_MODEL_NAME",
        "geo_audit_ok",
    ]:
        if k in g:
            print(f"  {k}={g[k]}", flush=True)
    sa = ROOT / "models" / "fatal_vs_not_stage_a.joblib"
    print(f"  stage_a_artifact_exists={sa.exists()} ({sa})", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
