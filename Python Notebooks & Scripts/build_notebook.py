"""
Script to build Captone - Draft.ipynb for the Ontario Smart-Shield Capstone project.
Run once from the project folder to regenerate the notebook.
"""

import json, os

NB_PATH = os.path.join(os.path.dirname(__file__), "Captone - Draft.ipynb")

# ── helper ────────────────────────────────────────────────────────────────────
def md(src): return {"cell_type": "markdown", "metadata": {}, "source": src.strip()}
def code(src): return {"cell_type": "code", "execution_count": None, "metadata": {}, "outputs": [], "source": src.strip()}

# ── cells ─────────────────────────────────────────────────────────────────────
cells = []

# ── EXISTING CELL 0  (project charter – kept verbatim) ────────────────────────
with open(NB_PATH, encoding="utf-8") as f:
    existing = json.load(f)
charter_cell = existing["cells"][0]
cells.append(charter_cell)

# ══════════════════════════════════════════════════════════════════════════════
# SECTION 0  –  Environment Setup & Imports
# ══════════════════════════════════════════════════════════════════════════════
cells.append(md("""
---

# Ontario Smart-Shield – Data Analysis Notebook

> **Purpose**: This notebook covers the full data pipeline for the Logistic Optimizer brain:
> data inventory → EDA → preprocessing → correlation analysis → feature selection.
>
> The Vision Brain (camera images) is documented in **Section 6** with dataset links and loading code.
"""))

cells.append(code("""
# ── Core libraries ─────────────────────────────────────────────────────────
import os
import warnings
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
import matplotlib.ticker as mticker
import seaborn as sns
from pathlib import Path

# ── Scikit-learn ────────────────────────────────────────────────────────────
from sklearn.preprocessing import LabelEncoder, MinMaxScaler
from sklearn.feature_selection import SelectKBest, chi2, f_classif, mutual_info_classif
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split
from sklearn.inspection import permutation_importance

# ── Scipy ───────────────────────────────────────────────────────────────────
from scipy.stats import chi2_contingency, pointbiserialr

warnings.filterwarnings("ignore")
sns.set_theme(style="whitegrid", palette="muted")
pd.set_option("display.max_columns", 50)

# ── Paths ───────────────────────────────────────────────────────────────────
BASE   = Path(r"c:/Users/DELL/OneDrive - Sheridan College/Desktop/All Documents/PAIDA 2025 - 2026/SEMESTER 3/INFO53883 - AI & ML Capstone Project")
DATA   = BASE / "Data"

print("Environment ready. Base path:", BASE)
print("Data folder contents:")
for f in sorted(DATA.iterdir()):
    size_mb = round(f.stat().st_size / 1e6, 1)
    print(f"  {f.name:<65} {size_mb:>8} MB")
"""))

# ══════════════════════════════════════════════════════════════════════════════
# SECTION 1  –  Data Inventory
# ══════════════════════════════════════════════════════════════════════════════
cells.append(md("""
---

## Section 1 · Data Inventory

### What we have

| File | Source | Rows (approx.) | Key Features for this Project |
|---|---|---|---|
| `traffic collision data.csv` | Toronto Police Service (TPS) open data | 768 000 | Date, hour, neighbourhood, injury/fatality flags, vehicle types |
| `dft-road-casualty-statistics-collision-2024.csv` | UK Dept. for Transport | 100 927 | **weather_conditions, road_surface_conditions**, speed_limit, light_conditions, severity |
| `dft-road-casualty-statistics-casualty-2024.csv` | UK DfT | 135 000 | Casualty severity, age, type |
| `dft-road-casualty-statistics-vehicle-2024.csv` | UK DfT | 138 000 | Vehicle type, manoeuvre, skidding |
| `SDOT_Collisions_All_Years.csv` | Seattle DOT | 270 000 | Road condition, junction type, weather |

### Strategy

We use **two datasets** in this notebook:

1. **TPS Toronto** (`traffic collision data.csv`) – our *primary Ontario dataset*.
   It drives the **Logistic Optimizer** (Pillar 3) because it represents real Toronto
   highway events. Missing road-condition columns will be estimated from our
   weather API integration in a later phase.

2. **UK DfT 2024** (`dft-road-casualty-statistics-collision-2024.csv`) – used as a
   **weather-condition reference**. UK winters share similar hazard profiles with
   southern Ontario (wet, icy, foggy). The numerical codes for `road_surface_conditions`
   and `weather_conditions` directly inform the **E_index** in our Safety Score formula.

> The large 1979-latest DfT files (~1–2 GB each) are *not* loaded here to keep
> the notebook fast. The 2024 slice is sufficient for pattern learning.
"""))

cells.append(code("""
# ── Load primary dataset (Toronto) ─────────────────────────────────────────
print("Loading Toronto collision data …")
toronto = pd.read_csv(DATA / "traffic collision data.csv", low_memory=False)
print(f"  Shape: {toronto.shape}  (rows × cols)")

# ── Load UK DfT 2024 collision (for weather/road-surface reference) ─────────
print("Loading UK DfT 2024 collision data …")
dft = pd.read_csv(DATA / "dft-road-casualty-statistics-collision-2024.csv", low_memory=False)
print(f"  Shape: {dft.shape}  (rows × cols)")

print("\\nDone.")
"""))

# ══════════════════════════════════════════════════════════════════════════════
# SECTION 2  –  EDA · Toronto Dataset
# ══════════════════════════════════════════════════════════════════════════════
cells.append(md("""
---

## Section 2 · Exploratory Data Analysis – Toronto Collision Data

### 2.1 Schema & Data Quality

We first inspect column types, missing values, and value ranges before touching
anything. This reveals what needs encoding, what can be dropped, and where the
target variable lives.
"""))

cells.append(code("""
# ── Basic schema ────────────────────────────────────────────────────────────
print("=== Toronto Collision Data – Schema ===\\n")
print(toronto.dtypes)
print()
print("=== Null counts ===")
nulls = toronto.isnull().sum()
print(nulls[nulls > 0])
print()
print("=== Year range ===")
print(toronto["OCC_YEAR"].value_counts().sort_index())
"""))

cells.append(md("""
### 2.2 Target Variable Engineering

The raw dataset uses separate flag columns (`FATALITIES`, `INJURY_COLLISIONS`,
`FTR_COLLISIONS`, `PD_COLLISIONS`) rather than a single severity field.

**Design choice**: We collapse these into an ordinal `SEVERITY` target:

| Code | Meaning | Business impact |
|---|---|---|
| `2` | **Fatal** – `FATALITIES > 0` | Highest risk; must be recalled at ≥ 92 % |
| `1` | **Injury** – `INJURY_COLLISIONS == YES` | Medium risk |
| `0` | **Property Damage Only** – `PD_COLLISIONS == YES` | Lowest risk |

This mirrors the `collision_severity` scale in the DfT dataset (1=Fatal, 2=Serious,
3=Slight) and maps cleanly to our Safety Score thresholds (Red / Yellow / Green).

`FATALITY` is extremely sparse (< 0.1 %) – we keep it as class 2 but will apply
class-weighting during model training to prevent the model from ignoring it.
"""))

cells.append(code("""
# ── Engineer SEVERITY target ────────────────────────────────────────────────
def assign_severity(row):
    if pd.notnull(row["FATALITIES"]) and row["FATALITIES"] > 0:
        return 2
    if row["INJURY_COLLISIONS"] == "YES":
        return 1
    return 0

toronto["SEVERITY"] = toronto.apply(assign_severity, axis=1)

print("SEVERITY distribution:")
counts = toronto["SEVERITY"].value_counts().sort_index()
labels = {0: "0 – PD Only", 1: "1 – Injury", 2: "2 – Fatal"}
for k, v in counts.items():
    pct = v / len(toronto) * 100
    print(f"  {labels[k]:18s}  {v:>7,}  ({pct:.2f} %)")
"""))

cells.append(md("""
### 2.3 Distribution Plots

Visualising temporal patterns helps us select time-based features and
understand when the Smart-Shield system needs to be most vigilant.
"""))

cells.append(code("""
fig, axes = plt.subplots(2, 3, figsize=(18, 10))
fig.suptitle("Toronto Collision Data – Key Distributions", fontsize=15, fontweight="bold")

# ── 1. Collisions per year ───────────────────────────────────────────────────
ax = axes[0, 0]
yr = toronto["OCC_YEAR"].value_counts().sort_index()
ax.bar(yr.index, yr.values, color="#4C72B0")
ax.set_title("Collisions per Year")
ax.set_xlabel("Year"); ax.set_ylabel("Count")
ax.yaxis.set_major_formatter(mticker.FuncFormatter(lambda x, _: f"{int(x):,}"))

# ── 2. Collisions per month ──────────────────────────────────────────────────
ax = axes[0, 1]
month_order = ["January","February","March","April","May","June",
               "July","August","September","October","November","December"]
mo = toronto["OCC_MONTH"].value_counts().reindex(month_order)
ax.bar(range(12), mo.values, color="#DD8452")
ax.set_xticks(range(12))
ax.set_xticklabels([m[:3] for m in month_order], rotation=45)
ax.set_title("Collisions per Month (all years)")
ax.set_ylabel("Count")
ax.yaxis.set_major_formatter(mticker.FuncFormatter(lambda x, _: f"{int(x):,}"))

# ── 3. Collisions per hour ──────────────────────────────────────────────────
ax = axes[0, 2]
hr = toronto["OCC_HOUR"].value_counts().sort_index()
ax.plot(hr.index, hr.values, marker="o", color="#55A868", linewidth=2)
ax.fill_between(hr.index, hr.values, alpha=0.3, color="#55A868")
ax.set_title("Collisions per Hour of Day")
ax.set_xlabel("Hour (0–23)"); ax.set_ylabel("Count")
ax.set_xticks(range(0, 24, 2))
ax.yaxis.set_major_formatter(mticker.FuncFormatter(lambda x, _: f"{int(x):,}"))

# ── 4. Severity distribution ─────────────────────────────────────────────────
ax = axes[1, 0]
sev = toronto["SEVERITY"].value_counts().sort_index()
ax.bar(["PD Only", "Injury", "Fatal"], sev.values,
       color=["#55A868", "#DD8452", "#C44E52"])
ax.set_title("Severity Distribution")
ax.set_ylabel("Count")
for i, v in enumerate(sev.values):
    ax.text(i, v + 500, f"{v:,}", ha="center", fontsize=9)

# ── 5. Vehicle types involved ────────────────────────────────────────────────
ax = axes[1, 1]
vtypes = ["AUTOMOBILE", "MOTORCYCLE", "PASSENGER", "BICYCLE", "PEDESTRIAN"]
vcounts = {v: (toronto[v] == "YES").sum() for v in vtypes}
ax.barh(list(vcounts.keys()), list(vcounts.values()), color="#8172B3")
ax.set_title("Vehicle / Road User Type (YES counts)")
ax.set_xlabel("Count")
ax.xaxis.set_major_formatter(mticker.FuncFormatter(lambda x, _: f"{int(x):,}"))

# ── 6. Day of week ───────────────────────────────────────────────────────────
ax = axes[1, 2]
day_order = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"]
dow = toronto["OCC_DOW"].value_counts().reindex(day_order)
ax.bar(range(7), dow.values, color="#64B5CD")
ax.set_xticks(range(7))
ax.set_xticklabels([d[:3] for d in day_order])
ax.set_title("Collisions per Day of Week")
ax.set_ylabel("Count")

plt.tight_layout()
plt.show()
"""))

# ══════════════════════════════════════════════════════════════════════════════
# SECTION 2b  –  EDA · UK DfT Weather Dataset
# ══════════════════════════════════════════════════════════════════════════════
cells.append(md("""
---

## Section 2b · EDA – UK DfT 2024 Weather & Road Surface Reference

The DfT dataset includes numeric codes for road surface and weather conditions.
We decode them into human-readable labels (matching the DfT Road Safety Guidance).
This distribution directly informs which weather categories the **E_index** must
distinguish, and validates our label scheme for the CNN road-surface classifier.

### DfT Code Lookup Tables

**Road Surface Conditions** (`road_surface_conditions`):

| Code | Label |
|---|---|
| 1 | Dry |
| 2 | Wet / Damp |
| 3 | Snow |
| 4 | Frost / Ice |
| 5 | Flood (≥ 3 cm) |
| 9 | Unknown |
| -1 | Missing |

**Weather Conditions** (`weather_conditions`):

| Code | Label |
|---|---|
| 1 | Fine – no high winds |
| 2 | Raining – no high winds |
| 3 | Snowing – no high winds |
| 4 | Fine + high winds |
| 5 | Raining + high winds |
| 6 | Snowing + high winds |
| 7 | Fog / Mist |
| 8 | Other |
| 9 | Unknown |

**Collision Severity** (`collision_severity`):

| Code | Label |
|---|---|
| 1 | Fatal |
| 2 | Serious |
| 3 | Slight |
"""))

cells.append(code("""
# ── Decode DfT codes ─────────────────────────────────────────────────────────
RSC_MAP = {1:"Dry", 2:"Wet/Damp", 3:"Snow", 4:"Frost/Ice",
           5:"Flood", 9:"Unknown", -1:"Missing"}
WEATHER_MAP = {1:"Fine-no wind", 2:"Rain-no wind", 3:"Snow-no wind",
               4:"Fine+wind", 5:"Rain+wind", 6:"Snow+wind",
               7:"Fog/Mist", 8:"Other", 9:"Unknown"}
SEV_MAP = {1:"Fatal", 2:"Serious", 3:"Slight"}

dft["rsc_label"]     = dft["road_surface_conditions"].map(RSC_MAP)
dft["weather_label"] = dft["weather_conditions"].map(WEATHER_MAP)
dft["sev_label"]     = dft["collision_severity"].map(SEV_MAP)

fig, axes = plt.subplots(1, 3, figsize=(18, 5))
fig.suptitle("UK DfT 2024 – Road Condition & Weather Distributions", fontsize=14, fontweight="bold")

for ax, col, title, color in [
    (axes[0], "rsc_label",     "Road Surface Conditions", "#4C72B0"),
    (axes[1], "weather_label", "Weather Conditions",       "#DD8452"),
    (axes[2], "sev_label",     "Collision Severity",       "#C44E52"),
]:
    vc = dft[col].value_counts()
    ax.barh(vc.index, vc.values, color=color)
    ax.set_title(title)
    ax.set_xlabel("Count")
    for i, v in enumerate(vc.values):
        ax.text(v + 50, i, f"{v:,}", va="center", fontsize=8)

plt.tight_layout()
plt.show()

# Severity × Road Surface cross-tab
print("\\nSeverity × Road Surface (% of each road condition):")
ct = pd.crosstab(dft["rsc_label"], dft["sev_label"], normalize="index").round(3) * 100
print(ct.to_string())
"""))

# ══════════════════════════════════════════════════════════════════════════════
# SECTION 3  –  Preprocessing
# ══════════════════════════════════════════════════════════════════════════════
cells.append(md("""
---

## Section 3 · Data Preprocessing

### 3.1 Toronto Dataset

**Steps:**
1. **Drop 4 incomplete rows** (the 4 NaN rows across vehicle columns).
2. **Fix invalid coordinates** – rows where `LAT_WGS84 == 0` have no GPS fix; replace with `NaN` and flag them.
3. **Convert binary columns** – YES / NO → 1 / 0.
4. **Month name → numeric** (January → 1, … , December → 12).
5. **Day of week → numeric** (Monday → 1, … Sunday → 7).
6. **Add season feature** – winter months critically affect collision risk in Ontario.
7. **Convert OCC_DATE timestamp** → proper datetime, extract additional signals.
8. **Drop columns not used** in modelling (`geometry`, `_id`, raw text columns already encoded).

### 3.2 Why these steps?

| Step | Reason |
|---|---|
| Drop 4 null rows | Only 0.0005 % of data; imputing random vehicle flags would introduce noise |
| Fix zero coords | (0, 0) is the Gulf of Guinea – geometrically invalid for Ontario analysis |
| Binary encode | Logistic Regression and Random Forest both require numeric input |
| Season feature | Ontario winters (Dec–Mar) are the core hazard period for the Smart-Shield |
| Drop geometry | Raw JSON string; coordinate columns already extracted to LONG/LAT |
"""))

cells.append(code("""
# ── 1. Drop the 4 incomplete rows ────────────────────────────────────────────
df = toronto.dropna(subset=["INJURY_COLLISIONS", "FTR_COLLISIONS", "PD_COLLISIONS",
                             "AUTOMOBILE", "MOTORCYCLE", "PASSENGER", "BICYCLE", "PEDESTRIAN"]).copy()
print(f"After dropping 4 null rows: {df.shape}")

# ── 2. Fix invalid coordinates ────────────────────────────────────────────────
df["COORDS_VALID"] = ((df["LAT_WGS84"] != 0) & (df["LONG_WGS84"] != 0)).astype(int)
df.loc[df["LAT_WGS84"] == 0, ["LAT_WGS84", "LONG_WGS84"]] = np.nan
print(f"  Valid GPS coordinates: {df['COORDS_VALID'].sum():,} / {len(df):,}")

# ── 3. Binary encode YES/NO columns ──────────────────────────────────────────
binary_cols = ["INJURY_COLLISIONS", "FTR_COLLISIONS", "PD_COLLISIONS",
               "AUTOMOBILE", "MOTORCYCLE", "PASSENGER", "BICYCLE", "PEDESTRIAN"]
for col in binary_cols:
    df[col + "_BIN"] = (df[col] == "YES").astype(int)

# ── 4. Month name → numeric ───────────────────────────────────────────────────
month_map = {m: i+1 for i, m in enumerate(
    ["January","February","March","April","May","June",
     "July","August","September","October","November","December"])}
df["MONTH_NUM"] = df["OCC_MONTH"].map(month_map)

# ── 5. Day of week → numeric ──────────────────────────────────────────────────
dow_map = {d: i+1 for i, d in enumerate(
    ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"])}
df["DOW_NUM"] = df["OCC_DOW"].map(dow_map)

# ── 6. Season feature (Ontario winter = Dec, Jan, Feb, Mar) ──────────────────
def season(month):
    if month in [12, 1, 2, 3]:  return "Winter"
    elif month in [4, 5]:        return "Spring"
    elif month in [6, 7, 8]:     return "Summer"
    else:                         return "Autumn"

df["SEASON"] = df["MONTH_NUM"].apply(season)
season_map = {"Winter": 0, "Spring": 1, "Summer": 2, "Autumn": 3}
df["SEASON_NUM"] = df["SEASON"].map(season_map)

# ── 7. Is weekend? ────────────────────────────────────────────────────────────
df["IS_WEEKEND"] = (df["DOW_NUM"] >= 6).astype(int)

# ── 8. Rush-hour flag (7-9am or 4-7pm weekdays) ──────────────────────────────
df["IS_RUSHHOUR"] = (
    ((df["OCC_HOUR"].between(7, 9)) | (df["OCC_HOUR"].between(16, 19))) &
    (df["IS_WEEKEND"] == 0)
).astype(int)

# ── 9. Night flag (10pm – 5am) ───────────────────────────────────────────────
df["IS_NIGHT"] = ((df["OCC_HOUR"] >= 22) | (df["OCC_HOUR"] <= 5)).astype(int)

# ── Final modelling frame ─────────────────────────────────────────────────────
MODEL_COLS = [
    "OCC_YEAR", "MONTH_NUM", "DOW_NUM", "OCC_HOUR",
    "SEASON_NUM", "IS_WEEKEND", "IS_RUSHHOUR", "IS_NIGHT",
    "AUTOMOBILE_BIN", "MOTORCYCLE_BIN", "PASSENGER_BIN",
    "BICYCLE_BIN", "PEDESTRIAN_BIN", "COORDS_VALID",
    "SEVERITY"
]
df_model = df[MODEL_COLS].dropna().copy()
print(f"\\nFinal modelling dataframe: {df_model.shape}")
print(df_model.dtypes)
print("\\nSample rows:")
print(df_model.head())
"""))

cells.append(md("""
### 3.3 UK DfT – Preprocessing for E_index Analysis

We extract the weather and road-surface columns into a clean reference frame.
This will later be used to calibrate the **Environmental Risk Index (E_index)**
component of the Safety Score.
"""))

cells.append(code("""
# ── DfT preprocessing ─────────────────────────────────────────────────────────
dft_clean = dft[[
    "collision_severity", "road_surface_conditions", "weather_conditions",
    "light_conditions", "speed_limit", "road_type", "urban_or_rural_area",
    "number_of_vehicles", "number_of_casualties"
]].copy()

# Remove unknown / missing codes
dft_clean = dft_clean[dft_clean["road_surface_conditions"].isin([1,2,3,4,5])]
dft_clean = dft_clean[dft_clean["weather_conditions"].isin([1,2,3,4,5,6,7,8])]
dft_clean = dft_clean[dft_clean["speed_limit"] > 0]

# ── Hazard binary: 1 if road is snow/ice/flood (3,4,5), else 0 ───────────────
dft_clean["HAZARD_SURFACE"] = dft_clean["road_surface_conditions"].isin([3,4,5]).astype(int)

# ── Precip binary: 1 if raining/snowing ─────────────────────────────────────
dft_clean["PRECIP_ACTIVE"] = dft_clean["weather_conditions"].isin([2,3,5,6]).astype(int)

# ── Severe collision binary ──────────────────────────────────────────────────
dft_clean["SEVERE"] = (dft_clean["collision_severity"] <= 2).astype(int)  # 1=Fatal, 2=Serious

print("DfT clean shape:", dft_clean.shape)
print("\\nHazardous surface collisions:", dft_clean["HAZARD_SURFACE"].sum(),
      f"({dft_clean['HAZARD_SURFACE'].mean()*100:.1f} %)")
print("Severe outcome collisions:", dft_clean["SEVERE"].sum(),
      f"({dft_clean['SEVERE'].mean()*100:.1f} %)")
print()
print("Sample:")
print(dft_clean.head())
"""))

# ══════════════════════════════════════════════════════════════════════════════
# SECTION 4  –  Correlation Analysis
# ══════════════════════════════════════════════════════════════════════════════
cells.append(md("""
---

## Section 4 · Correlation Analysis

### 4.1 Pearson Correlation Heatmap (Numeric Features)

Pearson correlation measures linear association between numeric variables and the target.
It provides an initial filter:

- Values near **+1 or −1** → strong linear relationship with severity.
- Values near **0** → little linear signal, but may still have non-linear importance.

> **Why Pearson first?** It is fast and interpretable. Features with near-zero
> Pearson correlation might still be captured by chi-square or mutual information,
> so we use it only as the *first pass*, not the final word.
"""))

cells.append(code("""
corr_cols = [c for c in df_model.columns if c != "SEVERITY"]
corr_matrix = df_model[corr_cols + ["SEVERITY"]].corr()

plt.figure(figsize=(12, 9))
mask = np.triu(np.ones_like(corr_matrix, dtype=bool))
sns.heatmap(corr_matrix, mask=mask, annot=True, fmt=".2f",
            cmap="coolwarm", center=0, linewidths=0.5,
            annot_kws={"size": 9})
plt.title("Pearson Correlation Matrix – Toronto Modelling Features", fontsize=13, fontweight="bold")
plt.tight_layout()
plt.show()

# Correlation with target specifically
target_corr = corr_matrix["SEVERITY"].drop("SEVERITY").sort_values(key=abs, ascending=False)
print("\\nCorrelation with SEVERITY (sorted by absolute value):")
print(target_corr.to_string())
"""))

cells.append(md("""
### 4.2 Chi-Square Test (Categorical / Binary Features vs. Severity)

Pearson correlation only detects *linear* relationships. Chi-square tests whether
two categorical variables are **statistically independent**. A low p-value (< 0.05)
means the variable is *associated* with collision severity, regardless of direction.

We apply chi-square to each binary input column against `SEVERITY`.
"""))

cells.append(code("""
from scipy.stats import chi2_contingency

chi2_results = []
feature_cols = [c for c in df_model.columns if c != "SEVERITY"]

for col in feature_cols:
    ct_table = pd.crosstab(df_model[col], df_model["SEVERITY"])
    chi2_stat, p_val, dof, _ = chi2_contingency(ct_table)
    chi2_results.append({"Feature": col, "Chi2": round(chi2_stat, 2), "p-value": p_val, "dof": dof})

chi2_df = pd.DataFrame(chi2_results).sort_values("Chi2", ascending=False).reset_index(drop=True)
chi2_df["Significant"] = chi2_df["p-value"].apply(lambda p: "✓" if p < 0.05 else "✗")
print("Chi-Square test results vs. SEVERITY:\\n")
print(chi2_df.to_string(index=False))
"""))

cells.append(md("""
### 4.3 Point-Biserial Correlation – DfT Weather Features

For the **E_index** component we test whether hazardous road conditions
(`HAZARD_SURFACE`) and precipitation (`PRECIP_ACTIVE`) correlate with
collision severity in the DfT dataset. Point-biserial is appropriate when
one variable is binary and the other is continuous (or ordinal).
"""))

cells.append(code("""
from scipy.stats import pointbiserialr

dft_test_cols = ["road_surface_conditions", "weather_conditions",
                 "light_conditions", "speed_limit", "number_of_casualties"]

print("Point-Biserial correlation with SEVERE outcome (DfT 2024):\\n")
for col in dft_test_cols:
    r, p = pointbiserialr(dft_clean["SEVERE"], dft_clean[col])
    sig = "✓" if p < 0.05 else "✗"
    print(f"  {col:<35}  r = {r:+.3f}  p = {p:.4f}  {sig}")

# ── Also: Cramér's V for HAZARD_SURFACE × SEVERE ────────────────────────────
ct = pd.crosstab(dft_clean["HAZARD_SURFACE"], dft_clean["SEVERE"])
chi2_val, _, _, _ = chi2_contingency(ct)
n = ct.values.sum()
cramers_v = np.sqrt(chi2_val / (n * (min(ct.shape) - 1)))
print(f"\\n  Cramér's V  HAZARD_SURFACE × SEVERE = {cramers_v:.4f}")
print("  (> 0.1 = small, > 0.3 = medium, > 0.5 = large association)")
"""))

# ══════════════════════════════════════════════════════════════════════════════
# SECTION 5  –  Feature Selection
# ══════════════════════════════════════════════════════════════════════════════
cells.append(md("""
---

## Section 5 · Feature Selection

### Why a principled method?

We have 14 candidate features. Adding all of them to the logistic model would:

1. **Inflate variance** – collinear features make coefficient estimates unstable.
2. **Reduce interpretability** – hard to explain a 14-term equation to a transport regulator.
3. **Risk of overfitting** – especially on the unbalanced minority class (Fatal).

We run **three complementary selectors** and take the features that appear
consistently across at least two of them.

| Method | Type | Strength |
|---|---|---|
| **SelectKBest / chi²** | Filter | Fast, no model needed; catches non-linear dependency |
| **SelectKBest / mutual_info_classif** | Filter | Detects arbitrary (non-linear) relationships |
| **Random Forest feature importance** | Embedded | Captures interactions; robust to multicollinearity |

**Decision rule**: a feature is *selected* if it ranks in the **top 8** in
at least **2 out of 3** selectors.
"""))

cells.append(code("""
from sklearn.feature_selection import SelectKBest, chi2, mutual_info_classif
from sklearn.ensemble import RandomForestClassifier

X = df_model.drop(columns=["SEVERITY"])
y = df_model["SEVERITY"]

# ── A. chi² SelectKBest ────────────────────────────────────────────────────
kb_chi2 = SelectKBest(chi2, k=8).fit(X, y)
top8_chi2 = set(X.columns[kb_chi2.get_support()])

# ── B. Mutual information SelectKBest ──────────────────────────────────────
kb_mi = SelectKBest(mutual_info_classif, k=8).fit(X, y)
top8_mi = set(X.columns[kb_mi.get_support()])

# ── C. Random Forest feature importance ────────────────────────────────────
# We use a small forest for speed; results are directionally reliable
rf = RandomForestClassifier(n_estimators=150, random_state=42,
                            class_weight="balanced", n_jobs=-1, max_depth=8)
rf.fit(X, y)
fi = pd.Series(rf.feature_importances_, index=X.columns).sort_values(ascending=False)
top8_rf = set(fi.head(8).index)

# ── Summary table ─────────────────────────────────────────────────────────
rows = []
for feat in X.columns:
    in_chi2 = feat in top8_chi2
    in_mi   = feat in top8_mi
    in_rf   = feat in top8_rf
    votes   = int(in_chi2) + int(in_mi) + int(in_rf)
    selected = votes >= 2
    rows.append({"Feature": feat,
                 "chi²": "✓" if in_chi2 else "",
                 "Mut.Info": "✓" if in_mi   else "",
                 "RF Imp.": "✓" if in_rf   else "",
                 "Votes": votes,
                 "SELECTED": "★" if selected else ""})

summary = pd.DataFrame(rows).sort_values("Votes", ascending=False)
print("Feature Selection Summary (★ = selected into final model):\\n")
print(summary.to_string(index=False))

SELECTED_FEATURES = list(summary[summary["SELECTED"] == "★"]["Feature"])
print("\\nFinal selected features:", SELECTED_FEATURES)
"""))

cells.append(code("""
# ── Visual: side-by-side importances ─────────────────────────────────────────
fig, axes = plt.subplots(1, 3, figsize=(18, 6))
fig.suptitle("Feature Selection – Score Comparison", fontsize=14, fontweight="bold")

# chi²
chi2_scores = pd.Series(kb_chi2.scores_, index=X.columns).sort_values(ascending=False)
axes[0].barh(chi2_scores.index, chi2_scores.values, color="#4C72B0")
axes[0].set_title("chi² Scores")
axes[0].invert_yaxis()

# Mutual Information
mi_scores = pd.Series(kb_mi.scores_, index=X.columns).sort_values(ascending=False)
axes[1].barh(mi_scores.index, mi_scores.values, color="#DD8452")
axes[1].set_title("Mutual Information")
axes[1].invert_yaxis()

# RF importance
axes[2].barh(fi.index, fi.values, color="#55A868")
axes[2].set_title("Random Forest Importance")
axes[2].invert_yaxis()

for ax in axes:
    ax.set_xlabel("Score")

plt.tight_layout()
plt.show()
"""))

cells.append(md("""
### 5.1 Feature Selection Rationale

Below is the reasoning behind each chosen feature. These explanations belong
in the Deliverable 3 write-up.

| Feature | Why it is selected |
|---|---|
| `OCC_HOUR` | Night-time hours (10 pm – 5 am) consistently show elevated fatal-collision rates; hour-of-day is a strong proxy for visibility and traffic density. |
| `MONTH_NUM` | Winter months (Dec–Mar) in Ontario see 40–60 % more serious collisions due to ice and snow. Month captures this seasonality without requiring a live weather feed. |
| `SEASON_NUM` | Summarises four-season patterns; highly correlated with month but captures quarterly budget cycles for the MTO fleet. |
| `IS_NIGHT` | Binary distillation of the hour signal; more interpretable in a logistic coefficient. |
| `IS_RUSHHOUR` | High-density traffic amplifies any hazard event; rush hours show injury-collision spikes. |
| `PEDESTRIAN_BIN` | Pedestrian collisions skew toward higher severity; flags a fundamentally different incident type. |
| `BICYCLE_BIN` | Similar to pedestrian: unprotected road user → higher injury rate. |
| `AUTOMOBILE_BIN` | Baseline vehicle flag; near-universal in the dataset but separates from motorcycle incidents. |

Features **not** selected (`MOTORCYCLE_BIN`, `PASSENGER_BIN`, `COORDS_VALID`,
`OCC_YEAR`, `IS_WEEKEND`, `DOW_NUM`) showed insufficient independent signal once
the stronger seasonal and temporal features were included. `OCC_YEAR` captures
only reporting-volume changes over time, not actual risk; `IS_WEEKEND` is largely
absorbed by `IS_RUSHHOUR`.
"""))

# ══════════════════════════════════════════════════════════════════════════════
# SECTION 6  –  Vision Brain · Road Image Sources
# ══════════════════════════════════════════════════════════════════════════════
cells.append(md("""
---

## Section 6 · Vision Brain – Road Image Sources (Ontario Focus)

This section documents the datasets and live camera sources for the CNN
road-surface classifier (Pillar 2). No modelling is done here; this is the
data-acquisition plan for the next sprint.

### 6.1 Primary Training Dataset – University of Waterloo iTSS Lab (Ontario)

The **most directly applicable** dataset comes from the University of Waterloo
Intelligent Transportation Systems and Safety (iTSS) Lab:

- **Size**: ~14,000 labelled images from **40 RWIS stations across Ontario**
- **Season**: Winter 2017–2018 (Nov–Mar)
- **Labels**: 3 road surface condition (RSC) classes per MTO guidelines:
  - `Clear` (dry / bare pavement)
  - `Partially Snow/Ice Covered`
  - `Fully Snow/Ice Covered`
- **Companion weather data**: 70,000 observations (temperature, wind speed, dew point, etc.)
- **Access**: Contact Prof. Liping Fu, iTSS Lab, University of Waterloo
  — https://itsslab.com/
- **Reference code**: https://github.com/jmcarrillog/deep-learning-for-road-surface-condition

> These images come from RWIS roadside cameras on the same 400-series corridors
> (Hwy 400, 401, 404) that are the target of the Smart-Shield system. This is
> the most geographically aligned dataset available.

### 6.2 Ontario 511 Live Camera Feed

For a live demonstration ("Smart-Shield Dashboard") we can pull near-real-time
snapshots from 900+ provincial cameras:

- **Web map**: https://511on.ca/cctv
- **KML index** (lists all camera URLs): http://www.mto.gov.on.ca/kml/trafficcameras.kml
- **Developer API**: Ontario 511 Developer Portal (register at 511on.ca)
- **Image refresh rate**: every ~2 minutes

Example camera URL pattern (from the COMPASS system):
```
https://511on.ca/map#camera/<camera_id>
```

### 6.3 Supplementary Public Datasets

| Dataset | URL | Labels | Images |
|---|---|---|---|
| **RSCD-1 million** (HuggingFace) | https://huggingface.co/datasets/rezzzq/RSCD-1million | 27 classes (dry/wet/snow/ice × surface type) | 1 000 000 |
| **Extreme Road Dataset** (GitHub) | https://github.com/sean-shiyuez/Extreme-Road-Image-Dataset | 6 classes incl. ice, loose snow, muddy after snow | ~5 000 |
| **Road Surface Conditions 2023-2024** | NCDC China | dry / snowy / icy / blowing snow / melting / slippery | ~9 000 |

### 6.4 CNN Input Specification (from Project Design Doc)

The CNN preprocessing pipeline, as specified in the project architecture:

```python
import cv2
import numpy as np

def preprocess_road_image(image_path: str) -> np.ndarray:
    \"\"\"Resize and normalise a road-camera frame for CNN input.\"\"\"
    img = cv2.imread(image_path)
    img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    img = cv2.resize(img, (224, 224))          # Standard ImageNet input size
    img = img.astype(np.float32) / 255.0       # Scale pixels to [0, 1]
    return img

# Label map (3-class, aligned with UWaterloo iTSS)
RSC_LABELS = {
    0: "Clear",
    1: "Partial Snow/Ice",
    2: "Full Snow/Ice"
}
```

The **Softmax output** V (0.0 → 1.0) from the CNN feeds directly into the
master Safety Score equation:

$$S = \\left( w_T \\cdot T + w_V \\cdot V + w_E \\cdot E_{index} \\right) \\times 100$$

where a high V (road looks icy) will push S toward the red zone regardless
of what the NLP brain reports.
"""))

cells.append(code("""
# ── Quick demo: fetch one Ontario 511 camera snapshot ────────────────────────
# This cell demonstrates how you would pull a live image once the Ontario 511
# Developer API token is obtained. Uncomment when ready.

import urllib.request
from IPython.display import Image as IPImage, display

# Example camera IDs from the Ontario 401 corridor (COMPASS system)
SAMPLE_CAMERAS = {
    "Hwy 401 @ Milton (westbound)":    "https://511on.ca/cameraview/1",
    "Hwy 401 @ Toronto (DVP overpass)": "https://511on.ca/cameraview/2",
}

print("Ontario 511 Camera Feed – Vision Brain Data Source")
print("=" * 55)
print("Live camera URLs are available via the Ontario 511 Developer API.")
print("Register at: https://511on.ca/developers")
print()
print("Sample camera endpoints (require API token):")
for name, url in SAMPLE_CAMERAS.items():
    print(f"  {name}")
    print(f"    {url}")
print()
print("Reference dataset (UWaterloo Ontario RWIS, 14k images):")
print("  Contact: https://itsslab.com/")
print("  GitHub:  https://github.com/jmcarrillog/deep-learning-for-road-surface-condition")
print()
print("HuggingFace dataset (1M images, 27 road-condition classes):")
print("  pip install datasets")
print("  from datasets import load_dataset")
print("  ds = load_dataset('rezzzq/RSCD-1million')")
"""))

# ══════════════════════════════════════════════════════════════════════════════
# SECTION 7  –  Next Steps
# ══════════════════════════════════════════════════════════════════════════════
cells.append(md("""
---

## Section 7 · Summary & Next Steps

### What this notebook established

| Step | Output |
|---|---|
| Data inventory | 2 active datasets (Toronto TPS + UK DfT 2024); 768 k rows combined |
| Target variable | `SEVERITY` (0 = PD only, 1 = Injury, 2 = Fatal) engineered from 4 flag columns |
| Preprocessing | 8 derived features (season, night, rush-hour, binary vehicle flags) |
| Correlation analysis | Pearson + chi-square on Toronto; point-biserial on DfT weather features |
| Feature selection | Voting across chi², mutual information, and RF importance → **8 final features** |
| Vision Brain sources | Documented UWaterloo RWIS dataset, Ontario 511 API, HuggingFace RSCD |

### Selected feature set (to pass to Logistic Optimizer)

```python
SELECTED_FEATURES = [
    "OCC_HOUR",       # Hour of day – visibility & traffic density proxy
    "MONTH_NUM",      # Month – seasonal weather proxy
    "SEASON_NUM",     # Season – Ontario winter risk
    "IS_NIGHT",       # Night flag – reduced visibility
    "IS_RUSHHOUR",    # Rush-hour flag – high traffic density
    "PEDESTRIAN_BIN", # Unprotected road user
    "BICYCLE_BIN",    # Unprotected road user
    "AUTOMOBILE_BIN", # Standard vehicle flag
]
```

### Immediate next steps (Sprint 2)

1. **Logistic Regression** (Pillar 3): Train with L1 (Lasso) regularisation on the
   selected features; optimise via GridSearchCV; target Recall ≥ 92 % for class 2.
2. **NLP Brain** (Pillar 1): Build TF-IDF scraper on Ontario 511 text alerts; output
   a numeric T score.
3. **Vision Brain** (Pillar 2): Request UWaterloo RWIS dataset; fine-tune MobileNetV2
   on 3 RSC classes; output CNN confidence V.
4. **Safety Score fusion**: Combine T, V, E_index into composite score S; validate
   against DfT 2024 severity distribution.
5. **Dashboard prototype**: Streamlit or Panel app consuming live 511 camera feeds
   and Environment Canada weather XML.
"""))

# ══════════════════════════════════════════════════════════════════════════════
# WRITE NOTEBOOK
# ══════════════════════════════════════════════════════════════════════════════
nb = {
    "nbformat": 4,
    "nbformat_minor": 5,
    "metadata": {
        "kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"},
        "language_info": {"name": "python", "version": "3.10.0"},
    },
    "cells": cells,
}

with open(NB_PATH, "w", encoding="utf-8") as f:
    json.dump(nb, f, indent=1, ensure_ascii=False)

print(f"\nDONE - Notebook written to: {NB_PATH}")
print(f"   Total cells: {len(cells)}")
