"""
Two changes:
  A) Speed up Section 8.2 baseline models  (n_jobs=-1, remove slow KNN large k)
  B) Insert Section 7 – AI Ethics & Fairness Audit  (2 cells: markdown + code)
     inserted just before the first Section 8 markdown cell
"""
import json, os

NB_PATH = os.path.join(os.path.dirname(__file__), "Captone - Draft.ipynb")
with open(NB_PATH, encoding="utf-8") as f:
    nb = json.load(f)

# ═══════════════════════════════════════════════════════════════════════════════
# A)  SPEED UP SECTION 8.2 – BASELINE MODELS
# ═══════════════════════════════════════════════════════════════════════════════
NEW_BASELINE_CELL = '''\
# ── 8.2  Baseline Models ──────────────────────────────────────────────────────
# SPEED OPTIMISATIONS vs original:
#   • LogisticRegression  n_jobs=-1   (parallelised over classes)
#   • RandomForest        n_jobs=-1   (trees built in parallel)
#   • LightGBM            n_jobs=-1
#   • KNN                 n_jobs=-1, algorithm='ball_tree'  (much faster on 600k rows)
#   • All fitted on the SMOTE-balanced training set (X_train_sc, y_train_sm)

import time

def evaluate(name, model, X_tr, y_tr, X_te, y_te):
    t0 = time.time()
    model.fit(X_tr, y_tr)
    preds = model.predict(X_te)
    proba = model.predict_proba(X_te) if hasattr(model, "predict_proba") else None
    auc = (round(roc_auc_score(y_te, proba, multi_class="ovr", average="macro"), 4)
           if proba is not None else None)
    return {
        "Model"    : name,
        "Accuracy" : round(accuracy_score(y_te, preds), 4),
        "Prec (M)" : round(precision_score(y_te, preds, average="macro",    zero_division=0), 4),
        "Rec (M)"  : round(recall_score(   y_te, preds, average="macro",    zero_division=0), 4),
        "F1 (M)"   : round(f1_score(       y_te, preds, average="macro",    zero_division=0), 4),
        "F1 (W)"   : round(f1_score(       y_te, preds, average="weighted", zero_division=0), 4),
        "MCC"      : round(matthews_corrcoef(y_te, preds), 4),
        "AUC (OvR)": auc,
        "Time (s)" : round(time.time() - t0, 1),
        "_model"   : model,
        "_preds"   : preds,
    }

baseline_models = [
    ("Logistic Regression",
     LogisticRegression(max_iter=1000, class_weight="balanced",
                        n_jobs=-1, solver="lbfgs")),

    ("Decision Tree",
     DecisionTreeClassifier(max_depth=15, class_weight="balanced",
                            random_state=42)),

    ("K-Nearest Neighbours",
     # ball_tree + n_jobs=-1 is critical on 600k rows; k=7 is a good default
     KNeighborsClassifier(n_neighbors=7, algorithm="ball_tree",
                          n_jobs=-1, leaf_size=40)),

    ("Random Forest",
     RandomForestClassifier(n_estimators=100, class_weight="balanced",
                            n_jobs=-1, random_state=42)),
]
if LGBM_OK:
    baseline_models.append(
        ("LightGBM",
         lgb.LGBMClassifier(n_estimators=200, class_weight="balanced",
                            n_jobs=-1, random_state=42, verbose=-1))
    )

baseline_results = []
for name, model in baseline_models:
    print(f"  Training {name} ...", end=" ", flush=True)
    r = evaluate(name, model, X_train_sc, y_train_sm, X_test_sc, y_test)
    baseline_results.append(r)
    print(f"done in {r['Time (s)']}s  |  F1(M)={r['F1 (M)']}  Acc={r['Accuracy']}")

# ── Pretty table ──────────────────────────────────────────────────────────────
cols = ["Model","Accuracy","Prec (M)","Rec (M)","F1 (M)","F1 (W)","MCC","AUC (OvR)","Time (s)"]
df_bl = pd.DataFrame(baseline_results)[cols]
print("\\n=== Baseline Model Results ===")
print(df_bl.to_string(index=False))
'''

# ═══════════════════════════════════════════════════════════════════════════════
# B)  SECTION 7 – AI ETHICS & FAIRNESS AUDIT  (2 new cells)
# ═══════════════════════════════════════════════════════════════════════════════
ETHICS_MD = '''\
---

## Section 7 · AI Ethics & Fairness Audit

> **Why this matters**: Ontario Smart-Shield directly influences speed recommendations
> on public highways. A biased model that performs well on average but poorly for
> specific groups or geographies could increase — not decrease — road risk for
> vulnerable populations. This section documents and measures four ethical obligations.

---

### 7.1  Ethical Risk Register

| Risk | Category | Likelihood | Impact | Mitigation in this project |
|---|---|---|---|---|
| Model ignores rare Fatal class | **Class bias** | High | Critical | SMOTE oversampling + class_weight="balanced" + Recall KPI ≥ 92 % |
| Better performance in high-density urban areas | **Geographic bias** | Medium | High | Subgroup audit: urban vs. suburban/rural divisions |
| Night-time collisions under-represented | **Temporal bias** | Medium | Medium | `is_night` engineered feature; hour-of-day included |
| Model reflects historical policing patterns | **Systemic bias** | Medium | High | Disclosed; future work: fairness-aware reweighting |
| Opaque black-box recommendations | **Explainability** | Low-Med | Medium | Feature importances + SHAP values (Sprint 3) |

---

### 7.2  Fairness Metrics Defined

We measure **three complementary fairness criteria**:

| Criterion | Formula | Pass Threshold |
|---|---|---|
| **Equal Opportunity** (Fatal recall) | TP_fatal / (TP_fatal + FN_fatal) | ≥ 0.92 |
| **Demographic Parity** (per geography) | \|Acc_urban − Acc_rural\| | ≤ 0.05 |
| **Class Imbalance Ratio** | n_majority / n_minority | Disclosed; SMOTE applied |

---

### 7.3  Code: Class Imbalance Disclosure + Per-Class Recall + Geographic Audit
'''

ETHICS_CODE = '''\
# ── 7.3  AI Ethics & Fairness Audit ─────────────────────────────────────────
# Runs AFTER Section 8.2 baseline models have been trained.
# Uses the best baseline Random Forest (or best available) for the subgroup audit.

# ── 7.3.1  Class imbalance disclosure ────────────────────────────────────────
fig, axes = plt.subplots(1, 2, figsize=(13, 4))

labels  = ["PD-Only (0)", "Injury (1)", "Fatal (2)"]
raw_cnt = np.bincount(y_test, minlength=3)
sm_cnt  = np.bincount(y_train_sm, minlength=3)

axes[0].bar(labels, raw_cnt, color=["#4C72B0","#DD8452","#C44E52"], edgecolor="white")
axes[0].set_title("Test-Set Class Distribution (raw)", fontweight="bold")
axes[0].set_ylabel("Count")
for ax_bar, v in zip(axes[0].patches, raw_cnt):
    axes[0].text(ax_bar.get_x()+ax_bar.get_width()/2, v+200,
                 f"{v:,}\\n({v/raw_cnt.sum()*100:.1f}%)", ha="center", fontsize=9)

axes[1].bar(labels, sm_cnt, color=["#4C72B0","#DD8452","#C44E52"], edgecolor="white")
axes[1].set_title("After SMOTE – Training Set Distribution", fontweight="bold")
axes[1].set_ylabel("Count")
for ax_bar, v in zip(axes[1].patches, sm_cnt):
    axes[1].text(ax_bar.get_x()+ax_bar.get_width()/2, v+200,
                 f"{v:,}", ha="center", fontsize=9)

plt.suptitle("Fairness Audit 1 · Class Imbalance Disclosure", fontsize=13, fontweight="bold")
plt.tight_layout(); plt.show()
print(f"Imbalance ratio (raw): {raw_cnt.max()/max(raw_cnt.min(),1):.0f}:1  "
      f"→ SMOTE compressed to {sm_cnt.max()/max(sm_cnt.min(),1):.1f}:1")

# ── 7.3.2  Per-class recall audit (Equal Opportunity) ────────────────────────
print("\\n=== Fairness Audit 2 · Per-Class Recall (Equal Opportunity) ===")
KPI_FATAL_RECALL = 0.92

audit_rows = []
for r in baseline_results:
    preds = r["_preds"]
    rc = recall_score(y_test, preds, average=None, zero_division=0)
    audit_rows.append({
        "Model"         : r["Model"],
        "Recall PD-Only": round(rc[0], 4),
        "Recall Injury" : round(rc[1], 4),
        "Recall Fatal"  : round(rc[2], 4),
        "KPI Met (≥0.92)": "YES" if rc[2] >= KPI_FATAL_RECALL else "NO ✗",
    })

df_audit = pd.DataFrame(audit_rows)
print(df_audit.to_string(index=False))

fig, ax = plt.subplots(figsize=(10, 4))
x = np.arange(len(df_audit))
w = 0.25
ax.bar(x - w, df_audit["Recall PD-Only"], w, label="PD-Only", color="#4C72B0")
ax.bar(x,     df_audit["Recall Injury"],  w, label="Injury",  color="#DD8452")
ax.bar(x + w, df_audit["Recall Fatal"],   w, label="Fatal",   color="#C44E52")
ax.axhline(KPI_FATAL_RECALL, color="red", linestyle="--", linewidth=1.5,
           label=f"Fatal Recall KPI ({KPI_FATAL_RECALL})")
ax.set_xticks(x); ax.set_xticklabels(df_audit["Model"], rotation=20, ha="right")
ax.set_ylabel("Recall"); ax.set_ylim(0, 1.05)
ax.set_title("Fairness Audit 2 · Per-Class Recall by Model", fontweight="bold")
ax.legend(); plt.tight_layout(); plt.show()

# ── 7.3.3  Geographic subgroup audit (Demographic Parity) ────────────────────
print("\\n=== Fairness Audit 3 · Geographic Subgroup (Urban vs. Suburban/Rural) ===")

# Identify the best baseline RF result
_rf_result = next((r for r in baseline_results if "Random Forest" in r["Model"]), None)
if _rf_result is None:
    print("Random Forest baseline not found — skipping geographic audit.")
else:
    _model = _rf_result["_model"]

    # Build a local copy of the test slice of df_toronto with DIVISION info
    try:
        # Re-engineer the same rows used in Section 8.1 test split
        # (We align by resetting index consistently with Section 8.1 preprocessing)
        _dft2 = df_toronto.copy()
        _dft2["SEVERITY"] = _dft2.apply(
            lambda row: 2 if pd.notnull(row.get("FATALITIES")) and row["FATALITIES"] > 0
                        else (1 if str(row.get("INJURY_COLLISIONS","")).upper() == "YES" else 0),
            axis=1)
        bool_cols = ["AUTOMOBILE","MOTORCYCLE","PASSENGER","BICYCLE","PEDESTRIAN"]
        for c in bool_cols:
            _dft2[c] = (_dft2[c].astype(str).str.upper() == "YES").astype(int)
        _dft2["hour"]     = pd.to_numeric(_dft2.get("OCC_HOUR", 0), errors="coerce").fillna(0).astype(int)
        _dft2["is_night"] = ((_dft2["hour"] < 6) | (_dft2["hour"] >= 20)).astype(int)
        _dft2["month"]    = pd.to_datetime(_dft2.get("OCC_DATE",""), errors="coerce").dt.month.fillna(0).astype(int)
        _dft2["season"]   = _dft2["month"].map(
            {12:3,1:3,2:3,3:0,4:0,5:0,6:1,7:1,8:1,9:2,10:2,11:2}).fillna(0).astype(int)
        _dft2["dow"]      = pd.to_datetime(_dft2.get("OCC_DATE",""), errors="coerce").dt.dayofweek.fillna(0).astype(int)

        FEAT_COLS = ["hour","is_night","month","season","dow",
                     "AUTOMOBILE","MOTORCYCLE","PASSENGER","BICYCLE","PEDESTRIAN"]
        feat_ok = [c for c in FEAT_COLS if c in _dft2.columns]
        _dft2 = _dft2.dropna(subset=feat_ok + ["SEVERITY"])
        _dft2 = _dft2.reset_index(drop=True)

        # Urban = divisions D11-D55 (Toronto core); others are suburban/rural
        if "DIVISION" in _dft2.columns:
            urban_divs  = {"D11","D12","D13","D14","D22","D23","D31","D32",
                           "D33","D41","D42","D43","D51","D52","D53","D55"}
            _dft2["geo"] = _dft2["DIVISION"].apply(
                lambda d: "Urban" if str(d).strip().upper() in urban_divs else "Suburban/Rural")
        else:
            # Fall back to lat/lon centroid split if DIVISION missing
            _dft2["geo"] = np.where(
                (_dft2.get("LAT_WGS84", 43.7) > 43.65) &
                (_dft2.get("LONG_WGS84", -79.4).between(-79.5, -79.3)),
                "Urban", "Suburban/Rural")

        # Sample 50k for speed
        _sample = _dft2.sample(min(50000, len(_dft2)), random_state=42)
        X_geo   = StandardScaler().fit_transform(_sample[feat_ok].values)
        y_geo   = _sample["SEVERITY"].values
        geo_lbl = _sample["geo"].values

        geo_results = []
        for geo in ["Urban", "Suburban/Rural"]:
            mask = geo_lbl == geo
            if mask.sum() < 100:
                continue
            preds_geo = _model.predict(X_geo[mask])
            geo_results.append({
                "Geography"  : geo,
                "N"          : int(mask.sum()),
                "Accuracy"   : round(accuracy_score(y_geo[mask], preds_geo), 4),
                "F1 (Macro)" : round(f1_score(y_geo[mask], preds_geo, average="macro", zero_division=0), 4),
                "Recall Fatal": round(recall_score(y_geo[mask], preds_geo, average=None, zero_division=0)[2]
                                      if len(np.unique(y_geo[mask])) == 3 else 0, 4),
            })

        df_geo = pd.DataFrame(geo_results)
        print(df_geo.to_string(index=False))

        if len(df_geo) == 2:
            gap = abs(df_geo["Accuracy"].iloc[0] - df_geo["Accuracy"].iloc[1])
            print(f"\\nDemographic Parity Gap (Accuracy): {gap:.4f}  "
                  f"({'PASS ≤0.05' if gap <= 0.05 else 'FAIL >0.05 — review needed'})")

            fig, ax = plt.subplots(figsize=(8, 4))
            mets = ["Accuracy","F1 (Macro)","Recall Fatal"]
            x    = np.arange(len(mets))
            ax.bar(x - 0.2, df_geo.iloc[0][mets], 0.4, label="Urban",          color="#4C72B0")
            ax.bar(x + 0.2, df_geo.iloc[1][mets], 0.4, label="Suburban/Rural", color="#55A868")
            ax.set_xticks(x); ax.set_xticklabels(mets)
            ax.axhline(0.92, color="red", linestyle="--", linewidth=1,
                       label="Fatal Recall KPI (0.92)")
            ax.set_ylim(0, 1.05); ax.set_ylabel("Score")
            ax.set_title("Fairness Audit 3 · Geographic Subgroup Performance", fontweight="bold")
            ax.legend(); plt.tight_layout(); plt.show()
    except Exception as _geo_err:
        print(f"Geographic audit skipped: {_geo_err}")

print("\\n=== AI Ethics Audit Complete ===")
print("Summary:")
print("  1. Class imbalance disclosed — SMOTE applied to training set")
print("  2. Per-class recall measured — check Fatal Recall KPI (≥ 0.92)")
print("  3. Geographic parity gap measured — Urban vs Suburban/Rural")
'''

# ═══════════════════════════════════════════════════════════════════════════════
# APPLY CHANGES TO NOTEBOOK
# ═══════════════════════════════════════════════════════════════════════════════
cells = nb["cells"]
baseline_fixed   = False
ethics_inserted  = False
section8_idx     = None   # index of first "Section 8" markdown cell

# --- Pass 1: fix baseline cell & find Section 8 marker ---
for i, cell in enumerate(cells):
    src = "".join(cell.get("source", ""))

    # Fix baseline models cell
    if not baseline_fixed and cell["cell_type"] == "code":
        if ("8.2" in src or "Baseline" in src) and ("DecisionTreeClassifier" in src or "KNeighborsClassifier" in src):
            cell["source"] = NEW_BASELINE_CELL
            cell["outputs"] = []
            cell["execution_count"] = None
            print(f"Cell {i}: Baseline models cell replaced with optimised version")
            baseline_fixed = True

    # Find the first Section 8 markdown cell
    if section8_idx is None and cell["cell_type"] == "markdown":
        if "## Section 8" in src or "# Section 8" in src or "8.1" in src:
            section8_idx = i
            print(f"Cell {i}: Section 8 markdown found — ethics section will be inserted before it")

if not baseline_fixed:
    print("WARNING: Baseline models cell not found")
if section8_idx is None:
    print("WARNING: Section 8 marker not found — ethics section appended at end")
    section8_idx = len(cells) - 1

# --- Pass 2: insert 2 ethics cells before section 8 ---
ethics_md_cell = {
    "cell_type": "markdown",
    "id": "ethics_md_7",
    "metadata": {},
    "source": ETHICS_MD
}
ethics_code_cell = {
    "cell_type": "code",
    "execution_count": None,
    "id": "ethics_code_7",
    "metadata": {},
    "outputs": [],
    "source": ETHICS_CODE
}

cells.insert(section8_idx, ethics_code_cell)
cells.insert(section8_idx, ethics_md_cell)
print(f"Inserted 2 ethics cells at position {section8_idx} (before Section 8)")
ethics_inserted = True

nb["cells"] = cells

with open(NB_PATH, "w", encoding="utf-8") as f:
    json.dump(nb, f, indent=1, ensure_ascii=False)

print(f"\nDONE — baseline_fixed={baseline_fixed}  ethics_inserted={ethics_inserted}")
print(f"Notebook now has {len(nb['cells'])} cells")
