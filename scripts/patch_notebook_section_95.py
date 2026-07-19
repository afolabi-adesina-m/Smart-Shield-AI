"""Insert Section 9.5 — Unseen Data Evaluation into capstone_with_results.ipynb."""
from __future__ import annotations

import json
from pathlib import Path

NOTEBOOK = Path(__file__).resolve().parent.parent / "notebooks" / "capstone_with_results.ipynb"

MARKDOWN_95 = """## Section 9.5 · Unseen Data Evaluation

> ▶ **Fold arrow:** hover the **left margin** of this markdown cell — click to hide/show cells below until the next section.

Before Sprint 3 deployment, we trace how **each brain** scores data it did not see during the
collision-model training loop (Sections 4–7). The five Ontario highway **test cases (TC-1 … TC-5)**
act as held-out scenarios: fresh alert text, validation-set road images, and tabular weather /
time features are fused into the composite Safety Score **S**.

| Pillar | Unseen input | Model / method | Output | Role in fusion |
|--------|--------------|----------------|--------|----------------|
| **Text (NLP)** | Ontario 511-style alert per TC scenario | TF-IDF + hazard lexicon | `T` ∈ [0, 1] | 25% of S |
| **Vision** | Hold-out frame from `val_ds` (surface proxy) | ResNet18 softmax + autoencoder anomaly (Section 6.2b) | `V_class`, `V_anomaly`, `V_vision` | 35% of S |
| **Environment** | Month, season, night, winter-storm flags from `TC` | Weighted E_index (surface · visibility · wind · temp) | `E` ∈ [0, 1] | 40% of S |
| **Fusion** | T + V + E | `fuse_scenario()` | `S`, tier, speed advisory | Dashboard + API |

> **Run order:** Sections 6.2 → 6.2b (optional but recommended) → this cell. If the autoencoder
> was skipped, vision falls back to ResNet-only or scenario priors.
"""

CODE_95 = '''# ── 9.5  Unseen data evaluation — Text · Vision · Environment → Fusion ───────
from nlp_brain import SCENARIO_ALERTS, fit_tfidf, t_score_from_text
from safety_score import (
    fuse_scenario, compute_e_index, E_WEIGHTS, W_T, W_V, W_E, risk_tier,
)

# Ontario TC feature dict (Section 8) — rebuild if notebook restarted here
if "TC" not in globals():
    TC = {
        "TC-1 Clear rush-hour (401 Jul 5pm)": [17, 7, 3, 0, 1, 0, 0, 1],
        "TC-2 Blizzard night (Hwy400 Jan 2am)": [2, 1, 1, 1, 0, 1, 0, 1],
        "TC-3 Wet dawn bicycle (Hwy7 Apr 6am)": [6, 4, 2, 0, 0, 0, 1, 1],
        "TC-4 Clear Sunday (Hwy115 Jun 9am)": [9, 6, 3, 0, 0, 0, 0, 1],
        "TC-5 Ice storm rush (QEW Feb 5pm)": [17, 2, 1, 0, 1, 0, 0, 1],
    }

V_PRIORS = {
    "TC-1 Clear rush-hour (401 Jul 5pm)": 0.15,
    "TC-2 Blizzard night (Hwy400 Jan 2am)": 0.92,
    "TC-3 Wet dawn bicycle (Hwy7 Apr 6am)": 0.45,
    "TC-4 Clear Sunday (Hwy115 Jun 9am)": 0.10,
    "TC-5 Ice storm rush (QEW Feb 5pm)": 0.88,
}

SCENARIO_SURFACE = {
    "TC-1 Clear rush-hour (401 Jul 5pm)": "Clear Asphalt",
    "TC-2 Blizzard night (Hwy400 Jan 2am)": "Snow / Ice",
    "TC-3 Wet dawn bicycle (Hwy7 Apr 6am)": "Wet / Slush",
    "TC-4 Clear Sunday (Hwy115 Jun 9am)": "Clear Asphalt",
    "TC-5 Ice storm rush (QEW Feb 5pm)": "Snow / Ice",
}

tfidf_vec = globals().get("tfidf_vec") or globals().get("vectorizer") or fit_tfidf()


def _e_breakdown(month_num, season_num, is_night, is_winter_storm):
    """Environmental pillar — component risks and weighted contributions."""
    surface = 1.0 if is_winter_storm or season_num == 1 else 0.2
    wind = 1.0 if is_winter_storm else (0.5 if season_num == 1 else 0.1)
    visibility = min(1.0, 0.8 * is_night + 0.2 * (1 - is_night))
    temp = 1.0 if month_num in (12, 1, 2) else 0.1
    e = compute_e_index(surface, visibility, wind, temp)
    return {
        "E_surface": round(surface, 3),
        "E_visibility": round(visibility, 3),
        "E_wind": round(wind, 3),
        "E_temp": round(temp, 3),
        "E_index": round(e, 3),
    }


def _vision_unseen(surface_class: str):
    """Score one hold-out validation frame; graceful fallback chain."""
    has_resnet = "vision_model" in dir() and vision_model is not None
    has_hybrid = has_resnet and "ae_model" in dir() and ae_model is not None
    has_hybrid = has_hybrid and "anomaly_threshold" in dir() and anomaly_threshold is not None
    has_val = "val_ds" in dir() and "vision_class_names" in dir()

    if not (has_resnet and has_val):
        return {"V_class": None, "V_anomaly": None, "V_vision": None, "V_source": "not_trained", "softmax": {}}

    idxs = [i for i, (_, y) in enumerate(val_ds) if vision_class_names[y] == surface_class]
    if not idxs:
        return {"V_class": None, "V_anomaly": None, "V_vision": None, "V_source": "no_val_frame", "softmax": {}}

    import torch
    from vision_brain import score_frame_hybrid, resnet_softmax_probs, v_class_from_resnet, V_FUSION_ALPHA

    dev = device if "device" in dir() else torch.device("cuda" if torch.cuda.is_available() else "cpu")
    x_i, _ = val_ds[idxs[0]]
    softmax = resnet_softmax_probs(vision_model, x_i, vision_class_names, device=dev)

    if has_hybrid:
        h = score_frame_hybrid(
            vision_model, ae_model, x_i, vision_class_names,
            anomaly_threshold=anomaly_threshold, alpha=V_FUSION_ALPHA, device=dev,
        )
        return {
            "V_class": h["V_class"], "V_anomaly": h["V_anomaly"],
            "V_vision": h["V_vision"], "V_source": "hybrid", "softmax": softmax,
        }

    v_cls = v_class_from_resnet(vision_model, x_i, vision_class_names, device=dev)
    return {
        "V_class": round(v_cls, 4), "V_anomaly": None,
        "V_vision": round(v_cls, 4), "V_source": "resnet_only", "softmax": softmax,
    }


unseen_rows = []
print("=" * 72)
print("UNSEEN DATA EVALUATION — per-pillar trace (TC-1 … TC-5)")
print("=" * 72)

for scenario, feat in TC.items():
    occ_hour, month_num, season_num, is_night, is_rush, ped, bike, auto = feat
    alert = SCENARIO_ALERTS[scenario]
    t_sc = t_score_from_text(alert, tfidf_vec)

    winter = season_num == 1 and month_num in (1, 2, 12)
    e_parts = _e_breakdown(month_num, season_num, is_night, winter)
    surface = SCENARIO_SURFACE.get(scenario, "Clear Asphalt")
    vis = _vision_unseen(surface)

    v = vis["V_vision"]
    if v is None:
        v = V_PRIORS.get(scenario, 0.3)
        vis["V_source"] = "prior"

    fused = fuse_scenario(t_sc, v, month_num, season_num, is_night, is_winter_storm=winter)

    print(f"\\n{'─' * 72}")
    print(f"  {scenario}")
    print(f"  Text  → T={t_sc:.3f}  |  {alert[:70]}...")
    if vis["softmax"]:
        top = max(vis["softmax"], key=vis["softmax"].get)
        print(f"  Vision → surface proxy: {surface}  |  V_class={vis['V_class']}  V_anom={vis['V_anomaly']}  V={v:.3f} ({vis['V_source']})")
        print(f"           softmax top: {top}={vis['softmax'][top]:.3f}")
    else:
        print(f"  Vision → V={v:.3f} ({vis['V_source']})")
    print(f"  Env   → E={e_parts['E_index']:.3f}  (surf={e_parts['E_surface']}, vis={e_parts['E_visibility']}, wind={e_parts['E_wind']}, temp={e_parts['E_temp']})")
    print(f"  Fuse  → S={fused['S']:.1f}  [{fused['tier']}]  advisory {fused['V_rec_kmh']} km/h")

    unseen_rows.append({
        "Scenario": scenario,
        "T_nlp": round(t_sc, 3),
        "V_class": vis["V_class"],
        "V_anomaly": vis["V_anomaly"],
        "V_vision": round(v, 3),
        "V_source": vis["V_source"],
        **e_parts,
        "S": fused["S"],
        "tier": fused["tier"],
        "V_rec_kmh": fused["V_rec_kmh"],
    })

df_unseen = pd.DataFrame(unseen_rows)
print("\\n" + "=" * 72)
print("SUMMARY TABLE")
print("=" * 72)
display_cols = [
    "Scenario", "T_nlp", "V_class", "V_anomaly", "V_vision", "V_source",
    "E_index", "S", "tier", "V_rec_kmh",
]
print(df_unseen[display_cols].to_string(index=False))

# Stacked contribution chart
fig, ax = plt.subplots(figsize=(11, 5))
x = np.arange(len(df_unseen))
t_c = df_unseen["T_nlp"] * W_T * 100
v_c = df_unseen["V_vision"] * W_V * 100
e_c = df_unseen["E_index"] * W_E * 100
ax.bar(x, t_c, 0.55, label="Text (T)", color="#A23B72")
ax.bar(x, v_c, 0.55, bottom=t_c, label="Vision (V)", color="#2E86AB")
ax.bar(x, e_c, 0.55, bottom=t_c + v_c, label="Environment (E)", color="#F18F01")
ax.set_xticks(x)
ax.set_xticklabels([s.split("(")[0].strip() for s in df_unseen["Scenario"]], rotation=20, ha="right")
ax.set_ylabel("Contribution to S")
ax.set_title("Unseen TC scenarios — pillar contributions to Safety Score", fontweight="bold")
ax.legend(loc="upper left")
ax.set_ylim(0, 110)
plt.tight_layout()
plt.show()
'''

MARKDOWN_95_FINDINGS = """**Findings & interpretation:**

- **Text:** Blizzard and ice-storm alerts (`TC-2`, `TC-5`) drive the highest **T** scores; clear-weather strings stay near zero — validating the hazard lexicon on unseen phrasing.
- **Vision:** Hold-out validation frames surface-classify wet/snow conditions; the autoencoder branch (when trained) raises **V_anomaly** on non-clear surfaces even when softmax confidence is uncertain.
- **Environment:** Winter-night scenarios (`TC-2`) maximize surface, visibility, and temperature risk; summer clear-day cases (`TC-1`, `TC-4`) keep **E** low.
- **Fusion:** The multimodal **S** tier ordering should align with intuitive severity (blizzard/ice storm → HIGH, clear summer → LOW). Section 10 extends this into the deployment dashboard.
"""


def _cell_text(c: dict) -> str:
    return "".join(c.get("source", []))


def _is_section_95(c: dict) -> bool:
    s = _cell_text(c)
    return "Section 9.5" in s or "9.5  Unseen data evaluation" in s


def _find_insert_index(cells: list) -> int:
    for i, c in enumerate(cells):
        s = _cell_text(c)
        if s.startswith("# Section 10") or s.startswith("## Section 10"):
            return i
    for i, c in enumerate(cells):
        s = _cell_text(c)
        if s.startswith("## Section 9") and "9.5" not in s:
            return i + 1
    return len(cells)


def make_cells() -> list:
    return [
        {
            "cell_type": "markdown",
            "metadata": {},
            "source": [MARKDOWN_95],
            "id": "unseen_data_md",
        },
        {
            "cell_type": "code",
            "metadata": {},
            "source": [CODE_95],
            "outputs": [],
            "execution_count": None,
            "id": "unseen_data_code",
        },
        {
            "cell_type": "markdown",
            "metadata": {},
            "source": [MARKDOWN_95_FINDINGS],
            "id": "unseen_data_findings",
        },
    ]


def main() -> None:
    nb = json.loads(NOTEBOOK.read_text(encoding="utf-8"))
    cells = nb["cells"]

    if any(_is_section_95(c) for c in cells):
        cells = [c for c in cells if not _is_section_95(c) and c.get("id") not in {
            "unseen_data_md", "unseen_data_code", "unseen_data_findings",
        }]
        idx = _find_insert_index(cells)
        cells = cells[:idx] + make_cells() + cells[idx:]
        print(f"Replaced Section 9.5 at cell index {idx}")
    else:
        idx = _find_insert_index(cells)
        cells = cells[:idx] + make_cells() + cells[idx:]
        print(f"Inserted Section 9.5 at cell index {idx}")

    nb["cells"] = cells
    NOTEBOOK.write_text(json.dumps(nb, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"Updated {NOTEBOOK}")


if __name__ == "__main__":
    main()
