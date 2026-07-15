#!/usr/bin/env python3
"""
Patch capstone_with_results.ipynb vision section:
  - AE early stopping
  - ResNet-first → ResNet+AE comparison table
  - Auto-select better backend for Safety Score V
  - Wire Section 10.2 fusion to selected backend
  - Note satellite notebooks in Section Navigator
"""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
NB = ROOT / "notebooks" / "capstone_with_results.ipynb"

MARKDOWN_62B = """### 6.2b · Autoencoder Anomaly Sensor (Hybrid Vision Brain)

**Why add an autoencoder?** Our labelled Ontario road-image cache is small. A supervised ResNet18
classifier handles **known** surface classes well, but may miss **unseen** winter hazards.

| Component | Type | Output | Role |
|-----------|------|--------|------|
| **ResNet18** | Supervised classifier | `V_class` | P(Wet) + P(Snow/Ice) from softmax |
| **Conv Autoencoder** | Unsupervised (Clear Asphalt only) | `V_anomaly` | High reconstruction error → unusual surface |
| **Fusion** | Weighted blend | `V_vision` | `α·V_class + (1−α)·V_anomaly` |

Training uses **early stopping** on validation MSE (best checkpoint restored).
After AE training, Section **6.2d** compares ResNet-only vs hybrid and selects the better backend for equation *V*.

> Default fusion weight when hybrid wins: **α = 0.70**.
"""

CODE_62B = r'''# ── 6.2b  Train autoencoder on Clear Asphalt (early stopping) ─────────────────

ae_model = None
ae_history = None
anomaly_threshold = None
VISION_FUSION_ALPHA = 0.70
VISION_AE_PATIENCE = 3

if not TORCH_OK:
    print("PyTorch not available — skip autoencoder branch.")
elif vision_model is None:
    print("Run Section 6.2 first (ResNet18 fine-tuning).")
else:
    import importlib
    import sys
    from pathlib import Path
    if "vision_brain" in sys.modules:
        del sys.modules["vision_brain"]
    import vision_brain
    importlib.reload(vision_brain)

    from vision_brain import (
        build_clear_only_dataset,
        train_road_autoencoder,
        plot_autoencoder_training,
        calibrate_anomaly_threshold,
        score_frame_hybrid,
        plot_reconstruction_samples,
        DISPLAY_ORDER,
    )

    print("Building Clear Asphalt dataset for autoencoder...")
    ae_train_ds, ae_val_ds = build_clear_only_dataset(
        max_per_class=VISION_TRAIN_PER_CLASS,
        cache_dir=VISION_CACHE,
    )

    ae_epochs = max(6, VISION_EPOCHS - 2)
    print(
        f"Training autoencoder on {device} for up to {ae_epochs} epochs "
        f"(patience={VISION_AE_PATIENCE}, early stop on val MSE)..."
    )
    ae_model, ae_history = train_road_autoencoder(
        ae_train_ds, ae_val_ds,
        epochs=ae_epochs,
        patience=VISION_AE_PATIENCE,
        device=device,
    )
    plot_autoencoder_training(ae_history)
    plot_reconstruction_samples(ae_model, ae_val_ds, n=3, device=device)

    anomaly_threshold = calibrate_anomaly_threshold(ae_model, ae_val_ds, device=device)
    print(f"Anomaly threshold (95th pct clear-road MSE): {anomaly_threshold:.6f}")

    print("\nReconstruction error by class (higher = more anomalous):")
    for cls in DISPLAY_ORDER:
        idxs = [i for i, (_, y) in enumerate(val_ds) if vision_class_names[y] == cls]
        if not idxs:
            continue
        errs, hybrid_scores = [], []
        for i in idxs[:20]:
            x_i, _ = val_ds[i]
            h = score_frame_hybrid(
                vision_model, ae_model, x_i, vision_class_names,
                anomaly_threshold=anomaly_threshold,
                alpha=VISION_FUSION_ALPHA,
                device=device,
            )
            errs.append(h["recon_error"])
            if len(hybrid_scores) < 5:
                hybrid_scores.append(h["V_vision"])
        print(f"  {cls:<16}  mean MSE={np.mean(errs):.5f}  mean V_vision={np.mean(hybrid_scores):.3f}")
'''

MARKDOWN_62D = """### 6.2d · ResNet vs ResNet+Autoencoder — Compare & Select for Equation V

We train **ResNet18 first** (Section 6.2), then the **hybrid** ResNet+AE stack (6.2b).
This cell builds a side-by-side metrics table and **automatically selects** the stronger backend
to feed Vision term *V* in:

$$S = (w_T \\cdot T + w_V \\cdot V + w_E \\cdot E_{index}) \\times 100$$

| Backend | V definition |
|---------|--------------|
| **ResNet18** | `V = V_class = P(Wet) + P(Snow/Ice)` |
| **ResNet18 + Autoencoder** | `V = α·V_class + (1−α)·V_anomaly` |

**Selection score** rewards Snow/Ice vs Clear separation (+ Wet vs Clear) and a Snow≥Wet≥Clear ranking bonus.
Ties prefer the simpler ResNet-only model.
"""

CODE_62D = r'''# ── 6.2d  Compare ResNet vs Hybrid + select backend for Safety Score V ────────

vision_comparison_df = None
vision_selection = {
    "selected_backend": "ResNet18",
    "use_hybrid": False,
    "fusion_alpha": 1.0,
    "reason": "Default before comparison.",
}

if not TORCH_OK:
    print("PyTorch not available — skip vision backend comparison.")
elif vision_model is None:
    print("Run Section 6.2 first.")
elif ae_model is None or anomaly_threshold is None:
    print("Autoencoder unavailable — using ResNet18 only for equation V.")
    vision_selection = {
        "selected_backend": "ResNet18",
        "use_hybrid": False,
        "fusion_alpha": 1.0,
        "reason": "AE not trained — ResNet18 only.",
        "anomaly_threshold": None,
    }
else:
    import importlib
    import sys
    from pathlib import Path
    if "vision_brain" in sys.modules:
        del sys.modules["vision_brain"]
    import vision_brain
    importlib.reload(vision_brain)

    from vision_brain import (
        compare_vision_backends,
        select_vision_v_score,
        save_vision_artifacts,
    )

    print("Comparing backends on validation frames (ResNet-first, then hybrid)...")
    vision_comparison_df, vision_selection = compare_vision_backends(
        vision_model,
        ae_model,
        val_ds,
        vision_class_names,
        anomaly_threshold=anomaly_threshold,
        alpha=VISION_FUSION_ALPHA,
        device=device,
    )
    print("\n=== Vision backend comparison ===")
    display(vision_comparison_df)

    print(
        f"\n→ SELECTED for equation V: {vision_selection['selected_backend']}"
        f"\n  reason: {vision_selection['reason']}"
        f"\n  use_hybrid={vision_selection['use_hybrid']}  "
        f"fusion_alpha={vision_selection['fusion_alpha']}"
    )

    # Demo score on one validation frame with the winning backend
    x0, y0 = val_ds[0]
    chosen = select_vision_v_score(
        vision_model, ae_model, x0, vision_class_names,
        anomaly_threshold=anomaly_threshold,
        selection=vision_selection,
        alpha=VISION_FUSION_ALPHA,
        device=device,
    )
    print(f"Example frame ({vision_class_names[int(y0)]}): {chosen}")

    _models_dir = DATA.parent / "models" if "DATA" in dir() else Path("models")
    save_vision_artifacts(
        vision_model, ae_model, anomaly_threshold,
        models_dir=_models_dir,
        alpha=VISION_FUSION_ALPHA,
        selection=vision_selection,
        comparison_records=vision_comparison_df.to_dict(orient="records"),
    )
'''

FINDINGS_62D = """**Findings & importance:** Empirically chooses whether hybrid fusion improves hazard ranking over ResNet alone before locking *V* into Safety Score *S*.

**What to check:** Comparison table has two rows; selected backend printed; `models/vision_meta.json` stores `selected_backend` / `use_hybrid`; CSV at `Data/results/vision/vision_backend_comparison.csv`.
"""

NAV_APPEND = """
---
### Satellite notebooks (lighter Run All)

The master notebook stays complete. Heavy steps are also split under `notebooks/parts/`:

| Part | File | Contents |
|------|------|----------|
| 01 | `notebooks/parts/01_charter_eda_features.ipynb` | Charter → Feature selection |
| 02 | `notebooks/parts/02_vision_brain.ipynb` | Vision Brain (ResNet → AE → compare/select) |
| 03 | `notebooks/parts/03_tabular_ml.ipynb` | Tabular ML + ethics |
| 04 | `notebooks/parts/04_fusion_deploy.ipynb` | Unseen eval + fusion + deploy |

**Auto-update:** after running a part, use its final sync cell (or `python scripts/sync_notebook_parts.py --direction parts-to-main`) to push outputs back into this master notebook. Refresh parts from master with `--direction main-to-parts`.
"""


def _src_list(text: str) -> list:
    lines = text.strip("\n").split("\n")
    if not lines:
        return []
    return [ln + "\n" for ln in lines[:-1]] + [lines[-1]]


def _replace_code_by_marker(nb: dict, marker_substr: str, new_source: str) -> bool:
    for cell in nb["cells"]:
        if cell.get("cell_type") != "code":
            continue
        src = "".join(cell.get("source", []))
        if marker_substr in src[:220]:
            cell["source"] = _src_list(new_source)
            cell["outputs"] = []
            cell["execution_count"] = None
            return True
    return False


def _find_cell_idx_by_marker(nb: dict, marker_substr: str) -> int | None:
    for i, cell in enumerate(nb["cells"]):
        if cell.get("cell_type") != "code":
            continue
        src = "".join(cell.get("source", []))
        if marker_substr in src[:180]:
            return i
    return None


def _find_md_idx(nb: dict, needle: str) -> int | None:
    for i, cell in enumerate(nb["cells"]):
        if cell.get("cell_type") != "markdown":
            continue
        if needle in "".join(cell.get("source", [])):
            return i
    return None


def _insert_after(nb: dict, idx: int, cells: list) -> None:
    for j, cell in enumerate(cells):
        nb["cells"].insert(idx + 1 + j, cell)


def main() -> None:
    nb = json.loads(NB.read_text(encoding="utf-8"))

    # Update 6.2b markdown
    md_ae = _find_md_idx(nb, "6.2b · Autoencoder Anomaly Sensor")
    if md_ae is not None:
        nb["cells"][md_ae]["source"] = _src_list(MARKDOWN_62B)

    # Replace AE training code
    ok_ae = _replace_code_by_marker(nb, "6.2b  Train autoencoder", CODE_62B)
    print(f"Patched AE training cell: {ok_ae}")

    # Insert 6.2d if missing
    if _find_cell_idx_by_marker(nb, "6.2d  Compare ResNet") is None:
        anchor = _find_cell_idx_by_marker(nb, "6.2b  Train autoencoder")
        if anchor is None:
            raise SystemExit("Could not find 6.2b code cell to insert after")
        # Prefer insert after AE findings markdown (next markdown after code)
        insert_at = anchor
        # skip following findings markdown if present
        if insert_at + 1 < len(nb["cells"]) and nb["cells"][insert_at + 1].get("cell_type") == "markdown":
            insert_at = insert_at + 1
        new_cells = [
            {
                "cell_type": "markdown",
                "id": "vision_compare_md",
                "metadata": {},
                "source": _src_list(MARKDOWN_62D),
            },
            {
                "cell_type": "code",
                "execution_count": None,
                "id": "vision_compare_code",
                "metadata": {},
                "outputs": [],
                "source": _src_list(CODE_62D),
            },
            {
                "cell_type": "markdown",
                "id": "vision_compare_findings",
                "metadata": {},
                "source": _src_list(FINDINGS_62D),
            },
        ]
        _insert_after(nb, insert_at, new_cells)
        print(f"Inserted 6.2d comparison cells after index {insert_at}")
    else:
        _replace_code_by_marker(nb, "6.2d  Compare ResNet", CODE_62D)
        print("Updated existing 6.2d cell")

    # Navigator append
    nav_idx = _find_md_idx(nb, "SECTION NAVIGATOR")
    if nav_idx is not None:
        src = "".join(nb["cells"][nav_idx].get("source", []))
        if "Satellite notebooks" not in src:
            nb["cells"][nav_idx]["source"] = _src_list(src.rstrip() + "\n" + NAV_APPEND)
            print("Appended satellite notebook note to SECTION NAVIGATOR")

    # Section 10.2 markdown — mention selected backend
    md_fusion = _find_md_idx(nb, "10.2 · Safety Score Fusion")
    if md_fusion is not None:
        nb["cells"][md_fusion]["source"] = _src_list(
            """### 10.2 · Safety Score Fusion (T + V + E → S)

$$S = (w_T \\cdot T + w_V \\cdot V + w_E \\cdot E_{index}) \\times 100$$

The **Vision** term *V* uses the backend **selected in Section 6.2d**
(ResNet18 alone, or ResNet18 + autoencoder hybrid):

$$V_{vision} =
\\begin{cases}
V_{class} & \\text{if ResNet selected}\\\\
\\alpha \\cdot V_{class} + (1-\\alpha)\\cdot V_{anomaly} & \\text{if hybrid selected}
\\end{cases}$$

| Tier | S range | Recommended speed |
|------|---------|-------------------|
| LOW | 0–30 | 100% of posted limit |
| MEDIUM | 31–70 | 80% |
| HIGH | 71–100 | 60% |
"""
        )

    # Patch fusion code cell to use selected backend
    fuse_idx = _find_cell_idx_by_marker(nb, "10.2  Safety Score fusion")
    if fuse_idx is not None:
        old = "".join(nb["cells"][fuse_idx].get("source", []))
        # Replace helper + V assignment block
        new_helper = '''def _selected_v_for_surface(surface_class: str) -> float | None:
    """Score one frame using the vision backend selected in Section 6.2d."""
    needed = ("vision_model", "val_ds", "vision_class_names", "vision_selection")
    if not all(k in dir() for k in needed):
        return None
    if vision_model is None:
        return None
    idxs = [i for i, (_, y) in enumerate(val_ds) if vision_class_names[y] == surface_class]
    if not idxs:
        return None
    import torch
    from vision_brain import select_vision_v_score
    dev = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    x_i, _ = val_ds[idxs[0]]
    thr = anomaly_threshold if "anomaly_threshold" in dir() else None
    ae = ae_model if "ae_model" in dir() else None
    alpha = VISION_FUSION_ALPHA if "VISION_FUSION_ALPHA" in dir() else 0.70
    out = select_vision_v_score(
        vision_model, ae, x_i, vision_class_names,
        anomaly_threshold=thr if thr is not None else 0.01,
        selection=vision_selection,
        alpha=alpha,
        device=dev,
    )
    return out["V_vision"]
'''
        if "_hybrid_v_for_surface" in old:
            old = old.replace(
                old[old.index("def _hybrid_v_for_surface"): old.index("if \"vision_val_acc\"")],
                new_helper + "\n",
            )
            old = old.replace("v_hybrid = _hybrid_v_for_surface(surface)", "v_hybrid = _selected_v_for_surface(surface)")
            old = old.replace(
                'row["V_source"] = "hybrid" if v_hybrid is not None else "prior"',
                'row["V_source"] = (vision_selection.get("selected_backend", "selected") if v_hybrid is not None and "vision_selection" in dir() else ("selected" if v_hybrid is not None else "prior"))',
            )
            old = old.replace(
                'print(f"Vision Brain trained (val acc {vision_val_acc:.1%}) — using hybrid V when available.")',
                'backend = vision_selection.get("selected_backend", "ResNet18") if "vision_selection" in dir() else "ResNet18"\n'
                '    print(f"Vision Brain trained (val acc {vision_val_acc:.1%}) — equation V uses: {backend}")',
            )
            nb["cells"][fuse_idx]["source"] = _src_list(old)
            nb["cells"][fuse_idx]["outputs"] = []
            nb["cells"][fuse_idx]["execution_count"] = None
            print("Patched Section 10.2 fusion to use selected vision backend")
        else:
            print("Fusion helper already patched or structure unexpected — manual check advised")

    # Soften ResNet cell hybrid demo (still optional after 6.2d)
    resnet_idx = _find_cell_idx_by_marker(nb, "6.2  Fine-tune ResNet18")
    if resnet_idx is not None:
        src = "".join(nb["cells"][resnet_idx].get("source", []))
        if "Hybrid V-score demo" in src:
            src = src.replace(
                """# ── Hybrid V-score demo (ResNet + autoencoder fusion) ─────────────────────
    # Trained in Section 6.2b below; variables may not exist until that cell runs.
    if "ae_model" in dir() and ae_model is not None and "anomaly_threshold" in dir():
        from vision_brain import score_frame_hybrid
        hybrid = score_frame_hybrid(
            vision_model, ae_model, x0, vision_class_names,
            anomaly_threshold=anomaly_threshold, device=device,
        )
        v_score = hybrid["V_vision"]
        print(f"Hybrid V-score on one frame: {hybrid}")
    else:
        ice_idx = vision_class_names.index("Snow / Ice")
        v_score = float(probs[ice_idx])
        print(f"Example V-score (P(Snow/Ice)) on one frame: {v_score:.3f}")
    print("  → Fused V_vision feeds Safety Score S alongside NLP + tabular models.")""",
                """# ResNet-only V preview (hybrid comparison/selection runs in 6.2d after AE training)
    from vision_brain import v_class_from_resnet, HAZARD_CLASSES
    v_score = float(v_class_from_resnet(vision_model, x0, vision_class_names, device=device))
    print(f"ResNet V_class (hazard P) on one frame: {v_score:.3f}  true={vision_class_names[int(y0)]}")
    print("  → Next: train AE (6.2b), then compare/select backend for equation V (6.2d).")""",
            )
            nb["cells"][resnet_idx]["source"] = _src_list(src)
            print("Updated ResNet cell to ResNet-first preview")

    NB.write_text(json.dumps(nb, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"Wrote {NB}")


if __name__ == "__main__":
    main()
