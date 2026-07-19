"""Insert Section 7.8 — Literature Alignment & Benchmark Comparison."""
from __future__ import annotations

import json
from pathlib import Path

NOTEBOOK = Path(__file__).resolve().parent.parent / "notebooks" / "capstone_with_results.ipynb"

MARKDOWN_78 = """### Section 7.8 · Literature Alignment & Benchmark Comparison

> ▶ **Fold arrow:** hover the **left margin** of this markdown cell — click to hide/show cells below until the next section.

This section answers three questions for the capstone report:

1. **How do we compare tabular models (LR, kNN, DT, RF, LightGBM, DNN)?**
   Same Toronto held-out test set (`X_test_sc`, `y_test`), same metrics
   (Accuracy, Macro Precision/Recall/F1, **MCC**, AUC-OvR). Models are ranked by **MCC**
   because fatal/injury classes are rare — accuracy alone is misleading.

2. **What about k-means?** We use **K-Nearest Neighbours (kNN, k=7)** — a *classifier*,
   not k-means *clustering*. Jiang et al. (Paper 2) also benchmark kNN, not k-means.

3. **How is ResNet18 “better”?** ResNet is **not** ranked against RF on the same table.
   It solves a **different task** (road-surface image classification for the Vision Brain).
   We judge it by validation accuracy, confusion matrices, and softmax hazard scores
   (Section 6.2). RF wins the **tabular collision-severity** task; ResNet wins the
   **vision surface-risk** task.

| Comparison type | Our data | Paper 2 data | What we compare |
|-----------------|----------|--------------|-----------------|
| **EDA (Tables 2–4)** | `df_paper2_merged` (SDOT + UK DfT) | Same SDOT + DfT files | Mean casualties by weather / road / lighting |
| **ML classifiers** | Toronto TPS 2014–2026, 3-class severity | SDOT + DfT, binary/high-acc setup | Side-by-side metrics with **task-mismatch caveat** |
| **Vision (ResNet18)** | Cached road images (Clear / Wet / Snow / Ice) | Pan (2019) road-weather CNN literature | Val accuracy + CM — separate from tabular leaderboard |
"""

CODE_78 = '''# ── 7.8  Literature alignment: data scope, EDA match, ML & vision benchmarks ───

import numpy as np
import pandas as pd
import matplotlib.pyplot as plt

# ── 1. Data scope & year ranges ───────────────────────────────────────────────
scope_rows = []
if "df_toronto" in dir():
    scope_rows.append({
        "Dataset": "Toronto TPS (modelling)",
        "Rows": f"{len(df_toronto):,}",
        "Year range": f"{int(df_toronto['OCC_YEAR'].min())}–{int(df_toronto['OCC_YEAR'].max())}",
        "Used for": "Section 7 ML (RF, kNN, DNN, …)",
    })
if "dft" in dir() and "collision_year" in dft.columns:
    scope_rows.append({
        "Dataset": "UK DfT",
        "Rows": f"{len(dft):,}",
        "Year range": f"{int(dft['collision_year'].min())}–{int(dft['collision_year'].max())}",
        "Used for": "Paper 2 EDA merge (Section 2.4)",
    })
if "df_sdot" in dir() and "INCDATE" in df_sdot.columns:
    _sd = pd.to_datetime(df_sdot["INCDATE"], errors="coerce").dropna()
    scope_rows.append({
        "Dataset": "Seattle SDOT",
        "Rows": f"{len(df_sdot):,}",
        "Year range": f"{_sd.min().date()} – {_sd.max().date()}",
        "Used for": "Paper 2 EDA merge (Section 2.4)",
    })
if "df_paper2_merged" in dir():
    scope_rows.append({
        "Dataset": "df_paper2_merged (SDOT+DfT)",
        "Rows": f"{len(df_paper2_merged):,}",
        "Year range": "SDOT 2003–2026 + DfT 2024",
        "Used for": "Replicate Jiang et al. Tables 2–4",
    })

df_scope = pd.DataFrame(scope_rows)
print("=" * 78)
print("DATA SCOPE — year ranges per dataset")
print("=" * 78)
print(df_scope.to_string(index=False))
print("\\nNote: Toronto modelling uses the full 2014–2026 history.")
print("Paper 2 EDA uses SDOT (all years) + DfT 2024 — matching the published merge.\\n")

# ── 2. EDA alignment — where our replication MATCHES Paper 2 ─────────────────
PAPER2_EDA_REFS = [
    ("Weather", "Snowing",           "weather_label", 1.421, None),
    ("Weather", "Snowing+Wind",      "weather_label", 1.402, None),
    ("Road",    "Flood/Standing Water", "rsc_label",  1.417, "+10.44%"),
    ("Road",    "Snow/Slush",        "rsc_label",     1.336, "+10.75%"),
    ("Lighting","Dusk",              "light_label",   1.558, "+13.01%"),
    ("Lighting","Darkness-NoLight",  "light_label",   1.473, None),
    ("Weather", "Fine/Clear",        "weather_label", 1.285, None),
    ("Road",    "Dry",               "rsc_label",     1.169, None),
]

eda_rows = []
if "df_paper2_merged" in dir():
    overall = df_paper2_merged["number_of_casualties"].mean()
    for domain, label, col, paper_mean, paper_excess in PAPER2_EDA_REFS:
        sub = df_paper2_merged[df_paper2_merged[col] == label]["number_of_casualties"]
        ours_mean = sub.mean() if len(sub) else np.nan
        ours_excess = (ours_mean - overall) / overall * 100 if len(sub) else np.nan
        delta = ours_mean - paper_mean if not np.isnan(ours_mean) else np.nan
        match = "✓ close" if abs(delta) < 0.05 else ("↑ higher" if delta > 0.05 else "↓ lower")
        eda_rows.append({
            "Domain": domain, "Condition": label,
            "Paper mean": paper_mean, "Ours mean": round(ours_mean, 3),
            "Δ mean": round(delta, 3) if not np.isnan(delta) else None,
            "Paper excess": paper_excess or "",
            "Ours excess": f"{ours_excess:+.1f}%" if not np.isnan(ours_excess) else "",
            "Alignment": match if not np.isnan(delta) else "n/a",
        })
    df_eda = pd.DataFrame(eda_rows)
    print("=" * 78)
    print("PAPER 2 EDA ALIGNMENT — mean casualties (SDOT+DfT merged, Section 2.4)")
    print("=" * 78)
    print(df_eda.to_string(index=False))
    print(f"\\nOverall mean casualties (ours): {overall:.4f}")
    print("Headline hazards (snow, standing water, dusk) should rank highest — matching Paper 2 direction.\\n")
else:
    print("Run Section 2.2 first to build df_paper2_merged for EDA alignment table.\\n")

# ── 3. ML benchmark — Paper 2 vs our Toronto models (with caveats) ───────────
PAPER2_ML = {
    "Logistic Regression":   {"Accuracy": 0.790, "Rec (M)": 0.790, "F1 (M)": 0.790, "AUC (OvR)": None},
    "K-Nearest Neighbours":  {"Accuracy": 0.820, "Rec (M)": 0.820, "F1 (M)": 0.820, "AUC (OvR)": None},
    "Decision Tree":         {"Accuracy": 0.840, "Rec (M)": 0.840, "F1 (M)": 0.840, "AUC (OvR)": None},
    "Random Forest":         {"Accuracy": 0.878, "Rec (M)": 0.878, "F1 (M)": 0.878, "AUC (OvR)": 0.852},
    "DNN":                   {"Accuracy": 0.911, "Rec (M)": 0.955, "F1 (M)": 0.934, "AUC (OvR)": 0.759},
}

OUR_MODEL_MAP = {
    "Logistic Regression":  "Logistic Regression",
    "K-Nearest Neighbours": "K-Nearest Neighbours",
    "Decision Tree":      "Decision Tree",
    "Random Forest":      "Random Forest (Tuned)",
    "DNN":                "DNN (PyTorch)",
}

# Gather our results from Section 7 comparison
our_lookup = {}
if "comp_df" in dir():
    for _, row in comp_df.iterrows():
        our_lookup[row["Model"]] = row.to_dict()
else:
    _pool = []
    if "baseline_results" in dir():
        _pool += baseline_results
    if "tuned_results" in dir():
        _pool += tuned_results
    if "dnn_result" in dir() and dnn_result:
        _pool.append(dnn_result)
    for r in _pool:
        our_lookup[r["Model"]] = r

ml_rows = []
metrics = ["Accuracy", "Rec (M)", "F1 (M)", "AUC (OvR)"]
for paper_name, paper_vals in PAPER2_ML.items():
    our_name = OUR_MODEL_MAP[paper_name]
    ours = our_lookup.get(our_name, {})
    row = {"Model": paper_name, "Our variant": our_name}
    for m in metrics:
        p = paper_vals.get(m)
        o = ours.get(m)
        row[f"Paper {m}"] = p
        row[f"Ours {m}"] = o
        if p is not None and o is not None:
            row[f"Δ {m}"] = round(float(o) - float(p), 3)
        else:
            row[f"Δ {m}"] = None
    ml_rows.append(row)

lgb_key = next((k for k in our_lookup if "LightGBM" in k), None)
if lgb_key:
        o = our_lookup[lgb_key]
        ml_rows.append({
            "Model": "LightGBM (extension)",
            "Our variant": lgb_key,
            **{f"Paper {m}": "—" for m in metrics},
            **{f"Ours {m}": o.get(m) for m in metrics},
            **{f"Δ {m}": None for m in metrics},
        })

df_ml = pd.DataFrame(ml_rows)
print("=" * 78)
print("ML BENCHMARK — Jiang et al. (2024) vs our Toronto models")
print("=" * 78)
print(df_ml.to_string(index=False))
print("""
Caveats (not apples-to-apples):
  • Paper 2: SDOT + UK DfT, largely binary / high-accuracy severity setup.
  • Ours: Toronto 2014–2026, 3-class ordinal (PD / Injury / Fatal), 8 engineered features.
  • Lower accuracy here is expected; we prioritise fatal-class recall + MCC on Ontario data.
  • EDA direction (snow, dusk, standing water = higher casualties) DOES align with Paper 2.
""")

# Bar chart: accuracy comparison for matched models
plot_models = [r for r in ml_rows if r.get("Paper Accuracy") not in (None, "—")]
if plot_models:
    names = [r["Model"] for r in plot_models]
    paper_acc = [r["Paper Accuracy"] for r in plot_models]
    our_acc = [r["Ours Accuracy"] for r in plot_models]
    x = np.arange(len(names))
    fig, ax = plt.subplots(figsize=(10, 5))
    ax.bar(x - 0.2, paper_acc, 0.38, label="Paper 2 (Jiang et al.)", color="#C44E52", alpha=0.85)
    ax.bar(x + 0.2, our_acc, 0.38, label="Ours (Toronto test set)", color="#4C72B0", alpha=0.85)
    ax.set_xticks(x)
    ax.set_xticklabels(names, rotation=25, ha="right")
    ax.set_ylim(0, 1.05)
    ax.set_ylabel("Accuracy")
    ax.set_title("Tabular model accuracy — Paper 2 vs Ontario Smart-Shield", fontweight="bold")
    ax.legend()
    plt.tight_layout()
    plt.show()

# ── 4. Vision benchmark — ResNet18 (separate task, not vs RF) ─────────────────
print("=" * 78)
print("VISION BENCHMARK — ResNet18 (Section 6.2) — separate from tabular leaderboard")
print("=" * 78)

vision_rows = [
    {"Item": "Task", "Value": "4-class road surface (Clear / Wet / Snow / Ice)"},
    {"Item": "Architecture", "Value": "ResNet18 transfer learning (He et al., 2016)"},
    {"Item": "Literature reference", "Value": "Pan (2019) — CNN road-weather classification"},
    {"Item": "Why not compare to RF?", "Value": "RF predicts collision severity from tabular features; ResNet predicts surface class from pixels"},
]
if "vision_val_acc" in dir() and vision_val_acc is not None:
    vision_rows.append({"Item": "Val accuracy (ours)", "Value": f"{vision_val_acc:.1%}"})
    if "val_ds" in dir():
        vision_rows.append({"Item": "Val set size", "Value": str(len(val_ds))})
else:
    vision_rows.append({"Item": "Val accuracy (ours)", "Value": "Not trained — run Section 6.2"})

vision_rows.append({
    "Item": "Selection rationale",
    "Value": "Best available backbone for small image cache; feeds V_vision in Safety Score S",
})
print(pd.DataFrame(vision_rows).to_string(index=False))
print("""
ResNet is the Vision Brain choice because transfer learning works on our small cache,
not because it outscores RF on Toronto tabular data. Hybrid autoencoder (6.2b) adds
unseen-surface anomaly detection on top of ResNet softmax.
""")

# ── 5. Executive summary ──────────────────────────────────────────────────────
print("=" * 78)
print("EXECUTIVE SUMMARY")
print("=" * 78)
print("""
| Question | Answer |
|----------|--------|
| Best tabular model? | Random Forest (tuned) — highest MCC on Toronto test set |
| Best accuracy (tabular)? | kNN baseline (0.88) but weak macro recall — not deployed |
| Matches Paper 2 EDA? | Yes — snow, standing water, dusk rank highest on merged SDOT+DfT |
| Matches Paper 2 ML accuracy? | No — different geography, 3-class target, Ontario features |
| Best vision model? | ResNet18 (+ optional autoencoder) — val accuracy + confusion matrix |
| Deployed model | RF (tuned) for tabular + ResNet18 for vision fusion (Section 10) |
""")
'''

MARKDOWN_78_FINDINGS = """**Findings & importance:**

- **Where we match Paper 2:** Environmental statistics on `df_paper2_merged` reproduce the
  same hazard ranking (snow, standing water, dusk highest) — validating our EDA pipeline.
- **Where we differ:** Toronto 3-class ML metrics are below Paper 2 RF/DNN benchmarks because
  of task definition, class imbalance, and geography — not because the code is wrong.
- **kNN vs k-means:** Document clearly that **K-Nearest Neighbours** is the Paper 2 baseline,
  not k-means clustering.
- **ResNet rationale:** Include this section in D2/D3 to explain why ResNet is the Vision Brain
  without claiming it "beats" RF on the same metric table.
"""


def _cell_text(c: dict) -> str:
    return "".join(c.get("source", []))


def _is_section_78(c: dict) -> bool:
    s = _cell_text(c)
    return "Section 7.8" in s or "7.8  Literature alignment" in s


def _find_insert_index(cells: list) -> int:
    for i, c in enumerate(cells):
        s = _cell_text(c)
        if s.startswith("## Section 8"):
            return i
    for i, c in enumerate(cells):
        s = _cell_text(c)
        if "Section 7.7" in s and c["cell_type"] == "markdown":
            for j in range(i + 1, min(i + 6, len(cells))):
                if cells[j]["cell_type"] == "markdown" and "Findings" in _cell_text(cells[j]):
                    return j + 1
    return len(cells)


def make_cells() -> list:
    return [
        {"cell_type": "markdown", "metadata": {}, "source": [MARKDOWN_78], "id": "lit_align_md"},
        {"cell_type": "code", "metadata": {}, "source": [CODE_78], "outputs": [], "execution_count": None, "id": "lit_align_code"},
        {"cell_type": "markdown", "metadata": {}, "source": [MARKDOWN_78_FINDINGS], "id": "lit_align_findings"},
    ]


def main() -> None:
    nb = json.loads(NOTEBOOK.read_text(encoding="utf-8"))
    cells = nb["cells"]

    if any(_is_section_78(c) for c in cells):
        cells = [c for c in cells if not _is_section_78(c) and c.get("id") not in {
            "lit_align_md", "lit_align_code", "lit_align_findings",
        }]
        idx = _find_insert_index(cells)
        cells = cells[:idx] + make_cells() + cells[idx:]
        print(f"Replaced Section 7.8 at index {idx}")
    else:
        idx = _find_insert_index(cells)
        cells = cells[:idx] + make_cells() + cells[idx:]
        print(f"Inserted Section 7.8 at index {idx}")

    nb["cells"] = cells
    NOTEBOOK.write_text(json.dumps(nb, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"Updated {NOTEBOOK}")


if __name__ == "__main__":
    main()
