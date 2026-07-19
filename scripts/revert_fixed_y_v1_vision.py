"""Revert hybrid vision patches from capstone_with_results_fixed_Y_V1.ipynb only."""
from __future__ import annotations

import json
from pathlib import Path

NOTEBOOK = Path(__file__).resolve().parent.parent / "notebooks" / "capstone_with_results_fixed_Y_V1.ipynb"

SECTION10_MD_ORIG = """### 10.2 · Safety Score Fusion (T + V + E → S)

$$S = (w_T \\cdot T + w_V \\cdot V + w_E \\cdot E_{index}) \\times 100$$

| Tier | S range | Recommended speed |
|------|---------|-------------------|
| LOW | 0–30 | 100% of posted limit |
| MEDIUM | 31–70 | 80% |
| HIGH | 71–100 | 60% |
"""

CODE_10_2_ORIG = '''# ── 10.2  Safety Score fusion + dashboard ────────────────────────────────────
from safety_score import fuse_scenario, risk_tier, W_T, W_V, W_E

# Initialize vision scores. If the Vision Brain model is trained, use those results;
# otherwise, fallback to predefined scenario priors.
V_PRIORS = {
    "TC-1 Clear rush-hour (401 Jul 5pm)": 0.15,
    "TC-2 Blizzard night (Hwy400 Jan 2am)": 0.92,
    "TC-3 Wet dawn bicycle (Hwy7 Apr 6am)": 0.45,
    "TC-4 Clear Sunday (Hwy115 Jun 9am)": 0.10,
    "TC-5 Ice storm rush (QEW Feb 5pm)": 0.88,
}
if "vision_val_acc" in dir() and vision_val_acc is not None:
    print(f"Vision Brain trained (val acc {vision_val_acc:.1%}) — using scenario V priors.")

# Ensure required objects exist in memory.
if "TC" not in globals():
    from nlp_brain import SCENARIO_ALERTS
    TC = {k: [17,7,3,0,1,0,0,1] for k in SCENARIO_ALERTS}
if "nlp_rows" not in globals():
    from nlp_brain import fit_tfidf, score_all_scenarios
    nlp_rows = score_all_scenarios(fit_tfidf())

# Calculate fusion metrics for every scenario using the fused model parameters.
fusion_rows = []
for (scenario, feat), (_, _, t_sc) in zip(TC.items(), nlp_rows):
    occ_hour, month_num, season_num, is_night, is_rush, ped, bike, auto = feat
    v = V_PRIORS.get(scenario, 0.3)
    winter = season_num == 1 and month_num in (1, 2, 12)
    # The fuse_scenario function merges the inputs into a dictionary containing S and tier.
    row = fuse_scenario(t_sc, v, month_num, season_num, is_night, is_winter_storm=winter)
    row["Scenario"] = scenario
    fusion_rows.append(row)

# Output the unified safety score results.
df_fusion = pd.DataFrame(fusion_rows)
cols = ["Scenario", "T_nlp", "V_vision", "E_index", "S", "tier", "V_rec_kmh"]
print("\\n=== Safety Score Fusion (Sprint 3) ===")
print(df_fusion[cols].to_string(index=False))

# ── Dashboard prototype ─────────────────────────────────────────────────────
# Build a visual dashboard to assist interpretation of the fused scores.
fig, axes = plt.subplots(2, 1, figsize=(12, 8), gridspec_kw={"height_ratios": [1.2, 1]})

# Panel 1: Stacked bar chart showing the composition of the total Safety Score (S).
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

HYBRID_BLOCK = '''    # ── Hybrid V-score demo (ResNet + autoencoder fusion) ─────────────────────
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
    print("  → Fused V_vision feeds Safety Score S alongside NLP + tabular models.")'''

OLD_BLOCK = '''    ice_idx = vision_class_names.index("Snow / Ice")
    v_score = float(probs[ice_idx])
    print(f"Example V-score (P(Snow/Ice)) on one frame: {v_score:.3f}")
    print("  → This probability feeds the Safety Score S alongside NLP + tabular models.")'''


def revert() -> None:
    nb = json.loads(NOTEBOOK.read_text(encoding="utf-8"))
    cells = nb["cells"]

    # Remove 6.2b cells
    cells = [
        c for c in cells
        if "6.2b" not in "".join(c.get("source", []))
        and c.get("id") not in {"vision_ae_md", "vision_ae_code", "vision_ae_findings"}
        and "Autoencoder Anomaly Sensor" not in "".join(c.get("source", []))
        and "vision_autoencoder.pt" not in "".join(c.get("source", []))
    ]

    for c in cells:
        src = "".join(c.get("source", []))

        if "ResNet18 + Autoencoder" in src:
            c["source"] = [
                line.replace(
                    "| **2 Vision Brain** | ResNet18 + Autoencoder (Section 6.2b) | `V` hybrid hazard score |",
                    "| **2 Vision Brain** | ResNet18 (Section 6) | `V` score (snow/ice probability) |",
                )
                for line in c["source"]
            ]

        if "fine_tune_vision_model" in src and HYBRID_BLOCK in src:
            c["source"] = [src.replace(HYBRID_BLOCK, OLD_BLOCK)]

        if "10.2" in src and "hybrid" in src.lower() and c["cell_type"] == "markdown":
            c["source"] = [SECTION10_MD_ORIG]

        if "10.2  Safety Score fusion" in src and "_hybrid_v_for_surface" in src:
            c["source"] = [CODE_10_2_ORIG]

    nb["cells"] = cells
    NOTEBOOK.write_text(json.dumps(nb, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"Reverted {NOTEBOOK}")


if __name__ == "__main__":
    revert()
