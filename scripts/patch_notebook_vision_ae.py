"""Insert Section 6.2b autoencoder cells and update fusion in capstone notebook."""
from __future__ import annotations

import json
from pathlib import Path

NOTEBOOKS = [
    Path(__file__).resolve().parent.parent / "notebooks" / "capstone_with_results.ipynb",
]

CELL_65_APPEND = '''
    # ── Hybrid V-score demo (ResNet + autoencoder fusion) ─────────────────────
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
    print("  → Fused V_vision feeds Safety Score S alongside NLP + tabular models.")
'''

MARKDOWN_62B = """### 6.2b · Autoencoder Anomaly Sensor (Hybrid Vision Brain)

**Why add an autoencoder?** Our labelled Ontario road-image cache is small. A supervised ResNet18
classifier handles **known** surface classes well, but may miss **unseen** winter hazards.

| Component | Type | Output | Role |
|-----------|------|--------|------|
| **ResNet18** | Supervised classifier | `V_class` | P(Wet) + P(Snow/Ice) from softmax |
| **Conv Autoencoder** | Unsupervised (trained on Clear Asphalt only) | `V_anomaly` | High reconstruction error → unusual surface |
| **Fusion** | Weighted blend | `V_vision` | `α·V_class + (1−α)·V_anomaly` |

**Intuition:** The autoencoder learns what a *normal* clear highway looks like. Wet, icy, or
snow-covered frames reconstruct poorly → higher anomaly score → higher fused hazard signal.

> Default fusion weight: **α = 0.70** (70% classifier, 30% anomaly sensor). Tunable via Lasso in production.
"""

CODE_62B = '''# ── 6.2b  Train autoencoder on Clear Asphalt + fuse with ResNet18 ─────────────

ae_model = None
ae_history = None
anomaly_threshold = None
VISION_FUSION_ALPHA = 0.70

if not TORCH_OK:
    print("PyTorch not available — skip autoencoder branch.")
elif vision_model is None:
    print("Run Section 6.2 first (ResNet18 fine-tuning).")
else:
    import importlib
    import sys
    if "vision_brain" in sys.modules:
        del sys.modules["vision_brain"]
    import vision_brain
    importlib.reload(vision_brain)

    from vision_brain import (
        build_clear_only_dataset,
        train_road_autoencoder,
        plot_autoencoder_training,
        calibrate_anomaly_threshold,
        reconstruction_errors,
        score_frame_hybrid,
        plot_reconstruction_samples,
        save_vision_artifacts,
        DISPLAY_ORDER,
        V_FUSION_ALPHA,
    )

    print("Building Clear Asphalt dataset for autoencoder...")
    ae_train_ds, ae_val_ds = build_clear_only_dataset(
        max_per_class=VISION_TRAIN_PER_CLASS,
        cache_dir=VISION_CACHE,
    )

    print(f"Training autoencoder on {device} for {max(4, VISION_EPOCHS - 2)} epochs...")
    ae_model, ae_history = train_road_autoencoder(
        ae_train_ds, ae_val_ds,
        epochs=max(4, VISION_EPOCHS - 2),
        device=device,
    )
    plot_autoencoder_training(ae_history)
    plot_reconstruction_samples(ae_model, ae_val_ds, n=3, device=device)

    anomaly_threshold = calibrate_anomaly_threshold(ae_model, ae_val_ds, device=device)
    print(f"Anomaly threshold (95th pct clear-road MSE): {anomaly_threshold:.6f}")

    # Compare reconstruction error by surface class on validation split
    print("\\nReconstruction error by class (higher = more anomalous):")
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

    # Save all vision artifacts for deployment
    _models_dir = DATA.parent / "models" if "DATA" in dir() else Path("models")
    save_vision_artifacts(
        vision_model, ae_model, anomaly_threshold,
        models_dir=_models_dir,
        alpha=VISION_FUSION_ALPHA,
    )
    print(f"\\nHybrid Vision Brain ready. Fusion: V_vision = {VISION_FUSION_ALPHA:.0%}·V_class + {1-VISION_FUSION_ALPHA:.0%}·V_anomaly")
'''

MARKDOWN_62B_FINDINGS = """**Findings & importance:** The hybrid Vision Brain combines **supervised** class probabilities
with an **unsupervised** anomaly signal. This is especially valuable when labelled winter-road images
are scarce: the autoencoder flags out-of-distribution surfaces even when the classifier is uncertain.

**What to check in the output:**
- Autoencoder training MSE should decrease over epochs
- Clear Asphalt frames should reconstruct with lower error than Wet/Snow samples
- Fused `V_vision` should rank Snow/Ice > Wet > Clear on held-out frames
- Artifacts saved: `models/vision_resnet18.pt`, `models/vision_autoencoder.pt`, `models/vision_meta.json`
"""

SECTION10_MD_UPDATE = """### 10.2 · Safety Score Fusion (T + V + E → S)

$$S = (w_T \\cdot T + w_V \\cdot V + w_E \\cdot E_{index}) \\times 100$$

The **Vision** term now uses the **hybrid** score from Section 6.2b when models are trained:

$$V_{vision} = \\alpha \\cdot V_{class} + (1 - \\alpha) \\cdot V_{anomaly}$$

| Tier | S range | Recommended speed |
|------|---------|-------------------|
| LOW | 0–30 | 100% of posted limit |
| MEDIUM | 31–70 | 80% |
| HIGH | 71–100 | 60% |
"""

CODE_10_2_NEW = '''# ── 10.2  Safety Score fusion + dashboard ────────────────────────────────────
from safety_score import fuse_scenario, risk_tier, W_T, W_V, W_E

# Scenario priors (fallback when Vision Brain not trained)
V_PRIORS = {
    "TC-1 Clear rush-hour (401 Jul 5pm)": 0.15,
    "TC-2 Blizzard night (Hwy400 Jan 2am)": 0.92,
    "TC-3 Wet dawn bicycle (Hwy7 Apr 6am)": 0.45,
    "TC-4 Clear Sunday (Hwy115 Jun 9am)": 0.10,
    "TC-5 Ice storm rush (QEW Feb 5pm)": 0.88,
}

# Map scenarios to representative vision-cache surface classes for hybrid scoring
SCENARIO_SURFACE = {
    "TC-1 Clear rush-hour (401 Jul 5pm)": "Clear Asphalt",
    "TC-2 Blizzard night (Hwy400 Jan 2am)": "Snow / Ice",
    "TC-3 Wet dawn bicycle (Hwy7 Apr 6am)": "Wet / Slush",
    "TC-4 Clear Sunday (Hwy115 Jun 9am)": "Clear Asphalt",
    "TC-5 Ice storm rush (QEW Feb 5pm)": "Snow / Ice",
}

def _hybrid_v_for_surface(surface_class: str) -> float | None:
    """Score one frame of the given surface class with hybrid Vision Brain."""
    if not all(k in dir() for k in ("vision_model", "ae_model", "anomaly_threshold", "val_ds", "vision_class_names")):
        return None
    if vision_model is None or ae_model is None or anomaly_threshold is None:
        return None
    idxs = [i for i, (_, y) in enumerate(val_ds) if vision_class_names[y] == surface_class]
    if not idxs:
        return None
    import torch
    from vision_brain import score_frame_hybrid, V_FUSION_ALPHA
    dev = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    x_i, _ = val_ds[idxs[0]]
    return score_frame_hybrid(
        vision_model, ae_model, x_i, vision_class_names,
        anomaly_threshold=anomaly_threshold,
        alpha=V_FUSION_ALPHA,
        device=dev,
    )["V_vision"]

if "vision_val_acc" in dir() and vision_val_acc is not None:
    print(f"Vision Brain trained (val acc {vision_val_acc:.1%}) — using hybrid V when available.")

if "TC" not in globals():
    from nlp_brain import SCENARIO_ALERTS
    TC = {k: [17, 7, 3, 0, 1, 0, 0, 1] for k in SCENARIO_ALERTS}
if "nlp_rows" not in globals():
    from nlp_brain import fit_tfidf, score_all_scenarios
    nlp_rows = score_all_scenarios(fit_tfidf())

fusion_rows = []
for (scenario, feat), (_, _, t_sc) in zip(TC.items(), nlp_rows):
    occ_hour, month_num, season_num, is_night, is_rush, ped, bike, auto = feat
    surface = SCENARIO_SURFACE.get(scenario, "Clear Asphalt")
    v_hybrid = _hybrid_v_for_surface(surface)
    v = v_hybrid if v_hybrid is not None else V_PRIORS.get(scenario, 0.3)
    winter = season_num == 1 and month_num in (1, 2, 12)
    row = fuse_scenario(t_sc, v, month_num, season_num, is_night, is_winter_storm=winter)
    row["Scenario"] = scenario
    row["surface_proxy"] = surface
    row["V_source"] = "hybrid" if v_hybrid is not None else "prior"
    fusion_rows.append(row)

df_fusion = pd.DataFrame(fusion_rows)
cols = ["Scenario", "T_nlp", "V_vision", "E_index", "S", "tier", "V_rec_kmh", "V_source"]
print("\\n=== Safety Score Fusion (Sprint 3) ===")
print(df_fusion[cols].to_string(index=False))

# ── Dashboard prototype ─────────────────────────────────────────────────────
fig, axes = plt.subplots(2, 1, figsize=(12, 8), gridspec_kw={"height_ratios": [1.2, 1]})

x = np.arange(len(df_fusion))
w = 0.6
t_contrib = df_fusion["T_nlp"] * W_T * 100
v_contrib = df_fusion["V_vision"] * W_V * 100
e_contrib = df_fusion["E_index"] * W_E * 100

axes[0].bar(x, t_contrib, w, label="NLP (T)", color="#A23B72")
axes[0].bar(x, v_contrib, w, bottom=t_contrib, label="Vision (V)", color="#2E86AB")
axes[0].bar(x, e_contrib, w, bottom=t_contrib + v_contrib, label="Environment (E)", color="#F18F01")
axes[0].set_xticks(x)
axes[0].set_xticklabels([s[:28] + "..." if len(s) > 28 else s for s in df_fusion["Scenario"]], rotation=25, ha="right")
axes[0].set_ylabel("Safety Score contribution")
axes[0].set_title("Smart-Shield — Fused Safety Score by Ontario Highway Scenario", fontweight="bold")
axes[0].legend(loc="upper left")
axes[0].set_ylim(0, 110)

for i, s in enumerate(df_fusion["S"]):
    tier, colour, _ = risk_tier(s)
    axes[1].barh(i, s, color=colour, edgecolor="white", height=0.6)
    axes[1].text(s + 1, i, f"S={s:.1f} ({tier})", va="center", fontsize=9)

axes[1].set_yticks(range(len(df_fusion)))
axes[1].set_yticklabels(df_fusion["Scenario"].str[:35])
axes[1].set_xlabel("Safety Score S")
axes[1].set_xlim(0, 105)
axes[1].invert_yaxis()
axes[1].set_title("Risk tier per scenario", fontweight="bold")
plt.tight_layout()
plt.show()
'''


def patch_notebook(notebook_path: Path) -> None:
    if not notebook_path.is_file():
        print(f"Skip missing {notebook_path}")
        return
    nb = json.loads(notebook_path.read_text(encoding="utf-8"))
    cells = nb["cells"]

    # Update Section 10 intro to mention hybrid vision
    for c in cells:
        src = "".join(c.get("source", []))
        if "ResNet18 (Section 6)" in src and "2 Vision Brain" in src:
            c["source"] = [
                line.replace(
                    "| **2 Vision Brain** | ResNet18 (Section 6) | `V` score (snow/ice probability) |",
                    "| **2 Vision Brain** | ResNet18 + Autoencoder (Section 6.2b) | `V` hybrid hazard score |",
                )
                for line in c["source"]
            ]

    # Find cell indices dynamically
    idx_65 = next(i for i, c in enumerate(cells) if "fine_tune_vision_model" in "".join(c.get("source", [])))
    idx_10_md = next(i for i, c in enumerate(cells) if "10.2" in "".join(c.get("source", [])) and c["cell_type"] == "markdown")
    idx_10_code = next(i for i, c in enumerate(cells) if "10.2  Safety Score fusion" in "".join(c.get("source", [])))

    # Append hybrid note to 6.2 cell if not already present
    src65 = "".join(cells[idx_65]["source"])
    if "score_frame_hybrid" not in src65:
        # Replace old v_score block
        old_block = '''    ice_idx = vision_class_names.index("Snow / Ice")
    v_score = float(probs[ice_idx])
    print(f"Example V-score (P(Snow/Ice)) on one frame: {v_score:.3f}")
    print("  → This probability feeds the Safety Score S alongside NLP + tabular models.")'''
        if old_block in src65:
            src65 = src65.replace(old_block, CELL_65_APPEND.strip())
        else:
            src65 = src65.rstrip() + "\n" + CELL_65_APPEND
        cells[idx_65]["source"] = [src65]

    # Insert 6.2b cells after 6.2 code cell (if not already present)
    if not any("6.2b" in "".join(c.get("source", [])) for c in cells):
        insert_at = idx_65 + 1
        new_cells = [
            {"cell_type": "markdown", "metadata": {}, "source": [MARKDOWN_62B], "id": "vision_ae_md"},
            {"cell_type": "code", "metadata": {}, "source": [CODE_62B], "outputs": [], "execution_count": None, "id": "vision_ae_code"},
            {"cell_type": "markdown", "metadata": {}, "source": [MARKDOWN_62B_FINDINGS], "id": "vision_ae_findings"},
        ]
        for j, nc in enumerate(new_cells):
            cells.insert(insert_at + j, nc)

    cells[idx_10_md]["source"] = [SECTION10_MD_UPDATE]
    cells[idx_10_code]["source"] = [CODE_10_2_NEW]

    notebook_path.write_text(json.dumps(nb, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"Patched {notebook_path}")


if __name__ == "__main__":
    for nb_path in NOTEBOOKS:
        patch_notebook(nb_path)
