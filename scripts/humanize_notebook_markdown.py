"""
Rewrite the markdown cells of capstone_with_results.ipynb so they read like
notes from a working data scientist rather than AI-generated copy, and lightly
tidy the decorative "banner" comments in code cells.

Usage:
    python scripts/humanize_notebook_markdown.py
"""

import json
import re
from pathlib import Path
from typing import Dict

NOTEBOOK_PATH = Path(__file__).resolve().parent.parent / "notebooks" / "capstone_with_results.ipynb"

# ---------------------------------------------------------------------------
# Markdown cell rewrites, keyed by cell index in the notebook's `cells` list.
# ---------------------------------------------------------------------------

REWRITES: Dict[int, str] = {}

REWRITES[0] = r"""---

## Environment Setup Cell
> Run this cell first, whether you're on a local machine, Google Colab, or Kaggle.
> It detects the environment, mounts storage, installs packages, and sets the `DATA` path.
> Everything else in the notebook runs unchanged after this.
"""

REWRITES[2] = r"""This document is the master project specification for Group 6, meant to be shared with teammates and presented to the professor. It lays out the business case, the technical "3-Brain" architecture, the math behind the Safety Score, and a data acquisition plan we can actually execute.

---

# **Project Charter: The Ontario "Smart-Shield"**
### **Multimodal AI for Dynamic Highway Risk and Speed Optimization**

**Course:** PROG50141 – Python for Machine Learning  
**Project Lead:** Afolabi Adesina | **Group:** 6  
**Timeline:** 8 Weeks
**Target Region:** 400-Series Highway Corridors, Ontario, Canada

---

## **1. Executive Summary**
The Ontario Smart-Shield is a multimodal AI system built to close the "static data gap" in current navigation tools. Google Maps tracks traffic flow well, but it doesn't identify causal hazards like black ice or sudden whiteouts. Our system listens to official alerts using NLP, reads road conditions with computer vision, and decides on safe speed limits through logistic optimization.

---

## **2. Technical Architecture (The 3-Brain System)**

### **Pillar 1: The NLP Brain (The Social Listener)**
Standard sensors can't detect qualitative events like a "stalled vehicle" or "police activity" report. This module turns unstructured government text into a numeric risk index. The process runs cleaning, then tokenization, then Porter stemming.

**The Formula (TF-IDF):**
$$T = \sum_{i=1}^{n} (tf_{i,d} \cdot \log \frac{N}{df_i})$$

Here $tf$ (how often "danger" words appear in an alert) gets weighted against $idf$ (how rare or significant that word is across all alerts).

### **Pillar 2: The Vision Brain (The Visual Sensor)**
This brain uses live Highway 401 CCTV feeds to detect road surface texture that thermometers can miss, like slush versus clear asphalt. Images go through OpenCV normalization (224x224 resize, pixel scaling 0-1) before hitting a convolutional neural network.

**The Formula (Softmax Probability):**
$$V = \frac{e^{z_{hazard}}}{\sum_{j=1}^K e^{z_j}}$$

$V$ is the confidence score, from 0.0 to 1.0, that the current road image shows a hazard such as ice or snow.

### **Pillar 3: The Logistic Optimizer (The Decision Engine)**
This piece fuses all inputs to classify a road segment as safe or high risk. The method is Logistic Regression tuned with **GridSearchCV** and **Lasso (L1) Regularization**.

**The Model Equation:**
$$P(y=1) = \frac{1}{1 + e^{-(\beta_0 + \beta_1 T + \beta_2 V + \beta_3 E)}}$$

The $\beta_n$ terms are the learned weights. Lasso figures out which brain, NLP or Vision, is more reliable given the current weather, and zeros out the redundant sensor.

---

## **3. The Proprietary Safety Score Framework ($S$)**

To give the driver something actionable, we compute a composite Safety Score.

### **The Master Equation:**
$$S = \left( (w_T \cdot T) + (w_V \cdot V) + (w_E \cdot E_{index}) \right) \times 100$$

| Term | Meaning | Optimization Logic |
| :--- | :--- | :--- |
| **$w$ (Weights)** | Importance of each brain | Adjusted via **Lasso**. At night, $w_V$ (Vision) drops and $w_T$ (Text) rises. |
| **$E_{index}$** | Environmental Risk | A Min-Max scaled index of Temperature, Wind, and Visibility. |
| **$S$** | Final Score | A value from **0 (Safe)** to **100 (Extreme Hazard)**. |

### **The Dynamic Decision Table:**
| Safety Score ($S$) | Risk Category | Recommended Speed ($V_{rec}$) |
| :--- | :--- | :--- |
| **0 – 30** | Low Risk (Green) | 100% of Posted Limit (100-110 km/h) |
| **31 – 70** | Moderate (Yellow) | 80% of Posted Limit (e.g., 80 km/h) |
| **71 – 100** | High Risk (Red) | 60% of Posted Limit (e.g., 60 km/h) |

---

## **4. Data Acquisition and Work Breakdown (WBS)**

### **Data Samples (Python View):**
*   **Structured:** `[Temp: -12C, Wind: 40km/h, Visibility: 0.5km]`
*   **NLP Text:** `"Hwy 401 @ Milton: Black ice reported. Multi-vehicle collision."`
*   **Vision Matrix:** `array([[45, 210, 215], ...])` (high values mean white snow/ice)

### **8-Week Roadmap:**
1.  **Weeks 1-2 (Foundations):** Afolabi ingests Ontario Collision CSVs and builds the linear baseline.
2.  **Week 3 (NLP):** Team Member 2 builds the TF-IDF scraper for Ontario 511 text logs.
3.  **Week 4 (Vision):** Team Member 3 implements OpenCV normalization for live 401 camera URLs.
4.  **Week 5 (Neural Net):** Train the model to recognize "Icy" road textures from the Kaggle dataset.
5.  **Week 6 (Optimization):** Afolabi runs GridSearchCV to fuse all brains into the Logistic Model.
6.  **Week 7 (Evaluation):** Full group audit of the confusion matrix, optimizing for recall.
7.  **Week 8 (Live Demo):** Present the Smart-Shield Dashboard using live Highway 401 feeds.

---

## **5. Reliable References and Data Links**

### **Public Data Portals (Live Links):**
1.  **Hwy 401 Live Cameras:** [Ontario 511 Camera Feed](https://511on.ca/cameraview)
2.  **Weather API:** [Environment Canada Real-time XML](https://dd.weather.gc.ca/citypage_weather/xml/ON/)
3.  **Collision Records:** [Ontario Integrated Collision Data](https://data.ontario.ca/dataset/integrated-collision-data)
4.  **Visual Training Data:** [Kaggle: Road Surface Classification](https://www.kaggle.com/datasets/vipinmazumder/road-surface-classification)

### **Academic Citations (For Overleaf):**
*   **NLP Validation:** *Gu, Y. (2021). "Traffic Incident Detection from Social Media." Nature Scientific Reports.*
*   **Vision Validation:** *Pan, S. (2019). "Deep Learning for Road Weather Classification." IEEE Xplore.*
*   **Optimization Standards:** *Pedregosa, F. (2011). "Scikit-learn: Machine Learning in Python." JMLR.*

---

## **6. Success Metrics (KPIs)**
*   **Minimize Type II Errors:** the model must never miss an "Icy" event (Recall > 92%).
*   **Beat the Baseline:** the Multimodal model must beat the "Simple Regression" $R^2$ by at least 25%.
*   **Fairness:** the system should perform about equally well on rural (London) and urban (Toronto) highway segments.
"""

REWRITES[3] = r"""---

# Ontario Smart-Shield – Data Analysis Notebook

> **Version**: 2.0 (rebuilt for clean execution)
> **Structure**:
> - **Part I (Cells 0–2)**: Project Charter, Notebook Overview, Literature Review
> - **Part II (Cells 3–56)**: Full data science workflow, setup through EDA, stats, preprocessing, correlation, feature selection, modelling, and results

---

## Notebook Reading Guide

| Section | Cells | What it covers |
|---|---|---|
| 0 – Charter | 0 | Business case, 3-Brain architecture, Safety Score formula |
| 0b – Literature | 2 | Research alignment: Paper 1 (SPI) and Paper 2 (ML traffic) |
| 1 – Setup | 3–5 | Imports, data paths, load Toronto + DfT datasets |
| 2 – EDA | 6–13 | Schema, target engineering, distributions, DfT decode |
| 2c – Summary Stats | 14–18 | Paper 2 replication: weather/surface/lighting analysis |
| 2d – Safety Score | 19 | E_index weight design from literature |
| 3 – Preprocessing | 20–23 | Cleaning, encoding, feature engineering |
| 4 – Correlation | 24–29 | Pearson, chi-square, point-biserial |
| 5 – Feature Selection | 30–33 | chi², mutual info, RF voting → 8 final features |
| 6 – Vision Brain | 34–35 | Ontario road image sources and camera API |
| 8 – Modelling | 36–55 | Data prep, baselines, GridSearchCV, PyTorch DNN, comparison |
| 9 – Summary | 56 | Results summary and next steps |
"""

REWRITES[4] = r"""---

## Section 0b · Literature Review and Research Alignment

Two peer-reviewed papers shaped the design of this project. Their findings are summarised below and referenced throughout the notebook.

---

### Paper 1 · "Enhancing Safety in Autonomous Navigation: Weather-Aware Trajectory Planning"
**Pennino & D'Amato, 2024 IEEE MetroSea** *(University of Naples "Parthenope")*

> *Accessed via Sheridan Library – IEEE Xplore.*

#### What the paper does
The authors build an adaptive weather routing algorithm for autonomous ships. It picks the safest trajectory by minimising a composite **Seakeeping Performance Index (SPI)** under adverse sea and weather conditions. They compare two solvers: **Dijkstra** (fast, grid-based) and a **Genetic Algorithm** (more flexible, roughly 80% SPI improvement).

#### SPI Formula (Equation 1 in the paper)
$$SPI = \max\!\left(0;\; 1-\frac{RMS_{pitch}}{RMS_{pitch,\,lim}} \cdot
1-\frac{RMS_{roll}}{RMS_{roll,\,lim}} \cdot
1-\frac{RMS_{acc}}{RMS_{acc,\,lim}} \cdot
1-\frac{p_{sl}}{p_{sl,\,lim}} \cdot
1-\frac{p_{gw}}{p_{gw,\,lim}} \cdot
1-\frac{MSI}{MSI_{lim}} \right)$$

#### Key Results (Table 3 – Percentage Improvement Index)

| Criteria | Genetic Alg. (%) | Dijkstra (%) |
|---|---|---|
| RMS pitch | 1.9 | 0.5 |
| RMS roll | 8.8 | 19.1 |
| RMS vertical acceleration | 54.8 | 37.4 |
| Slamming probability | **69.7** | 4.2 |
| Probability of green water | **77.7** | 4.0 |
| Motion Sickness Index (MSI) | 27.2 | 38.1 |
| **Overall SPI** | **87.2** | **42.6** |

#### Relevance to Ontario Smart-Shield

| Concept in Paper 1 | Our Equivalent |
|---|---|
| Seakeeping Performance Index (SPI) | **Safety Score S** – same composite weighted formula |
| Multi-criteria thresholds (NATO STANAG) | Our 0-30 / 31-70 / 71-100 risk tiers |
| Adaptive route around hazards | Recommend speed reduction when S > 30 |
| Dijkstra on a spatial grid | Future: optimal highway segment routing on Ontario 400-series network |
| Genetic Algorithm for multi-objective optimisation | Future: GridSearchCV + L1 Lasso weight tuning |
| Dynamic GRIB weather inputs every 3h | Ontario 511 + Environment Canada XML (every 15 min) |

---

### Paper 2 · "Machine Learning-based Prediction Analysis of Traffic Accidents"
**Jiang, Miu & Wu, 2024** *(University of Sheffield / ICSPML Proceedings)*

> *Accessed via Sheridan Library. Uses the same SDOT + UK DfT datasets we have.*

#### What the paper does
The authors train Random Forest, K-NN, Decision Tree, LightGBM, and a Deep Neural Network (DNN) on the **SDOT (Seattle)** and **UK DfT** collision datasets, the exact same files sitting in our `Data/` folder, to predict accident severity.

#### Key Statistical Findings (Tables 2, 3, 4)

**Weather vs. Accident Severity** (mean persons involved):

| Weather | Mean Persons | Mean Vehicles |
|---|---|---|
| **Snowing** | **1.421** | **1.857** |
| Blowing Snow | 1.402 | 1.822 |
| Overcast | 1.385 | 1.651 |
| Raining | 1.304 | 1.790 |
| Clear | 1.285 | 1.852 |

**Road Surface vs. Severity** (mean persons):

| Road Condition | Mean Persons |
|---|---|
| **Standing Water** | **1.417** |
| Snow / Slush | 1.336 |
| Wet | 1.318 |
| Ice | 1.287 |
| Dry | 1.169 |

**Lighting vs. Severity** (mean persons):

| Lighting | Mean Persons |
|---|---|
| **Dusk** | **1.558** |
| Dark – No Street Lights | 1.473 |
| Dark – Lights Off | 1.389 |
| Daylight | 1.272 |

**Chi-Square Results** (all p < 0.01):

| Variable | chi² |
|---|---|
| JUNCTION TYPE | 10,925.2 |
| LIGHT COND. | 555.7 |
| WEATHER | 478.6 |
| ROAD COND. | 258.4 |

#### Model Benchmarks (our targets to beat or match)

| Model | Accuracy | Recall | F1 | AUC |
|---|---|---|---|---|
| Logistic Regression | ~0.79 | ~0.79 | ~0.79 | – |
| K-Nearest Neighbours | ~0.82 | ~0.82 | ~0.82 | – |
| Decision Tree | ~0.84 | ~0.84 | ~0.84 | – |
| **Random Forest** | **0.878** | **0.878** | **0.878** | **0.852** |
| **DNN** | **0.911** | **0.955** | **0.934** | 0.759 |

> Our primary target is to match or beat RF (0.878 accuracy) using only the
> Ontario-specific features. If Recall for the fatal class is at least 0.92, we satisfy
> the project KPI set in D2.

#### What We Do Differently
1. We use **Ontario-specific data** (Toronto TPS) rather than Seattle plus UK combined.
2. Our target is a **three-class ordinal variable** (Fatal / Injury / PD-only) instead of binary as in the paper.
3. We apply **Lasso L1 regularisation** for automatic feature zeroing, which the paper doesn't use.
4. We dynamically fuse NLP (T), Vision (V), and Environment (E) scores, where the
   paper only relies on static tabular features.
"""

REWRITES[7] = r"""---
## Run All - Start Here

Run cells top to bottom (Runtime → Run All, or Shift+Enter through each cell).

| Phase | Cells (approx.) | Time | Notes |
|-------|-----------------|------|-------|
| Setup | 1, 5 | 1–3 min | Installs packages; if torch was just installed, restart the kernel (Kernel → Restart) then rerun from cell 1 |
| Data + EDA | 7–20 | 2–5 min | Loads Toronto + DfT CSVs from `Data/` |
| Preprocess + stats | 23–34 | 2–3 min | |
| Vision Brain | 39–41 | 3–8 min | Downloads sample road images; needs `TORCH_OK=True` |
| Modelling | 44–64 | **20–45 min** | GridSearchCV is the slow step |
| Sprint 3 | 68–74 | 3–5 min | NLP, Safety Score, SHAP, save models |

**Requirements:** `Data/traffic collision data.csv` and `Data/UK Accidents 2024/` in the project folder.

**If a cell fails:** note the cell number, fix the error, then use **Run All Below** from the next cell. Don't restart the kernel unless torch was just installed.
"""

REWRITES[8] = r"""---

## Section 1 · Data Inventory

### Available datasets

| File | Source | Rows (approx.) | Key columns for this project |
|---|---|---|---|
| `traffic collision data.csv` | Toronto Police Service (TPS) | 768,000 | Date, hour, neighbourhood, injury/fatality flags, vehicle types |
| `dft-road-casualty-statistics-collision-2024.csv` | UK Dept. for Transport | 100,927 | `weather_conditions`, `road_surface_conditions`, severity |
| `dft-road-casualty-statistics-casualty-2024.csv` | UK DfT | 135,000 | Casualty severity, age, type |
| `SDOT_Collisions_All_Years.csv` | Seattle DOT | 270,000 | Road condition, junction type, weather |

### Strategy

1. **Toronto TPS** is the primary dataset for the Logistic Optimizer (Ontario collision events).
2. **UK DfT 2024** serves as an environmental reference: weather and road surface feed the E_index calibration.
3. **Seattle SDOT** is supplementary validation, since it's the same dataset used in Paper 2.
"""

REWRITES[10] = r"""---

## Section 2 · Exploratory Data Analysis – Toronto Collision Data

### 2.1 Schema and Data Quality

We inspect column types, missing values, and value ranges before doing any transformation. This tells us what needs encoding, what can be dropped, and where the target variable actually lives.
"""

REWRITES[12] = r"""### 2.2 Target Variable Engineering

The raw dataset uses separate flag columns (`FATALITIES`, `INJURY_COLLISIONS`, `PD_COLLISIONS`)
instead of a single severity field. We collapse these into an ordinal `SEVERITY` target:

| Code | Meaning | Business impact |
|---|---|---|
| `2` | **Fatal** – `FATALITIES > 0` | Highest risk; must be recalled at ≥ 92% |
| `1` | **Injury** – `INJURY_COLLISIONS == YES` | Medium risk |
| `0` | **Property Damage Only** | Lowest risk |

This mirrors the DfT `collision_severity` scale and maps onto our Safety Score tiers (Red / Yellow / Green).
"""

REWRITES[14] = r"""### 2.3 Distribution Plots

Temporal patterns show *when* the Smart-Shield system needs to be most alert.
"""

REWRITES[16] = r"""---

## Section 2b.1 · EDA – UK DfT 2024 Weather and Road Surface Reference

The DfT dataset stores numeric codes for road surface and weather conditions.
We decode them here to see what the **E_index** needs to distinguish, and to sanity-check
the CNN road-surface label scheme.

| Code | Road Surface | | Code | Weather |
|---|---|---|---|---|
| 1 | Dry | | 1 | Fine – no wind |
| 2 | Wet / Damp | | 2 | Raining |
| 3 | Snow | | 3 | Snowing |
| 4 | Frost / Ice | | 4 | Fine + high winds |
| 5 | Flood | | 5 | Raining + high winds |
| | | | 6 | Snowing + high winds |
| | | | 7 | Fog / Mist |
"""

REWRITES[18] = r"""## Section 2b.2 · EDA – Seattle SDOT Collision Data
"""

REWRITES[20] = r"""### Target Variable Engineering
The dataset has multiple columns describing collision results.

We combine these into a single `SEVERITY` column.

`2`: **Fatal**, when `FATALITIES > 0`

`1`: **Injury**, when `INJURY_COLLISIONS == YES`

`0`: Property Damage Only
"""

REWRITES[23] = r"""## Section 2b.3 · EDA – Merged Last 5 Years UK and SDOT Dataset
"""

REWRITES[26] = r"""### How "Unknown" and "Other" Weather Were Handled

In plain terms: we didn't delete crashes just because the weather was listed as Unknown or Other. Those rows stayed in the merged dataset. We treated them as their own labeled categories ("we don't know" / "other"), not as blank incomplete records to throw away.

**Technical treatment**

| Source | Original value | What we did | Code used in analysis |
|--------|----------------|-------------|------------------------|
| Seattle SDOT | `Unknown` | Mapped with the weather dictionary | **7** |
| Seattle SDOT | `Other`, Overcast, blanks / unmapped text, `NaN` after `.map()` | Not dropped; filled with `.fillna(0)` | **0** ("Other / Unmapped") |
| UK DfT (STATS19) | Weather code **8** (Other) | Kept as-is (already numeric) | **8** |
| UK DfT (STATS19) | Weather code **9** (Unknown) | Kept as-is | **9** |

Incomplete-data stance: true missing fields elsewhere can still be removed by `dropna()` after the merge. Weather Unknown/Other are **coded values**, so they survive that step and show up in EDA (see the Top 5 weather chart, for example). This is a **keep-and-code** approach, not imputation; we don't invent Clear or Rain out of Unknown.

One caveat worth flagging in the report: Seattle's "Other / blank / unmapped" rows mostly collapse to **0**, while UK Unknown/Other stay at **9 / 8**. The categories are only **roughly harmonized** across cities, and that should be stated clearly.
"""

REWRITES[29] = r"""---

## Section 2c · Summary Statistics – Replicating Paper 2 on Our Data

Jiang et al. (2024) reported mean casualties per collision under each environmental
condition on the combined SDOT+DfT dataset. We reproduce those tables on our
**DfT 2024** slice for three reasons: to check consistency with the published paper,
to calibrate E_index weights for the Safety Score, and to quantify the excess
casualty percentage per hazard type.

**Paper 2 headline benchmarks:**
- Snowing road surface: **+10.75%** excess casualties
- Standing water: **+10.44%**
- Dusk / insufficient lighting: **+13.01%**
"""

REWRITES[34] = r"""---

## Section 2d · Safety Score Design – Informed by Paper 1 (SPI)

### From Seakeeping Performance Index to Safety Score S

Paper 1 (Pennino & D'Amato, 2024) defines a composite **SPI**, clamped to [0,1],
built from six normalised safety criteria. Our **Safety Score S** follows the same
structure, adapted for highway road conditions:

$$S = (w_T \cdot T_{\text{NLP}}) + (w_V \cdot V_{\text{Vision}}) + (w_E \cdot E_{\text{index}}) \times 100$$

$$E_{\text{index}} = 0.35 \cdot\text{SurfaceRisk} + 0.30 \cdot\text{VisibilityRisk} + 0.20 \cdot\text{WindRisk} + 0.15 \cdot\text{TempRisk}$$

### Table A · E_index Weights, Grounded in Paper 2 Excess-Casualty Analysis

| Component | Paper 2 excess | Weight |
|---|---|---|
| Road surface hazard (snow/ice/flood) | +10.75% | **delta = 0.35** |
| Dusk / darkness (visibility) | +13.01% | **gamma = 0.30** |
| Snowing / blowing snow (wind) | +10.75% | **beta = 0.20** |
| Temperature (freeze risk proxy) | (none) | **alpha = 0.15** |

---

### Table B · Safety Score (S) Risk Tiers and Actions

| S range | Risk Tier | Action |
|---|---|---|
| 0 – 30 | LOW | Normal operations |
| 31 – 70 | MEDIUM | Reduce speed, increase following distance |
| 71 – 100 | HIGH | Alert dispatcher; consider route diversion |
"""

REWRITES[35] = r"""---

## Section 3 · Data Preprocessing

### 3.1 Toronto Dataset – Steps

| Step | Action | Reason |
|---|---|---|
| 1 | Drop rows missing key flag columns | Only 4 rows (~0.0005%); too few to impute safely |
| 2 | Fix zero coordinates (Gulf of Guinea) | (0,0) is geometrically invalid for Ontario analysis |
| 3 | Binary-encode YES/NO columns | Logistic Regression and RF need numeric input |
| 4 | Month name → numeric | January=1 … December=12 |
| 5 | Add season flag | Ontario winter (Dec–Mar) is the core Smart-Shield hazard period |
| 6 | Add IS_NIGHT and IS_RUSHHOUR | Binary distillations of the hour-of-day signal |
"""

REWRITES[38] = r"""### 3.2 UK DfT – Preprocessing for E_index

We pull the weather and road-surface columns into a clean reference frame
to calibrate the Environmental Risk Index.
"""

REWRITES[40] = r"""### 3.3 Merged UK and SDOT – Preprocessing

1. Time Format Correction and Date Features

The time column has mixed formats. Combining the date and time strings lets pandas parse them into a single datetime object, from which we extract the year, month, and day of week.
"""

REWRITES[42] = r"""2. Time Flag Creation

Machine learning models do better with simplified time categories, so this step creates binary flags for hazardous driving periods.
"""

REWRITES[44] = r"""3. Categorical Type Correction

This function cleans columns that store categories as decimal numbers. It removes missing data points and converts the values to integers.
"""

REWRITES[46] = r"""---

## Section 4 · Correlation Analysis

We use three complementary tests, each suited to a different variable type combination:

| Test | Variable types | What it measures |
|---|---|---|
| **Pearson** | numeric–numeric | Linear association |
| **Chi-square** | categorical–categorical (or binary) | Statistical independence |
| **Point-Biserial** | binary–continuous | Correlation when one variable is binary |
| **Cramér's V** | categorical–categorical | Effect size (0=none, 1=perfect) |

### 4.1 Pearson Correlation Heatmap
"""

REWRITES[48] = r"""Pedestrian and bicycle variables have the highest scores (0.314 and 0.227). Those numbers point to a moderate positive link with collision severity: accidents involving these groups are more likely to end in severe injury. Time variables (hours, months, seasons) sit close to zero, meaning there's almost no linear relationship between the exact time and how severe an accident is. Automobile involvement shows a small negative number; crashes involving only cars tend to be minor property-damage events.
"""

REWRITES[49] = r"""### 4.2 Chi-Square Test (Binary Features vs. Severity)

Chi-square checks whether categorical variables are **statistically independent** of
collision severity. Variables with p < 0.05 are considered associated with severity.
"""

REWRITES[51] = r"""All variables come back with significant p-values, effectively zero. That's not surprising: large datasets tend to produce very small p-values even for weak relationships, so statistical significance alone doesn't guarantee practical importance. The raw Chi2 numbers tell the real story. Pedestrian and bicycle flags score over 39,000, while time variables land between 657 and 1,700. That confirms vulnerable road users drive most of the severe outcomes in this model.
"""

REWRITES[52] = r"""### 4.3 Point-Biserial Correlation

1. DfT Weather Features

For the E_index, we check whether road hazard conditions correlate with severe outcomes
in the DfT dataset. Point-biserial is the right test here since one variable is binary.
"""

REWRITES[54] = r"""The UK reference dataset shows extremely weak connections for environmental factors.

**Important for the report:** `sig=YES` here just means *statistical* significance from a very large sample (hundreds of thousands of rows). The actual correlations are tiny (`|r| ≈ 0.005–0.086`), which is **not** evidence of a practically important effect. Cite the effect size (`r`) first, and don't overclaim from p-values alone.
"""

REWRITES[55] = r"""2. Merge UK and US Dataset
"""

REWRITES[57] = r"""### 1. Overview

Almost all p-values in this test are zero, which confirms these relationships aren't due to chance. The r-values measure how strong the connection actually is, and every score here falls below 0.20. That's a genuinely weak linear relationship between individual features and severe outcomes. Large samples often produce statistical significance even when the real predictive power is modest.

### 2. Feature Performance

Environmental factors perform best overall. `Light condition` (0.170) and `road condition` (0.126) are the strongest indicators in the group. `Weather` (0.075) and `junction type` (0.097) add some value too. The continuous hour variable is statistically useless here: its p value is 0.8401, well above the standard 0.05 threshold.

### 3. Model Recommendations

Drop the continuous hour column from the final training data since it carries **no linear** predictive value. Keep the binary time flags (night, rush hour) built earlier, since categorical groupings tend to capture these patterns better than raw continuous numbers. Retain all environmental variables.

Tree-based algorithms like `Random Forest` or `Gradient Boosting` are worth prioritizing here. Linear models like `Logistic Regression` struggle with correlation scores this low, while tree algorithms are good at finding complex interactions, such as bad lighting combined with bad weather driving severe accidents.
"""

REWRITES[58] = r"""---

## Section 5 · Feature Selection

**Decision rule**: a feature is selected if it ranks in the **top 8 in at least 2 of 3** selectors.

| Selector | Type | Strength |
|---|---|---|
| chi² SelectKBest | Filter | Non-linear dependency; fast |
| mutual_info SelectKBest | Filter | Detects arbitrary relationships |
| Random Forest importance | Embedded | Captures interactions; handles multicollinearity well |
"""

REWRITES[61] = r"""### 5.1 Feature Selection Rationale

All eight candidates received 3/3 votes and were kept.

**Honest framing:** we started from a **small, pre-filtered** feature set (time + mode flags already engineered in Section 3). This step **confirmed** that set; it did not prune a large pool. Treat it as validation of the candidate list, not aggressive feature elimination.
"""

REWRITES[62] = r"""---

## Section 6 · Vision Brain – Road Image Sources (Ontario Focus)

This section documents data sources for the CNN road-surface classifier (Pillar 2).

### 6.1 Primary – University of Waterloo iTSS Lab (Ontario)
- About **14,000 images** from 40 RWIS stations across Ontario highways
- **Labels**: Clear / Partially Snow-Ice Covered / Fully Snow-Ice Covered
- **Contact**: https://itsslab.com/ | GitHub: https://github.com/jmcarrillog/deep-learning-for-road-surface-condition

### 6.2 Live Feed – Ontario 511 CCTV
- Real-time JPEG frames from Highway 400/401 corridor cameras
- API: https://511on.ca/developers

### 6.3 Supplementary – HuggingFace RSCD-1M
- 1 million road images, 27 condition classes
- `pip install datasets` then `load_dataset("keremberke/road-surface-classification")`
"""

REWRITES[64] = r"""---
## Section 6 · Vision Brain: Sample Images and Fine-Tuning

**Goal:** show how the Vision Brain actually sees road conditions, then fine-tune a CNN on it.

| Step | What you will see |
|------|-------------------|
| **6.1** | Sample images: **Clear asphalt**, **Wet/Slush**, **Snow/Ice** |
| **6.2** | Fine-tune **ResNet18** (transfer learning) on road-surface images |
| **6.3** | Validation accuracy + confusion matrix, feeding the **V score** in Safety Score S |

**Data source:** HuggingFace `keremberke/road-surface-classification`, used as a proxy for Ontario RWIS cameras.  
Install once if needed: `pip install datasets torchvision`
"""

REWRITES[66] = r"""### 6.2 · Fine-Tune the Vision Model

**Limitation (worth stating in the report):** Section 6.1 lists real sources (UWaterloo iTSS at roughly 14k images, Ontario 511, HuggingFace RSCD). The training log below may fall back to a **small offline / synthetic** set when the cache is thin. Treat the Vision Brain as a **proof-of-concept** until real images are wired in end-to-end. Don't present the charter dataset sizes as what actually trained this run unless the log confirms it.
"""

REWRITES[68] = r"""---

## Section 8 · Model Training and Evaluation

### Process overview

| Step | What | Science |
|---|---|---|
| 8.1 | Data prep + SMOTE | Balances the rare Fatal class without data leakage |
| 8.2 | 5 baseline classifiers | Honest performance floor; no tuning |
| 8.3 | Dynamic GridSearchCV | Exhaustive hyperparameter search with stratified 5-fold CV |
| 8.4 | PyTorch DNN | Matches Jiang et al. (2024) architecture: 256→128→64→3 |
| 8.5 | Head-to-head comparison | All models ranked by Macro Recall, MCC, AUC, F1, Accuracy |
| 8.6 | Ontario live test cases | 5 realistic highway scenarios to stress-test the winner |
| 8.7 | Final selection | Quantitative + qualitative rationale; Safety Score integration |

---

### Primary evaluation metric

**Macro Recall** (a missed Fatal prediction is far costlier than a false alarm).
"""

REWRITES[69] = r"""### Section 8.1 · Data Preparation for Modelling

SMOTE is applied to the **training set only** (never the test set) to avoid
data leakage. The test set needs to reflect the real-world class distribution.
"""

REWRITES[71] = r"""### Section 8.1b · Fatal vs Not-Fatal Pilot (Stage A)

**Why this exists:** the charter KPI is Fatal recall of 0.92 or higher. A single 3-class model struggles here because Fatal makes up only about 0.1% of rows. Stage A asks a simpler safety question instead: **Fatal vs Not-Fatal**.

**What this cell does:** train Logistic Regression and Random Forest on the binary target, sweep the Fatal probability threshold, and report the best recall/precision trade-off. This is a **pilot toward the KPI**, not a claim that 0.92 is already met.

**This-run validation (GPU re-run):** LR Fatal-vs-Not at threshold 0.5 gives Fatal recall **1.00** (KPI met) and Fatal precision **0.0008**. High recall with very low precision means a lot of false alarms. Use this as a Stage A safety screen, not the final 3-class label.
"""

REWRITES[73] = r"""### Section 8.2 · Baseline Models

Five classifiers trained with **default settings** to establish the performance floor.

| Model | Inductive bias | Why included |
|---|---|---|
| Logistic Regression | Linear boundaries | Project deliverable (interpretable coefficients) |
| Decision Tree | Axis-aligned splits | Fast; shows the best splitting features |
| K-Nearest Neighbours | Local manifold | No distributional assumption |
| Random Forest | Random tree ensemble | Paper 2 benchmark target (87.8% acc) |
| LightGBM | Gradient boosting | Strong performer on tabular data |
"""

REWRITES[75] = r"""---

## Section 7 · AI Ethics and Fairness Audit

> **Why this matters**: Ontario Smart-Shield directly influences speed recommendations
> on public highways. A model that performs well on average but poorly for
> specific groups or geographies could actually increase road risk for
> vulnerable populations rather than reduce it. This section documents and measures four ethical obligations.

---

### 7.1 Ethical Risk Register

| Risk | Category | Likelihood | Impact | Mitigation in this project |
|---|---|---|---|---|
| Model ignores rare Fatal class | **Class bias** | High | Critical | SMOTE oversampling + class_weight="balanced" + Recall KPI ≥ 92% |
| Better performance in high-density urban areas | **Geographic bias** | Medium | High | Subgroup audit: urban vs. suburban/rural divisions |
| Night-time collisions under-represented | **Temporal bias** | Medium | Medium | `is_night` engineered feature; hour-of-day included |
| Model reflects historical policing patterns | **Systemic bias** | Medium | High | Disclosed; future work: fairness-aware reweighting |
| Opaque black-box recommendations | **Explainability** | Low-Med | Medium | Feature importances + SHAP values (Sprint 3) |

---

### 7.2 Fairness Metrics Defined

We measure **three complementary fairness criteria**:

| Criterion | Formula | Pass Threshold |
|---|---|---|
| **Equal Opportunity** (Fatal recall) | TP_fatal / (TP_fatal + FN_fatal) | ≥ 0.92 |
| **Demographic Parity** (per geography) | \|Acc_urban − Acc_rural\| | ≤ 0.05 |
| **Class Imbalance Ratio** | n_majority / n_minority | Disclosed; SMOTE applied |

---

### 7.3 Code: Class Imbalance Disclosure, Per-Class Recall, and Geographic Audit
"""

REWRITES[77] = r"""### Explainability vs Raw Recall (Selection Note)

In the fairness table above, **K-Nearest Neighbours** often posts the highest **PD-Only recall**, sometimes around 0.99. That means it catches almost every property-damage case, the majority class, but it still fails the Fatal KPI and is hard to explain to a safety officer.

**We still pick Random Forest (tuned) for the main 3-class deploy path**, for three reasons:
1. **Explainability**: SHAP shows which features pushed a prediction, our ethics deliverable.
2. **Paper 2 alignment**: a tree ensemble is directly comparable to the literature baseline.
3. **Audit story**: stakeholders can inspect feature impact, which KNN doesn't support.

So high PD-Only recall doesn't automatically mean chosen model. The chosen model is the **best explainable safety tool for this project**, with its limits disclosed.
"""

REWRITES[79] = r"""### Section 8.3 · Dynamic GridSearchCV

`StratifiedKFold(5)` makes sure the rare Fatal class shows up in every fold.
Scoring uses `f1_macro`, which penalises missed Fatal events as heavily as missed PD-Only ones.

**L1 (Lasso) vs L2 (Ridge) in Logistic Regression:** L1 zeroes out irrelevant features, giving automatic feature selection and a sparse, interpretable model. L2 shrinks all coefficients but keeps every feature. GridSearch finds the optimal trade-off between the two.
"""

REWRITES[82] = r"""### Section 8.3c · Confusion Matrices (All Tuned Models)

Each model shows **two** matrices side by side: raw prediction counts **without normalization**, and row percentages **with normalization** (recall per true class, useful under class imbalance).
"""

REWRITES[84] = r"""### Variable Aliases – Backward Compatibility
These aliases make sure downstream cells work regardless of which GridSearchCV
variable naming style is in use (`rf_grid.best_estimator_` or `best_estimators[...]`).
"""

REWRITES[86] = r"""### Section 8.4 · PyTorch Deep Neural Network

Architecture (Jiang et al., 2024 Table 6):
```
Input(8) → Dense(256)+BN+ReLU+Dropout(0.3)
         → Dense(128)+BN+ReLU+Dropout(0.3)
         → Dense(64)+BN+ReLU+Dropout(0.3)
         → Dense(3) → Softmax
```
Paper 2's result on SDOT+DfT was **Accuracy=91.12%, Recall=95.5%**, our benchmark target.

> If PyTorch couldn't load (OSError/WinError 182), `TORCH_OK=False` and this
> section is skipped cleanly. All sklearn models still run.
"""

REWRITES[93] = r"""### Section 8.5 · Head-to-Head Model Comparison

**Metric ranking (most important → least):**
1. **Macro Recall**: catches Fatal events; the error cost is asymmetric
2. **MCC**: the most reliable single metric under class imbalance
3. **AUC**: threshold-independent discrimination
4. **Macro F1**: balances precision and recall
5. **Accuracy**: least informative given the imbalance here

**Paper 2 benchmark (red dashed line):** RF accuracy = 0.878
"""

REWRITES[95] = r"""### Section 8.6 · Live Test Cases – Ontario Highway Scenarios

Five realistic Ontario scenarios stress-test boundary conditions.
TC-2 and TC-5 **need** to be classified as Fatal-risk (class 2) for the model to
meet the project KPI of Recall ≥ 0.92 on fatal events.

| # | Scenario | Expected | Key risk factors |
|---|---|---|---|
| TC-1 | Clear summer afternoon, 401 rush hour | Injury (1) | IS_RUSHHOUR=1 |
| TC-2 | Blizzard at 2am, Hwy 400, pedestrian struck | **Fatal (2)** | IS_NIGHT=1, PED=1, Jan |
| TC-3 | Wet dawn, bicycle involved, off-rush | Injury (1) | BICYCLE=1, Apr |
| TC-4 | Clear Sunday morning, Hwy 115 | PD-Only (0) | Low-risk profile |
| TC-5 | Ice storm rush hour, QEW, Feb 5pm | **Fatal (2)** | IS_RUSHHOUR=1, Feb |
"""

REWRITES[97] = r"""### Section 8.7 · Final Model Selection and Rationale

**Honest reading of our own tables:** the best MCC in the full comparison typically goes to **K-Nearest Neighbours**, not Random Forest. PD-Only recall can also look strongest for KNN, often around 0.99, but that's the easy majority class, not the safety KPI.

**Random Forest (tuned)** is still our deployment and explainability pick. We can open the model with **SHAP**, compare it to Paper 2, and show *why* a prediction moved in a particular direction. KNN doesn't support that story well. We're **not** claiming RF "won" on PD-Only recall or MCC; we're choosing it for **explainability and auditability**.

One known limitation: Fatal-class failure. RF's Fatal precision can sit near 0.00 on the held-out test set under this level of imbalance. Stage A (Fatal vs Not, above) is the actual path toward the 0.92 recall KPI.

**Decision matrix (weighted scoring, qualitative):**

| Criterion | Weight | LR L1 | RF (tuned) | LightGBM | DNN | KNN |
|---|---|---|---|---|---|---|
| Macro / Fatal safety signal | 40% | Medium | Medium | Medium | High | Low (Fatal recall often ~0) |
| MCC (overall ranking) | 25% | Low | Low–Med | Med | Med | **Highest in table** |
| Interpretability / SHAP | 20% | **Yes** | **Partial (SHAP)** | Partial | No | Low |
| Paper 2 benchmark fit | 15% | Partial | **Yes** | Partial | No | No |

**Final decisions:**
- **Deploy (3-class):** Random Forest (tuned), chosen for explainability (SHAP) and Paper 2 benchmark fit, even though KNN leads on PD-Only recall and MCC
- **Safety pilot (Stage A):** the Fatal vs Not model from §8.1b, tracking Fatal recall against the 0.92 KPI
- **Oracle:** PyTorch DNN, used optionally when RF confidence is low on high-risk cases
- **Audit/Report:** Logistic Regression L1, for auditable coefficients in the ethics deliverable

**Must disclose:** class imbalance (Fatal is well under 1%), the Stage A precision/recall trade-off, and that 0.92 may remain unmet with the current features.

**This-run validation:** the best baseline MCC is **KNN (0.382)**; tuned LightGBM MCC is **0.166**, RF Tuned is **0.164**. RF is retained for explainability (SHAP), Paper 2 alignment, and deployment packaging, not because it led PD-Only recall or MCC (KNN often does). On CUDA, the DNNs scored MLP MCC 0.172, Tabular ResNet 0.173, GLU 0.163.
"""

REWRITES[99] = r"""---
## Section 9 · Summary and Sprint Progress

### Completed in this notebook

| Sprint | Deliverable | Section |
|--------|-------------|---------|
| Sprint 1–2 | EDA, stats, preprocessing, feature selection | 1–5 |
| Sprint 2 | Baselines, GridSearchCV, DNN, comparison | 8 |
| Sprint 2 | Vision Brain sample images + CNN fine-tune | 6 |
| Sprint 2 | Ethics audit + confusion matrices | 7, 8.3c |
| **Sprint 3** | NLP Brain TF-IDF | **10.1** |
| **Sprint 3** | Safety Score fusion + dashboard | **10.2** |
| **Sprint 3** | SHAP explainability | **10.3** |
| **Sprint 3** | Model deployment (joblib) | **10.4** |

### Future work (Sprint 4+)
- Live Ontario 511 API feed, replacing the sample alerts
- Production dashboard (Streamlit or Flask)
- Real-time camera frame ingestion from 511on.ca
"""

REWRITES[100] = r"""---
# Section 10 · Sprint 3: Multimodal Fusion and Deployment

Sprint 3 completes the **3-Brain architecture**:

| Pillar | Module | Output |
|--------|--------|--------|
| **1 NLP Brain** | TF-IDF on Ontario 511 alerts | `T` score (text hazard) |
| **2 Vision Brain** | ResNet18 (Section 6) | `V` score (snow/ice probability) |
| **3 Logistic Optimizer** | Tuned RF (Section 8) | Severity classification |
| **Fusion** | Safety Score formula | `S` → speed recommendation |

Also included: **SHAP explainability** and **model serialization** for deployment.
"""

REWRITES[101] = r"""### 10.1 · NLP Brain: TF-IDF Alert Scoring

Ontario 511 alerts are unstructured text. We tokenize them, apply **TF-IDF**, and sum
weights against a hazard lexicon (ice, blizzard, collision, closed, and so on) to produce **T ∈ [0, 1]**.
"""

REWRITES[103] = r"""### 10.2 · Safety Score Fusion (T + V + E → S)

$$S = (w_T \cdot T + w_V \cdot V + w_E \cdot E_{index}) \times 100$$

| Tier | S range | Recommended speed |
|------|---------|-------------------|
| LOW | 0–30 | 100% of posted limit |
| MEDIUM | 31–70 | 80% |
| HIGH | 71–100 | 60% |
"""

REWRITES[105] = r"""### 10.3 · SHAP Explainability (Sprint 3 Ethics Deliverable)

**SHAP** (SHapley Additive exPlanations) shows how each feature pushes the
Random Forest prediction toward Fatal, Injury, or PD-Only. This is required for the
explainability row in the Ethics Risk Register.
"""

REWRITES[107] = r"""### 10.4 · Model Deployment

Serialize the tuned Random Forest and scaler for the Smart-Shield API / dashboard backend.
"""

REWRITES[109] = r"""## Run Validation Report (GPU re-run · 2026-07-23)

This section checks that the numbers and plots from the latest full run actually make sense, written in plain English with the technical terms in parentheses.

### 1. Did we use the right data?
- **Check:** printed the line `DATA PROVENANCE OK`
- **Result:** modeling used `TorontoCollisionData.csv` / `df_model` with **809,030** feature rows (8 features).
- **Class mix:** PD-Only 698,656 (86.4%), Injury 109,712 (13.6%), Fatal **662 (0.1%)**.
- **Train/test:** 647,224 / 161,806; after SMOTE on train → **1,676,775** rows.
- **Meaning:** EDA and modeling now share one Toronto source, so there's no split-file mismatch. Fatal is still extremely rare (**class imbalance**), so any Fatal metric needs careful reading.

### 2. Vision Brain (GPU)
- **Device:** `cuda` on an **NVIDIA A100-SXM4-80GB** (about 24 GiB free at the start).
- **Training:** ResNet18 fine-tune, 8 epochs, finished in about **91 s** on GPU.
- **Validation accuracy:** **87.45%** on the small proof-of-concept image set.
- **Plot to look at:** training loss/accuracy curves plus the confusion matrix (green).
- **Caveat:** this is still a **proof-of-concept** run (offline/synthetic cache), not the full charter image corpus. Treat V-scores as demo inputs to Safety Score **S**, not production-grade numbers.

### 3. Stage A: Fatal vs Not-Fatal (safety pilot)
- **Model:** Logistic Regression (`LR Fatal-vs-Not`)
- **Operating point:** threshold **0.5**
- **Fatal recall (sensitivity):** **1.0000** → charter KPI ≥0.92 is **met** at this binary stage
- **Fatal precision:** **0.0008** → almost every positive alert is a false alarm (a classic **precision-recall trade-off**)
- **How to read it:** Stage A is good at not missing Fatal cases, but it cries wolf constantly. It's useful as a high-recall safety screen, not as a final 3-class decision on its own. Artifact saved: `models/fatal_vs_not_stage_a.joblib`.

### 4. Three-class baselines (Injury / PD / Fatal)
| Model | Accuracy | Macro F1 | MCC | Note |
|------:|---------:|---------:|----:|------|
| Logistic Regression | 0.784 | 0.352 | 0.149 | solid calibration-ish baseline |
| Decision Tree | 0.769 | 0.383 | 0.165 | |
| **K-Nearest Neighbours** | **0.886** | **0.429** | **0.382** | **best MCC** |
| Random Forest | 0.767 | 0.383 | 0.164 | kept for SHAP / Paper 2 |
| LightGBM | 0.787 | 0.387 | 0.177 | |

- **Best baseline by MCC:** KNN, not RF.
- **Fatal class on the KNN test report:** precision ≈ 0.00, recall ≈ 0.00 (support 132). The 3-class models still fail at Fatal discrimination.
- **Plots:** baseline comparison charts and per-class confusion views in Section 8.2.

### 5. Ethics / fairness audit
- **Geographic parity:** **incomplete / skipped** (`geo_audit_ok=False`) due to a feature-width mismatch (10 vs 8) that blocked the subgroup check.
- **Honest headline:** no *3-class* model in that audit cell met Fatal recall ≥0.92. Stage A is the separate binary path that does.

### 6. Tuned sklearn models (GridSearchCV)
- **Search time:** **5.3 min** (after fixing nested `n_jobs` thrashing).
- **Tuned results (test):**
  - LR Tuned: Acc 0.782, MCC **0.148**, AUC-OvR 0.661
  - RF Tuned: Acc 0.767, MCC **0.164**, AUC-OvR 0.600
  - LightGBM Tuned: Acc 0.771, MCC **0.166**, AUC-OvR 0.607
- **Plots:** tuned confusion matrices (Section 8.3c).
- **Selection note:** RF remains the explainability/deployment workhorse, while KNN still wins on raw MCC among the baselines.

### 7. Deep nets (all on GPU / `PyTorch device : cuda`)
| Architecture | Acc | Macro Recall | Macro F1 | MCC | Early stop |
|--------------|----:|-------------:|---------:|----:|-----------:|
| Simple MLP | 0.785 | 0.493 | 0.382 | 0.172 | epoch 35 |
| Tabular ResNet | 0.798 | 0.549 | 0.374 | 0.173 | epoch 14 |
| Gated Linear Unit | 0.799 | 0.581 | 0.358 | 0.163 | epoch 31 |

- **Fatal recall on the DNNs (test):** roughly **0.44 → 0.61 → 0.74** across the three networks, but precision stays around **0.00–0.01** (plenty of false Fatal alarms).
- **Plots:** DNN training curves + confusion matrices in Section 8.4.

### 8. Fusion, SHAP, deployment
- **NLP T-scores:** clear days score near 0.0; blizzard scores 0.69; ice storm hits **1.00**.
- **Safety Score S:** TC-2 / TC-5 land in the **HIGH** tier (S≈87 / 86); clear scenarios stay **LOW**.
- **SHAP:** bee-swarm/summary plots for PD-Only, Injury, Fatal on 500 test rows, useful for explaining what pushes and pulls RF predictions.
- **Saved artifacts:** `rf_tuned.joblib`, `dnn_smart_shield.pt`, `vision_resnet18.pt`, `fatal_vs_not_stage_a.joblib`, plus the scaler and feature list.

### 9. Visual checklist (31 PNG figures in this notebook)
Confirm you can see plots for EDA distributions, feature importance, vision training + confusion matrix, baseline/tuned confusion matrices, DNN curves/confusion matrices, the Safety Score dashboard, and SHAP summaries. If a figure is missing after opening the notebook, re-run just that section.

### 10. Bottom line
1. **GPU path works** (vision + all three DNNs on the A100).
2. **Data integrity fixed** (one Toronto file, no split mismatch).
3. **Stage A hits the Fatal recall KPI**, but with tiny precision.
4. **KNN has the best MCC** among 3-class baselines; RF kept for explainability.
5. **Geo fairness is still incomplete**: don't claim it as done.
"""

# ---------------------------------------------------------------------------
# Light cleanup of decorative "banner" comments in code cells.
# We only touch lines that are pure box-drawing decoration (e.g.
# "# ── 8.2  Baseline Models ──────"), turning them into short plain
# comments. Ordinary why-comments are left untouched.
# ---------------------------------------------------------------------------

_BANNER_RE = re.compile(r"^(?P<indent>\s*)#\s*[─=]{2,}\s*(?P<text>.*?)\s*[─=]{2,}\s*$")


def _shorten_banner(line: str) -> str:
    match = _BANNER_RE.match(line)
    if not match:
        return line
    text = match.group("text").strip()
    if not text:
        return line
    text = re.sub(r"\s+", " ", text)
    return f"{match.group('indent')}# {text}"


def clean_code_comments(source: str) -> str:
    lines = source.split("\n")
    return "\n".join(_shorten_banner(line) for line in lines)


def main() -> None:
    with open(NOTEBOOK_PATH, "r", encoding="utf-8") as fh:
        nb = json.load(fh)

    md_updated = 0
    code_updated = 0

    for idx, cell in enumerate(nb["cells"]):
        if cell["cell_type"] == "markdown" and idx in REWRITES:
            new_source = REWRITES[idx]
            cell["source"] = new_source.splitlines(keepends=True)
            md_updated += 1
        elif cell["cell_type"] == "code":
            old_source = "".join(cell["source"])
            new_source = clean_code_comments(old_source)
            if new_source != old_source:
                cell["source"] = new_source.splitlines(keepends=True)
                code_updated += 1

    with open(NOTEBOOK_PATH, "w", encoding="utf-8") as fh:
        json.dump(nb, fh, indent=1, ensure_ascii=False)
        fh.write("\n")

    print(f"Markdown cells rewritten: {md_updated} / {len(REWRITES)} entries in REWRITES")
    print(f"Code cells with banner comments cleaned: {code_updated}")


if __name__ == "__main__":
    main()
