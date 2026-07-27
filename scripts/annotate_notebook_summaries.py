#!/usr/bin/env python3
"""Align notebook wording with saved outputs, add post-code summaries, swimlane."""
from __future__ import annotations

import re
import uuid
from pathlib import Path

import nbformat
from nbformat.v4 import new_markdown_cell

ROOT = Path(__file__).resolve().parents[1]
NB_PATH = ROOT / "notebooks" / "capstone_with_results.ipynb"
MARKER = "> **What just happened:**"


SWIMLANE = r'''---

## End-to-End Swimlane (what the notebook + demo actually do)

```mermaid
flowchart LR
  subgraph DATA["Data lane"]
    D1["Toronto collisions<br/>TorontoCollisionData.csv"]
    D2["UK DfT + Seattle SDOT<br/>literature / E_index"]
    D3["Ontario 511 alerts<br/>+ live weather"]
    D4["vision_cache / live CCTV<br/>511 highway cameras"]
  end

  subgraph NLP["NLP Brain"]
    N1["Clean + tokenize"] --> N2["TF-IDF"] --> N3["T score 0–1"]
  end

  subgraph VIS["Vision Brain"]
    V1["Resize 224×224"] --> V2["ResNet18"] --> V3["V score 0–1"]
  end

  subgraph TAB["Tabular / Decision lane"]
    T1["8 features + SMOTE"] --> T2["Baselines + tuned RF"]
    T2 --> T3["Stage A Fatal-vs-Not"]
    T2 --> T4["E_index from conditions"]
  end

  subgraph FUSE["Fusion lane"]
    F1["S = 100·(0.25T + 0.35V + 0.40E)"]
    F2["Tier LOW / MED / HIGH"]
    F3["Speed advice V_rec"]
    F1 --> F2 --> F3
  end

  subgraph OUT["Deploy lane"]
    O1["joblib / .pt artifacts"]
    O2["SHAP explainability"]
    O3["demo map Flask API"]
  end

  D1 --> T1
  D2 --> T4
  D3 --> N1
  D4 --> V1
  N3 --> F1
  V3 --> F1
  T4 --> F1
  T2 --> O1
  T3 --> O1
  V2 --> O1
  F3 --> O3
  T2 --> O2
  O1 --> O3
```

**How to read it:** three brains (NLP / Vision / Tabular) run in parallel, then fuse into Safety Score **S**. The notebook trains and validates; the `demo/` map serves live weather + alerts + optional live CCTV ResNet.
'''


# Curated 2–3 sentence summaries keyed by code-cell index (pre-insert positions).
SUMMARIES: dict[int, str] = {
    1: (
        "Environment detection finished. The session is on a local machine with an **A100** GPU, "
        "packages already present, and the `DATA` path pointing at the project `Data/` folder with the expected CSVs."
    ),
    5: (
        "Optional OpenMP install check ran. On this host the library is already available, so modelling "
        "libraries that need it (for example LightGBM) can load without a compile step."
    ),
    6: (
        "Core scientific stack imported and availability flags printed (LightGBM, PyTorch, imbalanced-learn). "
        "`DATA` resolves to the same folder used later for Toronto modelling."
    ),
    9: (
        "Raw tables loaded into memory (`df_toronto`, DfT, and related frames). "
        "Later EDA and modelling sections consume these objects rather than re-reading ad-hoc paths."
    ),
    11: (
        "Schema inspection listed column names and dtypes for the Toronto and reference datasets. "
        "This is the inventory step before target engineering and cleaning."
    ),
    13: (
        "The `SEVERITY` target was engineered on Toronto rows (PD-Only / Injury / Fatal). "
        "Class counts below confirm Fatal remains extremely rare before any modelling."
    ),
    15: (
        "Six-panel distribution charts were drawn for the Toronto severity and time/mode flags. "
        "Use these plots to see imbalance and when collisions cluster before reading correlation tests."
    ),
    17: (
        "UK DfT severity codes were decoded and distribution plots produced for the literature reference set. "
        "This supports Paper 2-style environmental comparisons later, not the Toronto RF training matrix."
    ),
    19: (
        "Seattle SDOT dates were parsed and filtered to a recent five-year window. "
        "The printed shape/date range is the US side of the merged literature EDA."
    ),
    21: (
        "SDOT severity was mapped to a numeric target for charts and merges. "
        "This does not replace Toronto `SEVERITY` used in Section 8 modelling."
    ),
    22: (
        "Time features were extracted from SDOT and plotted. "
        "These panels are exploratory context for the UK+US merge, not the final eight Toronto features."
    ),
    24: (
        "UK and SDOT columns were subset to the Paper 2-aligned feature list. "
        "The printed column lists are what feed the merged weather/surface tables next."
    ),
    25: (
        "UK and US frames were aligned and combined for the merged EDA table. "
        "Row counts and severity mix in the output define the literature-replication sample."
    ),
    27: (
        "Merged severity distribution was printed so class balance on the UK+US table is visible "
        "before weather/surface heatmaps."
    ),
    28: (
        "Weather and severity cross-tabs were visualised for the merged set. "
        "Unknown/Other weather handling is documented in the markdown above the chart."
    ),
    30: (
        "Paper 2 summary Tables 2–4 style counts were reproduced from the merged data. "
        "Compare these printed rates to the paper’s environmental severity story."
    ),
    31: (
        "Tables A/B/C style bars were drawn with Paper 2 reference lines overlaid. "
        "This is a visual check that our replication sits near the published pattern."
    ),
    32: (
        "Excess-casualty style headline stats (above-average environmental risk) were computed. "
        "These numbers motivate the `E_index` weights used later in Safety Score fusion."
    ),
    33: (
        "Road-surface × weather heatmap finished. "
        "Darker cells mark combinations that carry higher severe-outcome share in the merged set."
    ),
    36: (
        "Toronto preprocessing produced the clean working frame used to build `df_model`. "
        "Subsequent cells expect these engineered columns to exist."
    ),
    37: (
        "Canonical `SEVERITY` (0=PD, 1=Injury, 2=Fatal) was created on the modelling frame. "
        "Printed class counts should match the imbalance narrative used in ethics and Stage A."
    ),
    39: (
        "DfT cleaning created `dft_clean` for environmental/`E_index` analysis. "
        "This remains a reference lane, separate from the Toronto RF feature matrix."
    ),
    41: (
        "Merged UK/US datetime fields were unified for time-based flags. "
        "Downstream night/rush indicators depend on this combined timestamp."
    ),
    43: (
        "Night-time and related temporal flags were added on the merged set. "
        "These binary indicators are the practical time features (vs raw hour alone)."
    ),
    45: (
        "Categorical columns stored as floats were cast to proper categories. "
        "That avoids treating codes as continuous magnitudes in later stats."
    ),
    47: (
        "Pearson correlations vs `SEVERITY` finished. "
        "**PEDESTRIAN_BIN ≈ 0.325** and **BICYCLE_BIN ≈ 0.224** lead; time flags sit near zero."
    ),
    50: (
        "Chi-square tests vs severity all flag YES on this large sample. "
        "Vulnerable-user Chi² values dominate (~87k / ~41k); time flags span roughly **48–2040**."
    ),
    53: (
        "UK point-biserial correlations against severity were printed. "
        "Absolute |r| values stay weak, matching the “environment matters but only modestly linearly” story."
    ),
    56: (
        "Merged UK+US point-biserial results: Year **+0.123**, Junction **+0.053**, Light **+0.045**; "
        "Weather is **not** significant (p≈0.28). Hour is significant but tiny (**r=+0.016**)."
    ),
    59: (
        "Three-method voting (chi², mutual information, RF importances) selected the final eight features. "
        "All eight scored 3/3 votes — this is the schema Section 8 must reuse."
    ),
    60: (
        "Side-by-side importance charts were saved for the three selectors. "
        "Read them together with the vote table: confirmation of the candidate list, not a huge prune."
    ),
    63: (
        "Vision data-source reference printed (cache path / expected class folders). "
        "Section 6.1 loads sample frames from that cache next."
    ),
    65: (
        "Loaded **9** cached road-condition photos (Clear / Wet-Slush / Snow-Ice) and displayed the grid. "
        "This is the offline sample set for the notebook; the live demo can also score Ontario 511 CCTV."
    ),
    67: (
        "In **this saved notebook state**, ResNet18 fine-tune was **skipped** for a chart-refresh run. "
        "Weights may still exist under `models/vision_resnet18.pt` from a prior GPU training pass."
    ),
    70: (
        "Section 8.1 rebuilt the Toronto model matrix, split train/test, applied SMOTE, and scaled features. "
        "Expect **DATA PROVENANCE OK**, ~809k rows × **8** features, and heavy class imbalance on Fatal."
    ),
    72: (
        "Stage A (Fatal vs Not) finished. **LR @0.50** hits Fatal recall **1.00** (KPI met) with precision "
        "**~0.0008** — high sensitivity, many false alarms. Use as a safety screen, not the final 3-class label."
    ),
    74: (
        "Five 3-class baselines trained. **KNN** leads MCC (**~0.382**) and accuracy; RF/LGBM trail on MCC "
        "but remain candidates for explainability. Fatal remains hard for every 3-class model here."
    ),
    76: (
        "Ethics audit plotted imbalance, measured per-class recall, and finished the **geographic parity** check "
        "on the same **8** features. Accuracy gap **0.0387** → **PASS ≤0.05**. No 3-class model met Fatal recall ≥0.92."
    ),
    78: (
        "Baseline comparison table + per-class reports/plots were rendered (sorted by MCC). "
        "KNN still tops MCC; RF is retained later for SHAP / Paper 2, not for leading this table."
    ),
    80: (
        "Hyperparameter search did **not** re-run in this save: tuned LR / RF / LightGBM were **warm-loaded** "
        "from `models/*.joblib`. Metrics in the next cell come from those artifacts."
    ),
    81: (
        "Tuned models evaluated on the held-out test set. Approximate MCCs: LR **0.148**, RF **0.164**, "
        "LightGBM **0.162**. Gains vs untuned baselines are modest; imbalance still dominates Fatal metrics."
    ),
    83: (
        "Confusion matrices for all tuned sklearn models were drawn. "
        "Look at the Fatal row/column: recall can look non-zero while precision stays near zero."
    ),
    85: (
        "Backward-compatibility aliases were set so later Sprint-3 cells can find `model_rf` / tuned handles "
        "even if an older variable name is referenced."
    ),
    87: (
        "Simple MLP architecture (`ShieldDNN`) was defined in memory. "
        "Training happens in the following cell when not skipped."
    ),
    88: (
        "In **this saved state**, DNN training was **skipped** for chart refresh — comparison tables stay sklearn-only. "
        "Prior GPU runs may still have left `models/dnn_smart_shield.pt` on disk."
    ),
    89: (
        "Tabular ResNet architecture was defined. Same skip/train pattern as the Simple MLP cell."
    ),
    90: (
        "Tabular ResNet training was **skipped** in this save (chart-refresh path). "
        "No new DNN confusion matrix was written to outputs here."
    ),
    91: (
        "Gated Linear Unit architecture was defined for the third DNN variant."
    ),
    92: (
        "GLU training was **skipped** in this save. Head-to-head comparison below therefore ranks sklearn models only."
    ),
    94: (
        "Full comparison table + chart sorted by MCC. **KNN** remains best MCC among present models; "
        "DNNs are absent from this refresh. RF is still the deploy/explainability pick stated later."
    ),
    96: (
        "Ontario TC-1…TC-5 tabular stress tests ran. RF **missed** both Fatal fixtures (TC-2→Injury, TC-5→PD); "
        "LR hit TC-2 only. The **S** values printed here are placeholders — canonical fused **S** is in §10.2."
    ),
    98: (
        "Final RF evaluation + Paper 2 delta table finished. Fatal precision **~0.004**, recall **~0.56** on the "
        "3-class test set — reinforces why Stage A exists for the recall KPI."
    ),
    102: (
        "NLP Brain scored the five Ontario alerts with TF-IDF. Clear days sit at **T≈0**; blizzard **T≈0.69**; "
        "ice storm **T=1.00**. These T values feed Safety Score fusion next."
    ),
    104: (
        "Canonical Safety Score fusion ran. TC-2 / TC-5 land **HIGH** (**S≈87 / 86**, advisory **80 km/h**); "
        "clear scenarios stay **LOW**. Stacked bars show weighted T / V / E contributions."
    ),
    106: (
        "SHAP summaries for the tuned RF were generated on a sample of test rows. "
        "Use the bee-swarm plots to explain which of the eight features push PD / Injury / Fatal."
    ),
    108: (
        "Models and helpers were serialized under `models/` (RF, LR, scaler, features, TF-IDF, Stage A, "
        "and any available DNN/Vision weights). Load-test preds confirm the RF artifact reloads cleanly."
    ),
}


MARKDOWN_FIXES: dict[int, tuple[str, str]] = {}


def _src(cell) -> str:
    return cell.source if isinstance(cell.source, str) else "".join(cell.source)


def _set(cell, text: str) -> None:
    cell.source = text if text.endswith("\n") else text + "\n"


def fix_markdown(nb) -> None:
    # Cell 3 reading guide — approximate current structure
    _set(
        nb.cells[3],
        """---

# Ontario Smart-Shield – Data Analysis Notebook

> Master notebook with saved results. Prefer **Run All** on a GPU host after `Data/` is present.
>
> Part I: charter + swimlane. Part II: EDA → features → vision → modelling → fusion.

---

## Notebook Reading Guide

| Section | What it covers |
|---|---|
| 0 – Charter + swimlane | Business case, 3-Brain architecture, end-to-end lanes |
| 1 – Setup | Environment, imports, package flags |
| 2 – EDA | Toronto / DfT / SDOT distributions and Paper 2 replication |
| 3 – Preprocessing | Cleaning, severity, temporal flags |
| 4 – Correlation | Pearson, chi-square, point-biserial |
| 5 – Feature selection | Voting → **8** final Toronto features |
| 6 – Vision Brain | Cached samples + ResNet18 (may warm-load / skip on refresh) |
| 7–8 – Modelling | Stage A, baselines, fairness, tuned RF, optional DNNs |
| 9 – Summary | Sprint checklist |
| 10 – Fusion | TF-IDF T, Safety Score S, SHAP, serialize |
| Validation | Plain-English check that wording matches **this save’s** outputs |
""",
    )

    _set(
        nb.cells[7],
        """---
## Run All - Start Here

Run cells top to bottom (Runtime → Run All, or Shift+Enter through each cell).

| Phase | Notes |
|-------|-------|
| Setup | Environment + imports; restart kernel once if torch was just installed |
| Data + EDA | Loads Toronto + DfT/SDOT from `Data/` |
| Preprocess + stats | Cleaning, correlations, feature voting → 8 features |
| Vision Brain | Uses `Data/vision_cache` samples; full fine-tune needs `TORCH_OK` + time |
| Modelling | Baselines can take ~10+ min (KNN is slow). Tuned models may **warm-load** from `models/` |
| Sprint 3 | NLP, Safety Score, SHAP, save artifacts |

**Requirements:** `Data/TorontoCollisionData.csv` (and DfT/SDOT CSVs used in EDA) under the project `Data/` folder.

**If a cell fails:** note the cell, fix the error, then **Run All Below**. Don't restart the kernel unless torch was just installed.

**Honesty note:** some saved outputs in this file come from a chart-refresh path (vision/DNN skipped, GridSearch warm-started). Re-run those sections on GPU for a full training log.
""",
    )

    _set(
        nb.cells[48],
        """Pedestrian and bicycle variables have the highest Pearson scores (**≈0.325** and **≈0.224** in the printout above). "
        "Those numbers point to a moderate positive link with collision severity: accidents involving these groups are more likely to end in severe injury. "
        "Time variables (hour, month, season, night, rush hour) sit close to zero, so there is almost no linear relationship between exact time and severity. "
        "Automobile involvement is near zero / slightly negative — car-only crashes skew toward property damage.
""",
    )
    # Fix accidental quote mangling
    _set(
        nb.cells[48],
        "Pedestrian and bicycle variables have the highest Pearson scores (**≈0.325** and **≈0.224** in the printout above). "
        "Those numbers point to a moderate positive link with collision severity: accidents involving these groups are more likely to end in severe injury. "
        "Time variables (hour, month, season, night, rush hour) sit close to zero, so there is almost no linear relationship between exact time and severity. "
        "Automobile involvement is near zero / slightly negative — car-only crashes skew toward property damage.\n",
    )

    _set(
        nb.cells[51],
        "All variables come back with significant p-values (effectively zero). Large samples often do that even for weak relationships, "
        "so significance alone is not practical importance. The raw Chi² numbers tell the story: pedestrian / bicycle flags are enormous "
        "(~87k / ~41k), while time-related Chi² values span roughly **48–2040** (rush-hour at the low end, hour-of-day at the high end). "
        "Vulnerable road users still dominate the association with severity.\n",
    )

    _set(
        nb.cells[57],
        """### 1. Overview

Almost all p-values are zero on this large merged sample, which only means “unlikely by chance,” not “strong predictor.” Absolute |r| values stay small (all well under 0.20), so individual linear links to the severe outcome are weak.

### 2. Feature Performance (this run)

From the printout above:
- **Year** is the largest |r| here (**+0.123**).
- **Junction type (+0.053)** and **light condition (+0.045)** are the next environmental signals.
- **Road condition** is significant but tiny (**−0.021**).
- **Weather** is **not** significant (**p≈0.275**).
- **Hour** is significant (**p≈0.000**) but practically tiny (**r=+0.016**) — keep binary night/rush flags; do not treat raw hour as a strong linear driver.

### 3. Model Recommendations

Keep the engineered binary time flags. Do **not** drop hour solely because of an old “p=0.84” claim — that number is stale relative to this output. Prefer tree ensembles (RF / boosting) for interactions; linear models will struggle when every |r| is this small.
""",
    )

    _set(
        nb.cells[64],
        """---
## Section 6 · Vision Brain: Sample Images and Fine-Tuning

**Goal:** show how the Vision Brain sees road conditions, then fine-tune a CNN when a full GPU pass is requested.

| Step | What you will see |
|------|-------------------|
| **6.1** | Sample images from `Data/vision_cache`: Clear / Wet-Slush / Snow-Ice |
| **6.2** | Fine-tune **ResNet18** (or skip / load `models/vision_resnet18.pt` on refresh) |
| **6.3** | When trained: validation accuracy + confusion matrix → **V** for Safety Score S |

**Notebook data:** offline `vision_cache` samples (this save shows **9** images).  
**Demo note:** the live map can score **Ontario 511 CCTV** stills with the same ResNet weights — that path lives in `demo/`, not only this training cell.
""",
    )

    _set(
        nb.cells[66],
        """### 6.2 · Fine-Tune the Vision Model

**Limitation:** charter sources (UWaterloo iTSS, Ontario 511, HuggingFace RSCD) are larger than what a thin cache can represent. "
        "If the next cell prints a skip/warm-load message, treat notebook V-metrics as **not freshly trained in this save**. "
        "The deployable demo can still run ResNet on cache photos or live CCTV using saved weights.
""".replace('". "', ". "),
    )
    _set(
        nb.cells[66],
        "### 6.2 · Fine-Tune the Vision Model\n\n"
        "**Limitation:** charter sources (UWaterloo iTSS, Ontario 511, HuggingFace RSCD) are larger than what a thin cache can represent. "
        "If the next cell prints a skip/warm-load message, treat notebook V-metrics as **not freshly trained in this save**. "
        "The deployable demo can still run ResNet on cache photos or live CCTV using saved weights.\n",
    )

    _set(
        nb.cells[71],
        """### Section 8.1b · Fatal vs Not-Fatal Pilot (Stage A)

**Why this exists:** the charter KPI is Fatal recall ≥ 0.92. A single 3-class model struggles because Fatal is ~0.1% of rows. Stage A asks a simpler safety question: **Fatal vs Not-Fatal**.

**What this cell does:** train Logistic Regression and Random Forest on the binary target, sweep thresholds, and report the recall/precision trade-off.

**This-run validation:** LR Fatal-vs-Not at threshold **0.5** gives Fatal recall **1.00** (**KPI met**) and Fatal precision **0.0008**. High recall with tiny precision means many false alarms — Stage A is a safety screen, not the final 3-class label.
""",
    )

    _set(
        nb.cells[77],
        """### Explainability vs Raw Recall (Selection Note)

In the **baseline report** (next cells), **KNN** often posts the highest **PD-Only recall** (around **0.99**) and the best **MCC**. The fairness table above is different: its highest PD-Only recall in this save is **Logistic Regression (0.8874)**, and KNN may be absent from that fairness slice.

**We still pick Random Forest (tuned) for the main 3-class deploy path**, because:
1. SHAP can show which features pushed a prediction (ethics deliverable).
2. A tree ensemble lines up with Paper 2 for comparison.
3. Stakeholders can inspect feature impact; KNN does not give that cleanly.

High PD-Only recall does not automatically mean chosen model. The chosen model is the **best explainable safety tool for this project**, with limits disclosed.
""",
    )

    _set(
        nb.cells[95],
        """### Section 8.6 · Live Test Cases – Ontario Highway Scenarios

Five Ontario fixtures stress-test boundary conditions. TC-2 and TC-5 are the **Fatal-risk** fixtures used to probe whether tabular models catch the worst cases (charter Fatal recall KPI is handled primarily by **Stage A**, not these five rows alone).

| # | Scenario | Expected | Key risk factors |
|---|---|---|---|
| TC-1 | Clear summer afternoon, 401 rush hour | Injury (1) | IS_RUSHHOUR=1 |
| TC-2 | Blizzard at 2am, Hwy 400, pedestrian struck | **Fatal (2)** | IS_NIGHT=1, PED=1, Jan |
| TC-3 | Wet dawn, bicycle involved, off-rush | Injury (1) | BICYCLE=1, Apr |
| TC-4 | Clear Sunday morning, Hwy 115 | PD-Only (0) | Low-risk profile |
| TC-5 | Ice storm rush hour, QEW, Feb 5pm | **Fatal (2)** | IS_RUSHHOUR=1, Feb |

**This-run note:** RF misses both Fatal fixtures here (TC-2→Injury, TC-5→PD-Only); LR hits TC-2 only. The **S** values printed in this cell are **toy placeholders** — use **§10.2** for canonical fused Safety Scores.
""",
    )

    _set(
        nb.cells[97],
        """### Section 8.7 · Final Model Selection and Rationale

**Honest reading of our own tables:** the best MCC in the comparison goes to **K-Nearest Neighbours (~0.382)**, not Random Forest. PD-Only recall can also look strongest for KNN (~0.99), but that is the easy majority class, not the safety KPI.

**Random Forest (tuned)** is still our deployment and explainability pick (SHAP, Paper 2 alignment, auditability). We are **not** claiming RF won on MCC.

**Decision matrix (weighted scoring, qualitative):**

| Criterion | Weight | LR L1 | RF (tuned) | LightGBM | DNN | KNN |
|---|---|---|---|---|---|---|
| Macro / Fatal safety signal | 40% | Medium | Medium | Medium | High (when trained) | Low (Fatal recall often ~0) |
| MCC (overall ranking) | 25% | Low | Low–Med | Med | Med | **Highest in table** |
| Interpretability / SHAP | 20% | **Yes** | **Partial (SHAP)** | Partial | No | Low |
| Paper 2 benchmark fit | 15% | Partial | **Yes** | Partial | No | No |

**Final decisions:**
- **Deploy (3-class):** Random Forest (tuned) for explainability / Paper 2
- **Safety pilot (Stage A):** Fatal vs Not from §8.1b (recall KPI path)
- **Oracle:** PyTorch DNN when a full GPU train is present; **skipped in this save’s comparison table**
- **Audit/Report:** Logistic Regression L1 for auditable coefficients

**This-run validation:** best baseline MCC **KNN (0.382)**; tuned LightGBM MCC **0.162**, RF Tuned **0.164**. DNN rows are absent from the refresh comparison. 3-class RF Fatal precision **~0.004**, recall **~0.56**.
""",
    )

    _set(
        nb.cells[99],
        """---
## Section 9 · Summary and Sprint Progress

### Completed in this notebook

| Sprint | Deliverable | Section |
|--------|-------------|---------|
| Sprint 1–2 | EDA, stats, preprocessing, feature selection | 1–5 |
| Sprint 2 | Baselines, tuned RF (warm-load or GridSearch), comparison | 8 |
| Sprint 2 | Vision Brain sample images (+ CNN when not skipped) | 6 |
| Sprint 2 | Ethics audit + confusion matrices | 7, 8.3c |
| **Sprint 3** | NLP Brain TF-IDF | **10.1** |
| **Sprint 3** | Safety Score fusion + dashboard | **10.2** |
| **Sprint 3** | SHAP explainability | **10.3** |
| **Sprint 3** | Model deployment (joblib) | **10.4** |

### Outside the notebook (demo)
- Live Open-Meteo weather → **E**
- Live Ontario 511 alerts → **T**
- Optional live 511 CCTV stills → ResNet **V**
- Flask map UI fusing **S**

### Still future work
- Harden production hosting (not GitHub Pages for GPU/Flask)
- Broader real-image training beyond the thin vision cache
""",
    )

    _set(
        nb.cells[100],
        """---
# Section 10 · Sprint 3: Multimodal Fusion and Deployment

Sprint 3 ties the three brains together:

| Pillar | Module | Output |
|--------|--------|--------|
| **1 NLP Brain** | TF-IDF on Ontario 511-style alerts | `T` score (text hazard) |
| **2 Vision Brain** | ResNet18 (notebook cache and/or demo CCTV) | `V` score (hazard probability) |
| **3 Tabular optimizer** | Tuned RF + `E_index` | severity class + environment risk |
| **Fusion** | Safety Score formula | `S` → tier + speed advice |

Also included: **SHAP explainability** and **model serialization** for deployment.
""",
    )

    _set(
        nb.cells[103],
        """### 10.2 · Safety Score Fusion (T + V + E → S)

$$S = (w_T \\cdot T + w_V \\cdot V + w_E \\cdot E_{index}) \\times 100$$

Weights in the chart legend: $w_T=0.25$, $w_V=0.35$, $w_E=0.40$.

Read the stacked bars first. Bar height is fused **S**. Colours are the weighted pillar pieces. Arrows mark LOW / MEDIUM / HIGH.

| Tier | S range | Speed advice |
|------|---------|----------------|
| LOW | 0–30 | near posted limit |
| MEDIUM | 31–70 | about 80% of posted |
| HIGH | 71–100 | about 60% of posted, then demo/freeway floor clamps advisory to **≥80 km/h** in this notebook |

TC-1…TC-5 are hold-out Ontario fixtures, not rows from the Toronto training set. **This cell’s table is the canonical S** (not the placeholder S in §8.6).
""",
    )

    _set(
        nb.cells[109],
        """## Run Validation Report (aligned to **saved outputs** in this file)

Plain-English check that claims match what the cells above actually printed/plotted in **this notebook save**.

### 1. Did we use the right data?
- **Check:** `DATA PROVENANCE OK` in §8.1
- **Result:** `TorontoCollisionData.csv` / `df_model` with **809,030** rows × **8** features
- **Class mix:** PD-Only 698,656 (86.4%), Injury 109,712 (13.6%), Fatal **662 (0.1%)**
- **Train/test:** 647,224 / 161,806; after SMOTE → **1,676,775**
- **Meaning:** EDA and modelling share one Toronto source. Fatal remains extremely rare.

### 2. Vision Brain (this save)
- **Samples shown:** **9** images from `Data/vision_cache` (Clear / Wet-Slush / Snow-Ice)
- **Training log:** fine-tune was **skipped** for chart refresh (`Vision fine-tune skipped…`)
- **Artifacts:** `models/vision_resnet18.pt` may still exist from a prior GPU run; demo can score live CCTV
- **Do not claim** 87% val-acc from this save’s outputs — that number is not in the current stream

### 3. Stage A: Fatal vs Not-Fatal
- **Model:** LR Fatal-vs-Not @ threshold **0.5**
- **Fatal recall:** **1.0000** → KPI ≥0.92 **MET**
- **Fatal precision:** **0.0008** → many false alarms
- **Artifact:** `models/fatal_vs_not_stage_a.joblib`

### 4. Three-class baselines
| Model | Accuracy | Macro F1 | MCC | Note |
|------:|---------:|---------:|----:|------|
| Logistic Regression | 0.784 | 0.352 | 0.149 | |
| Decision Tree | 0.769 | 0.383 | 0.165 | |
| **K-Nearest Neighbours** | **0.886** | **0.429** | **0.382** | **best MCC** |
| Random Forest | 0.767 | 0.383 | 0.164 | kept for SHAP / Paper 2 |
| LightGBM | 0.787 | 0.387 | 0.177 | |

- KNN Fatal precision/recall on the detailed report stay ~0.00 (support 132).

### 5. Ethics / fairness audit
- **Geographic parity:** **DONE** on the same 8-feature schema; accuracy gap **0.0387** (**PASS ≤0.05**)
- **Honest headline:** no *3-class* model in the fairness table met Fatal recall ≥0.92 (best Fatal recall there: **LR ~0.66**). Stage A is the binary path that meets the KPI.

### 6. Tuned sklearn models
- **This save:** GridSearch **warm-loaded** from disk (`Warm-start complete`), not a fresh 5.3 min search log
- **Test metrics:** LR Tuned Acc **0.782** MCC **0.148** AUC **0.661**; RF Tuned Acc **0.767** MCC **0.164** AUC **0.600**; LightGBM Tuned Acc **0.765** MCC **0.162** AUC **0.608**

### 7. Deep nets (this save)
- DNN train cells printed **skipped for chart refresh** — comparison table is **sklearn-only**
- Do not quote MLP/ResNet/GLU Acc/MCC from this save; re-run §8.4 on GPU to refresh those plots

### 8. Fusion, SHAP, deployment
- **NLP T:** clear ≈0.0; blizzard **0.688**; ice storm **1.000**
- **Canonical S (§10.2):** TC-2 **87.0 HIGH**, TC-5 **86.2 HIGH**; clear cases **LOW** (ignore placeholder S in §8.6)
- **SHAP:** RF bee-swarm summaries present
- **Saved:** `rf_tuned.joblib`, scaler, features, TF-IDF, Stage A, plus any DNN/Vision weights on disk

### 9. Visual checklist
Count PNGs in **this save** (about **24**), not an older “31 figures” claim. Expect EDA, feature importance, fairness geo chart, baseline/tuned matrices, Safety Score dashboard, SHAP. Vision/DNN training curves may be missing until those cells are re-run.

### 10. Bottom line
1. **This save is chart/artifact honest:** vision + DNN training skipped; tuned models warm-loaded; GPU host still available for a full re-train.
2. **Data integrity fixed** (one Toronto file, no split mismatch).
3. **Stage A hits the Fatal recall KPI**, but with tiny precision.
4. **KNN has the best MCC** among 3-class baselines; RF kept for explainability.
5. **Geo fairness is done** (urban vs suburban accuracy gap **0.0387**, PASS ≤0.05).
""",
    )


def fix_code_snippets(nb) -> None:
    # Cell 76: wrong "LR ~0.78" headline
    src = _src(nb.cells[76])
    src2 = src.replace(
        "(best here is often LR ~0.78).",
        "(best Fatal recall in this table: LR ~0.66).",
    )
    if src2 != src:
        _set(nb.cells[76], src2)

    # Cell 104: chart title Section 9.5 → 10.2
    src = _src(nb.cells[104])
    src2 = re.sub(
        r'Section\s*\*?\*?9\.5\*?\*?\s*/\s*10\.2',
        "Section 10.2",
        src,
    )
    src2 = src2.replace("Section 9.5 / 10.2", "Section 10.2")
    src2 = src2.replace("Section **9.5** / 10.2", "Section 10.2")
    if "9.5" in src2:
        src2 = src2.replace("9.5", "10.2")
    if src2 != src:
        _set(nb.cells[104], src2)


def insert_swimlane(nb) -> None:
    # Insert after charter cell (index 2) if not already present
    joined = "\n".join(_src(c) for c in nb.cells if c.cell_type == "markdown")
    if "End-to-End Swimlane" in joined:
        return
    cell = new_markdown_cell(SWIMLANE)
    cell.id = uuid.uuid4().hex[:16]
    nb.cells.insert(3, cell)


def insert_summaries(nb) -> None:
    """Insert What-just-happened markdown after each code cell (walking backward)."""
    # Build map from original code index -> summary using positions before swimlane insert.
    # After swimlane insert at 3, code indices >=3 shift by +1.
    # Safer: iterate by cell id / content fingerprint after all markdown fixes.

    code_indices = [i for i, c in enumerate(nb.cells) if c.cell_type == "code"]
    # Match summaries by searching for distinctive first lines in code cells
    first_line_to_summary = {}
    # Rebuild using current notebook: apply SUMMARIES to code cells in order of appearance
    # Original SUMMARIES keys were pre-swimlane indices. After inserting 1 cell at 3,
    # original index i maps to i if i < 3 else i+1.
    shifted: dict[int, str] = {}
    for old_i, text in SUMMARIES.items():
        new_i = old_i if old_i < 3 else old_i + 1
        shifted[new_i] = text

    # Insert from the end so indices stay valid
    for i in sorted(shifted.keys(), reverse=True):
        if i >= len(nb.cells) or nb.cells[i].cell_type != "code":
            # find nearest code cell with matching start — skip if mismatch
            continue
        text = shifted[i]
        # If next cell already a What-just-happened summary, replace it
        if i + 1 < len(nb.cells) and _src(nb.cells[i + 1]).lstrip().startswith(MARKER):
            _set(nb.cells[i + 1], f"{MARKER} {text}\n")
            continue
        # If next markdown already explains this step briefly, still insert dedicated marker cell
        md = new_markdown_cell(f"{MARKER} {text}\n")
        md.id = uuid.uuid4().hex[:16]
        nb.cells.insert(i + 1, md)


def ensure_all_code_have_summaries(nb) -> None:
    """Fallback generic summary for any code cell still missing a following marker."""
    i = 0
    while i < len(nb.cells):
        c = nb.cells[i]
        if c.cell_type == "code":
            need = True
            if i + 1 < len(nb.cells) and _src(nb.cells[i + 1]).lstrip().startswith(MARKER):
                need = False
            if need:
                # Derive a short fallback from the first non-empty comment/code line
                src = _src(c).strip().splitlines()
                head = next((ln.strip() for ln in src if ln.strip() and not ln.strip().startswith("get_ipython")), "this step")
                head = head[:120]
                md = new_markdown_cell(
                    f"{MARKER} Code block finished (`{head}`). "
                    "Check the stdout/plots above for the numeric result of this step; "
                    "if there is no output, the cell mainly defined helpers or was skipped on purpose.\n"
                )
                md.id = uuid.uuid4().hex[:16]
                nb.cells.insert(i + 1, md)
        i += 1


def main() -> int:
    nb = nbformat.read(NB_PATH, as_version=4)
    fix_markdown(nb)
    fix_code_snippets(nb)
    insert_swimlane(nb)
    insert_summaries(nb)
    ensure_all_code_have_summaries(nb)
    nbformat.write(nb, NB_PATH)

    # Sync parts
    try:
        import sys

        sys.path.insert(0, str(ROOT / "scripts"))
        from sync_notebook_parts import sync_main_to_parts

        sync_main_to_parts(ROOT, only=None, sync_source=True)
        print("Parts synced")
    except Exception as e:
        print(f"Parts sync skipped: {e}")

    # Report
    nb2 = nbformat.read(NB_PATH, as_version=4)
    n_sum = sum(1 for c in nb2.cells if c.cell_type == "markdown" and MARKER in _src(c))
    n_code = sum(1 for c in nb2.cells if c.cell_type == "code")
    print(f"cells={len(nb2.cells)} code={n_code} summaries={n_sum}")
    print("swimlane=", any("End-to-End Swimlane" in _src(c) for c in nb2.cells))
    print("bottom_line_geo_done=", any("Geo fairness is done" in _src(c) for c in nb2.cells))
    print("stale_incomplete=", any("Geo fairness is still incomplete" in _src(c) for c in nb2.cells))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
