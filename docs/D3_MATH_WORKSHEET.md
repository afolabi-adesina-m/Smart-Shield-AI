# D3 Section 3 — Mathematical Worksheet (Team 2B)

Use this to **show your own arithmetic and interpretation** in the report.  
Values come from `docs/D3_assets/tables/d3_metrics.json` and notebook outputs.

> Screenshots alone earn little/no C3 credit. For each metric: **formula → plug-in → result → meaning → limitation**.

---

## A. Classification metrics (3-class / binary)

### A1. Accuracy
\[
\mathrm{Accuracy}=\frac{TP+TN}{TP+TN+FP+FN}=\frac{\text{correct predictions}}{\text{all predictions}}
\]

**RF Tuned (overall, from evaluation output):** Acc ≈ **0.7672**  
Meaning for project: ~77% of test rows labelled correctly, but with Fatal ≈ 0.1% this can look “good” while missing the safety class.  
Limitation: **do not** treat Acc as the charter KPI.

### A2. Precision (per class)
\[
\mathrm{Precision}=\frac{TP}{TP+FP}
\]

**Stage A Fatal (LR @ 0.5):** Precision ≈ **0.0008**  
**3-class RF Fatal:** Precision ≈ **0.0040** (support 133)

Meaning: almost every Fatal alert is a false alarm under current imbalance.  
Limitation: high recall + tiny precision → operator overload / alert fatigue.

### A3. Recall / Sensitivity (per class) — charter-aligned
\[
\mathrm{Recall}=\frac{TP}{TP+FN}
\]

**Stage A Fatal:** Recall = **1.0000**  
KPI target: Recall ≥ **0.92** → **MET** at binary Stage A.  
**3-class RF Fatal:** Recall ≈ **0.5564** → **does not** meet 0.92 alone.

Meaning: Stage A is the safety screen that meets the miss-Fatal KPI; 3-class RF alone does not.  
Limitation: meeting recall by predicting Fatal too often destroys precision.

### A4. F1 Score
\[
F_1=2\cdot\frac{\mathrm{Precision}\cdot\mathrm{Recall}}{\mathrm{Precision}+\mathrm{Recall}}
\]

**Worked example (Stage A Fatal):**  
P=0.0008, R=1.0000  
\[
F_1=2\cdot\frac{0.0008\cdot 1}{0.0008+1}=2\cdot\frac{0.0008}{1.0008}\approx 0.0016
\]
(matches notebook F1 ≈ 0.0016)

Meaning: F1 collapses because precision is near zero even when recall is perfect.  
Limitation: F1 alone hides the intentional high-recall / low-precision trade-off.

### A5. Matthews Correlation Coefficient (MCC)
\[
\mathrm{MCC}=\frac{TP\cdot TN-FP\cdot FN}{\sqrt{(TP+FP)(TP+FN)(TN+FP)(TN+FN)}}
\]
(multiclass generalization used by sklearn)

**Baselines (reported):** KNN MCC **0.3819** (best); RF **0.1640**; LR **0.1494**

Meaning: KNN has the strongest overall label correlation on the test set.  
Limitation / decision: team still deploys **RF Tuned** for SHAP + Paper 2 alignment — state this explicitly so MCC leadership is not misread as “chosen model.”

### A6. ROC-AUC (OvR macro)
**Tuned:** LR 0.6609 · RF 0.6002 · LightGBM 0.6080  

Meaning: modest ranking ability under severe imbalance.  
Limitation: AUC can look middling even when Fatal operating point is tuned for recall.

---

## B. Fairness metric (Demographic Parity on accuracy)

\[
\Delta_{\mathrm{acc}}=\lvert Acc_{urban}-Acc_{suburban/rural}\rvert
\]

**From geo audit:**  
\(Acc_{urban}=0.7457\), \(Acc_{sub}=0.7844\)  
\[
\Delta_{\mathrm{acc}}=\lvert 0.7457-0.7844\rvert=0.0387
\]
Pass rule used in notebook: \(\Delta_{\mathrm{acc}}\le 0.05\) → **PASS**

**Also report (honest):** Suburban/Rural Fatal recall = **0.00** vs Urban **0.7045** in that slice.  
Meaning: Acc parity can pass while Fatal opportunity still differs — discuss both.

---

## C. Multimodal Safety Score

Weights: \(w_T=0.25,\ w_V=0.35,\ w_E=0.40\)

\[
S=100\cdot(w_T T + w_V V + w_E E_{index})
\]

### Worked example — TC-2 (blizzard)
\(T=0.688,\ V=0.92,\ E=0.940\)

\[
\begin{aligned}
w_T T &= 0.25\cdot 0.688 = 0.1720\\
w_V V &= 0.35\cdot 0.92 = 0.3220\\
w_E E &= 0.40\cdot 0.940 = 0.3760\\
\sum &= 0.8700\\
S &= 100\cdot 0.8700 = 87.0
\end{aligned}
\]

Tier rule (notebook): LOW 0–30 · MEDIUM 31–70 · HIGH 71–100 → **HIGH**, advisory 80 km/h.

### Worked example — TC-1 (clear)
\(T=0,\ V=0.15,\ E=0.165\) → \(S=100(0+0.0525+0.066)=11.85\approx 11.9\) → **LOW**

**TEAM:** show at least one HIGH and one LOW worked example in Section 3.

---

## D. Class imbalance ratio (quality context)

Raw test / full data Fatal rarity ≈ \(662 / 809030 \approx 0.00082\) (≈ **0.082%**).  
Imbalance ratio quoted in fairness cell ≈ **1051:1** before SMOTE (train).  
SMOTE compresses training Fatal rate toward balance — disclose that test metrics remain on the natural rare-Fatal distribution.

---

## E. What *not* to over-claim mathematically

- Do not claim 3-class Fatal recall ≥ 0.92 from RF/KNN tables (not true in this save).  
- Do not use §8.6 placeholder **S** values in math (use §10.2 / `safety_scores.csv`).  
- If quoting Vision val-acc or DNN Acc/MCC, only do so from a run whose stdout is in the notebook — latest save skipped those trains.

---

## Verification checklist for the math section author

- [ ] Every Section 2 metric appears again in Section 3 with formula  
- [ ] At least one hand calculation shown end-to-end (F1 and/or S recommended)  
- [ ] Each result labelled good / acceptable / poor **for highway safety**  
- [ ] Second teammate re-computes numbers from `d3_metrics.json` before PDF freeze  
