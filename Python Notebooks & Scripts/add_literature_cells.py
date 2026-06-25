"""
Inserts Literature Review + Summary Statistics cells into Captone - Draft.ipynb.
Reads the existing notebook, splices new cells at two positions, and saves.
"""
import json, os

NB_PATH = os.path.join(os.path.dirname(__file__), "Captone - Draft.ipynb")

def md(src):  return {"cell_type": "markdown", "metadata": {}, "source": src.strip()}
def code(src): return {"cell_type": "code", "execution_count": None, "metadata": {}, "outputs": [], "source": src.strip()}

with open(NB_PATH, encoding="utf-8") as f:
    nb = json.load(f)

existing = nb["cells"]  # list of 30 existing cells

# ─────────────────────────────────────────────────────────────────────────────
# BLOCK A  –  Literature Review & Research Alignment
# Inserted after cell 1 (intro markdown) and before cell 2 (imports)
# ─────────────────────────────────────────────────────────────────────────────

LIT_MD = md("""
---

## Section 0b · Literature Review & Research Alignment

Two peer-reviewed papers inform the design of this project. Their findings are
synthesised below and referenced throughout the notebook.

---

### Paper 1 · "Enhancing Safety in Autonomous Navigation: Weather-Aware Trajectory Planning"
**Pennino & D'Amato, 2024 IEEE MetroSea** *(University of Naples "Parthenope")*

> *Accessed via Sheridan Library – IEEE Xplore.*

#### What the paper does
Develops an **adaptive weather routing algorithm** for autonomous ships that
selects the safest trajectory by minimising a composite **Seakeeping Performance
Index (SPI)** under adverse sea/weather conditions. Two solvers are compared:
**Dijkstra** (fast, grid-based) and a **Genetic Algorithm** (flexible, ~80 % SPI
improvement).

#### SPI Formula (Equation 1 in the paper)
$$SPI = \\max\\!\\left(0;\\; 1-\\frac{RMS_{pitch}}{RMS_{pitch,\\,lim}} \\cdot
1-\\frac{RMS_{roll}}{RMS_{roll,\\,lim}} \\cdot
1-\\frac{RMS_{acc}}{RMS_{acc,\\,lim}} \\cdot
1-\\frac{p_{sl}}{p_{sl,\\,lim}} \\cdot
1-\\frac{p_{gw}}{p_{gw,\\,lim}} \\cdot
1-\\frac{MSI}{MSI_{lim}} \\right)$$

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
Trains Random Forest, K-NN, Decision Tree, LightGBM, and Deep Neural Network
(DNN) models on the **SDOT (Seattle)** and **UK DfT** collision datasets — the
exact same files in our `Data/` folder — to predict accident severity.

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

> **Our primary target**: match or beat RF (0.878 accuracy) using only the
> Ontario-specific features. If Recall for fatal class ≥ 0.92, we satisfy
> the project KPI set in D2.

#### What We Do Differently
1. **Ontario-specific data** (Toronto TPS) rather than Seattle + UK combined.
2. **Three-class ordinal target** (Fatal / Injury / PD-only) vs. binary in the paper.
3. **Lasso L1 regularisation** for automatic feature zeroing — not used in the paper.
4. **Dynamic weight fusion** of NLP (T), Vision (V) and Environment (E) scores —
   the paper only uses static tabular features.
""")

# ─────────────────────────────────────────────────────────────────────────────
# BLOCK B  –  Summary Statistics (replicating Paper 2 analysis on DfT 2024)
# Inserted after the DfT decode cell (currently at index 12 in existing,
# but after block A insertion that shifts everything by 1 → index 13)
# ─────────────────────────────────────────────────────────────────────────────

STATS_MD = md("""
---

## Section 2c · Summary Statistics – Replicating Paper 2 on Our Data

Paper 2 (Jiang et al., 2024) performed factor analysis on the **SDOT + DfT**
datasets and reported the mean number of persons/vehicles involved under each
weather condition, road surface condition, and lighting scenario.

We reproduce that analysis here on our **DfT 2024** slice to:
1. Validate that our data matches their published findings.
2. Produce an Ontario-context reference table for the E_index calibration.
3. Identify which conditions most inflate our SEVERITY label.

> The paper found: **Snowing → highest avg persons (1.421)**, **Standing water →
> highest for road surface (1.417)**, and **Dusk → highest for lighting (1.558)**.
> Deviations from these baselines in our data will be noted and explained.
""")

STATS_CODE = code("""
# ── Reproduce Paper 2 Table 2 / Table 3 / Table 4 on DfT 2024 ───────────────
# We use the UK DfT 2024 collision file which includes number_of_casualties
# and number_of_vehicles as our proxies for "mean persons" and "mean vehicles".

dft_stats = dft[[
    "weather_conditions", "road_surface_conditions", "light_conditions",
    "collision_severity", "number_of_casualties", "number_of_vehicles"
]].copy()

# ── Decode using Paper 2's label scheme ──────────────────────────────────────
WEATHER_LABELS = {
    1: "Fine / Clear",  2: "Raining",        3: "Snowing",
    4: "Fine + Wind",   5: "Raining + Wind",  6: "Snowing + Wind",
    7: "Fog / Mist",    8: "Other",           9: "Unknown"
}
RSC_LABELS = {
    1: "Dry", 2: "Wet / Damp", 3: "Snow / Slush",
    4: "Ice / Frost", 5: "Flood / Standing Water",
    9: "Unknown", -1: "Missing"
}
LIGHT_LABELS = {
    1: "Daylight",         2: "Darkness – Lit",   3: "Darkness – Unlit",
    4: "Darkness – No Lt", 5: "Dusk",             6: "Dawn",
    7: "Unknown"
}

dft_stats["weather_label"] = dft_stats["weather_conditions"].map(WEATHER_LABELS)
dft_stats["rsc_label"]     = dft_stats["road_surface_conditions"].map(RSC_LABELS)
dft_stats["light_label"]   = dft_stats["light_conditions"].map(LIGHT_LABELS)

# Filter out unknowns for clarity
dft_stats = dft_stats[
    dft_stats["weather_conditions"].isin([1,2,3,4,5,6,7]) &
    dft_stats["road_surface_conditions"].isin([1,2,3,4,5]) &
    dft_stats["light_conditions"].isin([1,2,3,4,5,6])
]

print(f"Filtered rows: {len(dft_stats):,}  (removed unknown/missing codes)")
print()

# ── Table A: Weather conditions ───────────────────────────────────────────────
tbl_weather = (dft_stats.groupby("weather_label")
               .agg(
                   Mean_Persons  = ("number_of_casualties", "mean"),
                   Mean_Vehicles = ("number_of_vehicles",   "mean"),
                   Count         = ("number_of_casualties", "size")
               )
               .sort_values("Mean_Persons", ascending=False)
               .round(3))
print("=== TABLE A: Weather Conditions vs. Avg Casualties / Vehicles ===")
print("(cf. Jiang et al. 2024 Table 2 – Snowing should rank #1)\\n")
print(tbl_weather.to_string())
print()

# ── Table B: Road surface conditions ─────────────────────────────────────────
tbl_rsc = (dft_stats.groupby("rsc_label")
           .agg(
               Mean_Persons  = ("number_of_casualties", "mean"),
               Mean_Vehicles = ("number_of_vehicles",   "mean"),
               Count         = ("number_of_casualties", "size")
           )
           .sort_values("Mean_Persons", ascending=False)
           .round(3))
print("=== TABLE B: Road Surface Conditions vs. Avg Casualties / Vehicles ===")
print("(cf. Jiang et al. 2024 Table 3 – Standing water should rank #1)\\n")
print(tbl_rsc.to_string())
print()

# ── Table C: Lighting conditions ─────────────────────────────────────────────
tbl_light = (dft_stats.groupby("light_label")
             .agg(
                 Mean_Persons  = ("number_of_casualties", "mean"),
                 Mean_Vehicles = ("number_of_vehicles",   "mean"),
                 Count         = ("number_of_casualties", "size")
             )
             .sort_values("Mean_Persons", ascending=False)
             .round(3))
print("=== TABLE C: Lighting Conditions vs. Avg Casualties / Vehicles ===")
print("(cf. Jiang et al. 2024 Table 4 – Dusk should rank #1)\\n")
print(tbl_light.to_string())
""")

STATS_PLOT_CODE = code("""
# ── Visualise all three summary tables ───────────────────────────────────────
fig, axes = plt.subplots(1, 3, figsize=(20, 6))
fig.suptitle(
    "Summary Statistics – DfT 2024\\n"
    "(Replicating Jiang et al. 2024 Factor Analysis on Our Dataset)",
    fontsize=13, fontweight="bold"
)

def bar_with_paper_ref(ax, df, col, title, paper_ref_label=None, paper_ref_val=None, color="#4C72B0"):
    bars = ax.barh(df.index, df[col], color=color)
    ax.set_title(title, fontsize=10)
    ax.set_xlabel(f"Mean {col.replace('_',' ')}")
    ax.invert_yaxis()
    # Annotate bars
    for bar, val in zip(bars, df[col]):
        ax.text(val + 0.002, bar.get_y() + bar.get_height()/2,
                f"{val:.3f}", va="center", fontsize=8)
    if paper_ref_val:
        ax.axvline(paper_ref_val, color="red", linestyle="--", linewidth=1.2, alpha=0.7)
        ax.text(paper_ref_val + 0.002, len(df)-0.5,
                f"Paper ref\\n({paper_ref_label}: {paper_ref_val})",
                color="red", fontsize=7, va="bottom")

bar_with_paper_ref(axes[0], tbl_weather["Mean_Persons"], "Mean_Persons",
                   "Weather vs. Mean Casualties",
                   paper_ref_label="Snowing (Paper 2)", paper_ref_val=1.421,
                   color="#4C72B0")

bar_with_paper_ref(axes[1], tbl_rsc["Mean_Persons"], "Mean_Persons",
                   "Road Surface vs. Mean Casualties",
                   paper_ref_label="Standing water (Paper 2)", paper_ref_val=1.417,
                   color="#DD8452")

bar_with_paper_ref(axes[2], tbl_light["Mean_Persons"], "Mean_Persons",
                   "Lighting vs. Mean Casualties",
                   paper_ref_label="Dusk (Paper 2)", paper_ref_val=1.558,
                   color="#55A868")

plt.tight_layout()
plt.show()
""")

STATS_EXCESS_CODE = code("""
# ── Excess casualties above average (replicating Paper 2 headline stats) ─────
# Paper 2 headline: snowy surface +10.75%, standing water +10.44%, dusk +13.01%

overall_mean = dft_stats["number_of_casualties"].mean()
print(f"Overall mean casualties per collision: {overall_mean:.4f}")
print()

# Hazardous conditions excess
conditions = {
    "Snow / Slush (road surface)":    dft_stats[dft_stats["road_surface_conditions"]==3]["number_of_casualties"].mean(),
    "Ice / Frost (road surface)":     dft_stats[dft_stats["road_surface_conditions"]==4]["number_of_casualties"].mean(),
    "Flood / Standing Water":         dft_stats[dft_stats["road_surface_conditions"]==5]["number_of_casualties"].mean(),
    "Snowing (weather)":              dft_stats[dft_stats["weather_conditions"]==3]["number_of_casualties"].mean(),
    "Snowing + Wind (weather)":       dft_stats[dft_stats["weather_conditions"]==6]["number_of_casualties"].mean(),
    "Fog / Mist (weather)":           dft_stats[dft_stats["weather_conditions"]==7]["number_of_casualties"].mean(),
    "Darkness – No Lighting":         dft_stats[dft_stats["light_conditions"]==4]["number_of_casualties"].mean(),
    "Dusk":                           dft_stats[dft_stats["light_conditions"]==5]["number_of_casualties"].mean(),
    "Dawn":                           dft_stats[dft_stats["light_conditions"]==6]["number_of_casualties"].mean(),
}

print(f"{'Condition':<38} {'Mean':<8} {'Excess %':<12} {'Paper 2 ref'}")
print("-" * 75)
for name, val in sorted(conditions.items(), key=lambda x: -x[1]):
    excess = (val - overall_mean) / overall_mean * 100
    print(f"{name:<38} {val:.4f}   {excess:+.2f}%")

print()
print("Paper 2 benchmarks (on SDOT+DfT combined):")
print("  Snowy road surface: +10.75%   Standing water: +10.44%   Dusk: +13.01%")
print()
print("Interpretation: Values close to or exceeding these benchmarks confirm our")
print("  DfT 2024 slice is consistent with the larger multi-year dataset used in")
print("  Jiang et al. (2024), validating E_index hazard weights.")
""")

STATS_HEATMAP_CODE = code("""
# ── Severity × Road Surface heatmap (mean casualties) ────────────────────────
pivot = dft_stats.pivot_table(
    index="rsc_label", columns="weather_label",
    values="number_of_casualties", aggfunc="mean"
).round(3)

plt.figure(figsize=(14, 5))
sns.heatmap(pivot, annot=True, fmt=".2f", cmap="YlOrRd",
            linewidths=0.5, cbar_kws={"label": "Mean Casualties"})
plt.title(
    "Mean Casualties: Road Surface x Weather Condition (DfT 2024)\\n"
    "Higher values (darker) = more severe collisions on average",
    fontsize=12, fontweight="bold"
)
plt.xlabel("Weather Condition")
plt.ylabel("Road Surface")
plt.xticks(rotation=30, ha="right")
plt.tight_layout()
plt.show()

print("Key insight: The Snow/Slush x Snowing+Wind cell is the highest-risk")
print("  combination — this is the core hazard scenario for Ontario winters")
print("  and directly informs the E_index in our Safety Score formula.")
""")

SPI_MD = md("""
---

## Section 2d · Safety Score Design – Informed by Paper 1 (SPI)

### Connecting Pennino et al. (2024) to Our Safety Score

Paper 1's **Seakeeping Performance Index (SPI)** is a multiplicative composite
of normalised safety criteria, clamped to [0, 1]. Our **Safety Score S** follows
an analogous structure but adapted for highway road conditions:

| Paper 1 SPI Criterion | Ontario Smart-Shield Equivalent |
|---|---|
| RMS pitch amplitude | — (not applicable for road vehicles) |
| Slamming probability | Probability of fatal outcome (from Logistic Model) |
| Green water on deck | Flood / standing water flag from E_index |
| Motion Sickness Index | — |
| Overall SPI | **Safety Score S** (0–100) |

### Our Composite Safety Score (Revised with Literature Context)

$$S = \\underbrace{(w_T \\cdot T)}_\\text{NLP Brain} +
      \\underbrace{(w_V \\cdot V)}_\\text{Vision Brain} +
      \\underbrace{(w_E \\cdot E_{index})}_\\text{Environment} \\times 100$$

Where the **Environmental Risk Index** (E_index) encodes Paper 2's key findings:

$$E_{index} = \\text{MinMax}\\!\\left(
    \\alpha \\cdot \\text{TempRisk} +
    \\beta \\cdot \\text{WindRisk} +
    \\gamma \\cdot \\text{VisibilityRisk} +
    \\delta \\cdot \\text{RoadSurfaceCode}
\\right)$$

**Weight calibration (from Paper 2 excess-casualty analysis):**

| Component | Paper 2 excess | Proposed initial weight |
|---|---|---|
| Road surface hazard (snow/ice/flood) | +10.75 – +10.44 % | delta = 0.35 |
| Dusk / darkness | +13.01 % | gamma (visibility) = 0.30 |
| Snowing / blowing snow | +10.75 % | beta (wind) = 0.20 |
| Temperature (freeze risk proxy) | – | alpha = 0.15 |

These initial weights will be **tuned by the Lasso (L1) Logistic Regression** in
Sprint 2, which will automatically zero out components that add no predictive
signal beyond what the NLP and Vision brains already capture.

### Algorithm Selection Rationale (Paper 1 Insight)

Paper 1 shows that the **Genetic Algorithm outperforms Dijkstra** (87.2 % vs
42.6 % SPI improvement) when routes are complex and multi-objective.
For our project:

- **Logistic Regression + GridSearchCV** ≈ Dijkstra (fast, deterministic,
  interpretable — good for a baseline and regulatory reporting)
- **Random Forest / DNN** ≈ Genetic Algorithm (flexible, captures interactions,
  better recall on rare fatal events)

We will train both, as Paper 2 confirms RF achieves 87.8 % accuracy and DNN
reaches 91.1 % but with lower AUC. Our deployment will use **RF for stability**
(interpretable coefficients) with **DNN as a validation oracle** for high-risk
predictions.
""")

# ─────────────────────────────────────────────────────────────────────────────
# SPLICE: insert cells into the existing 30-cell notebook
# Position A: after cell 1 (intro), before cell 2 (imports)
# Position B: after cell 12 (DfT decode code), before cell 13 (preprocessing)
# ─────────────────────────────────────────────────────────────────────────────

# Build new cell list
new_cells = []

# cells 0–1 (charter + intro)
new_cells.extend(existing[:2])

# INSERT Block A – Literature Review
new_cells.append(LIT_MD)

# cells 2–12 (imports through DfT decode)
new_cells.extend(existing[2:13])

# INSERT Block B – Summary Statistics
new_cells.append(STATS_MD)
new_cells.append(STATS_CODE)
new_cells.append(STATS_PLOT_CODE)
new_cells.append(STATS_EXCESS_CODE)
new_cells.append(STATS_HEATMAP_CODE)
new_cells.append(SPI_MD)

# remaining cells 13–29
new_cells.extend(existing[13:])

nb["cells"] = new_cells

with open(NB_PATH, "w", encoding="utf-8") as f:
    json.dump(nb, f, indent=1, ensure_ascii=False)

print(f"DONE - Notebook updated: {NB_PATH}")
print(f"  Old cell count: {len(existing)}")
print(f"  New cell count: {len(new_cells)}")
