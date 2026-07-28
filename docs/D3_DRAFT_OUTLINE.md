# D3 Draft Plan — Performance, Quality & Ethical Consideration Report

**Course:** INFO53883 · **Team:** 2B · **Project:** Ontario Smart-Shield AI  
**Weight:** 10% · **Due:** Week 12 (PDF on SLATE + hardcopy)  
**Source of truth for numbers:** `docs/D3_assets/tables/d3_metrics.json`  
**Charts:** `docs/D3_assets/figures/`

> **This is a planning draft / evidence map — not the submission.**  
> Do **not** paste GenAI prose into the final PDF. Write Section 2–5 interpretations as a team.  
> Do **not** rehash D1/D2 planning, WBS, Gantt, Git workflow, or architecture deep-dives — D3 is about **results + QA + ethics**.

Official mark split (brief + rubric):  
**C1 Progress 0.5 · C2 Performance/QA 3 · C3 Math justification 4 · C4 Ethics/limits 2 · C5 Reflection 0.5 = 10**

---

## Recommended page budget (~8–12 pages + appendix figures)

| Section | Pages | Must include |
|---------|------:|--------------|
| 1 Progress | ~0.5 | % complete, done vs remaining |
| 2 Performance + QA | ~3–4 | Tables, charts, CM, sample outputs, testing/QA |
| 3 Math justification | ~3–4 | Formula → numbers → result → meaning for **each** metric used |
| 4 Ethics + limitations | ~1.5–2 | Privacy, fairness, SHAP, human oversight, Canadian context |
| 5 Reflection | ~0.5 | Challenge, decisions, lessons, next steps |
| Appendix | optional | Extra EDA / swimlane if space |

---

## 1. Current Project Progress (0.5)

**Suggested completion claim:** ~85–90% of planned AI/ML + demo path (not 100% — Final Technical Report / polish remain).

### Successfully implemented (cite evidence)
- Toronto modelling pipeline on one provenance file (`DATA PROVENANCE OK`, 809,030 × 8 features)
- Baselines + tuned RF/LR/LightGBM; Stage A Fatal-vs-Not pilot
- Ethics/fairness audit including **geographic parity DONE** (gap 0.0387 PASS)
- NLP TF-IDF → **T**; Vision ResNet path (cache + live 511 CCTV in `demo/`); Safety Score fusion **S**
- SHAP for RF; model artifacts under `models/`; Flask map demo

**Figure:** `figures/fig01_swimlane.png`

### Remaining before Final Technical Report
- Full GPU re-run so Vision/DNN training logs match claims (if quoting those metrics)
- Public hosting for live map (Pages is static-only)
- Broader vision training beyond thin cache / stronger Fatal precision path
- Final report polish + demo script

**TEAM WRITE:** half page, realistic %, no D1/D2 repeat.

---

## 2. Performance Evaluation and Quality Assessment (3)

### 2.1 What to evaluate (map to pillars)

| Pillar | What you measure | Primary figures/tables |
|--------|------------------|------------------------|
| Tabular severity (3-class) | Acc, Prec/Rec/F1, MCC, AUC-OvR, confusion matrices | `baselines.csv`, `tuned.csv`, `fig06`, `fig07a–c`, `fig08a`, `fig09a` |
| Stage A Fatal-vs-Not | Fatal recall & precision @ thr=0.5 | `d3_metrics.json` → `stage_a_fatal_vs_not` |
| NLP Brain | Sample **T** scores on TC-1…5 | `fig10`, `nlp_t_scores` |
| Fusion | **S** and tiers | `fig11`, `safety_scores.csv` |
| Vision | Sample grid + disclose train status | `fig04` (+ honest note if skipped) |
| Explainability | SHAP | `fig12a` |

### 2.2 Headline tables to paste (already computed)

**Baselines (test)** — best MCC = **KNN 0.3819** (Acc 0.8859)

| Model | Acc | Macro F1 | MCC | AUC-OvR |
|-------|----:|---------:|----:|--------:|
| Logistic Regression | 0.7837 | 0.3518 | 0.1494 | 0.6609 |
| Decision Tree | 0.7688 | 0.3830 | 0.1650 | 0.5921 |
| **KNN** | **0.8859** | **0.4290** | **0.3819** | 0.5914 |
| Random Forest | 0.7671 | 0.3828 | 0.1640 | 0.6000 |
| LightGBM | 0.7869 | 0.3869 | 0.1768 | 0.6321 |

**Tuned (deploy path)** — RF Tuned Acc **0.7672**, MCC **0.1641** (explainability pick)

**Stage A:** LR @0.5 → Fatal recall **1.000**, precision **0.0008**, KPI ≥0.92 **MET**

**Final RF Fatal class:** precision **0.0040**, recall **0.5564**, support 133

**Fusion example (TC-2):** T=0.688, V=0.92, E=0.94 → **S=87.0 HIGH** (see math worksheet)

### 2.3 Quality assurance / testing activities (must narrate)
- Dataset verification: single Toronto file, provenance print, train/test split + SMOTE on train only
- Model validation: held-out test metrics; confusion matrices; Ontario TC fixtures
- Error analysis: Fatal class failure on 3-class models; Stage A false-alarm trade-off; RF misses Fatal fixtures TC-2/TC-5 in §8.6
- Live QA: Open-Meteo / 511 alerts / optional CCTV with fallbacks (`demo/`, `TestLiveData/`)
- Actions taken: class_weight/SMOTE, Stage A pilot, GridSearch/warm-load tuned models, geo-audit feature fix (8 features), SHAP packaging

**TEAM WRITE:** interpret tables — what “good” means for a safety system (prefer recall on Fatal over raw accuracy).

---

## 3. Mathematical Justification (4) — highest weight

For **every metric you show in Section 2**, include:
1. Formula  
2. Values plugged in (from CM / counts where possible)  
3. Calculated result  
4. Plain-language meaning + good/acceptable/poor for *this* project  
5. Limitation implied by the number  

Use `docs/D3_MATH_WORKSHEET.md` as the calculation pack. Priority metrics for Smart-Shield:

| Metric | Why it belongs in D3 |
|--------|----------------------|
| Accuracy | Overall correctness (weak alone under imbalance) |
| Precision / Recall / F1 (Fatal & macro) | Safety KPI story |
| MCC | Single correlation-like score; explains why KNN “wins” tables |
| Demographic parity gap \|Acc_urban − Acc_suburban\| | Ethics + quantitative fairness |
| Safety Score \(S=100(0.25T+0.35V+0.40E)\) | Multimodal fusion math |
| Stage A Fatal recall | Charter KPI ≥0.92 |

**Do not** dump screenshots without walking the math.

---

## 4. Ethical Considerations and System Limitations (2)

### Privacy
- Collision CSVs are public open data; live demo uses public 511/weather — no personal driver identity in core train set
- CCTV stills: public highway cameras; avoid storing identifiable plates/faces; disclose retention

### Fairness / bias
- Extreme class imbalance (Fatal ~0.1%) → models can look accurate while failing Fatal
- **Geo audit:** accuracy gap **0.0387 ≤ 0.05 PASS**, but Suburban/Rural Fatal recall **0.00** in this slice — disclose disparity even when Acc gap passes
- Figures: `fig05a–c`

### Transparency
- SHAP on RF (`fig12a`); feature list of 8; fusion weights published
- Why RF over KNN despite lower MCC: auditability

### Human oversight
- High **S** / Stage A positive → recommend human/operator review before acting on speed advice
- Demo is advisory, not automated vehicle control

### Canadian / responsible AI
- Ontario 511 Open Government Licence context; safety-first Type II preference (missed Fatal worse than false caution), aligned with charter recall KPI

### Limitations + pre-final improvements
- Tiny Fatal precision; 3-class KPI unmet; vision POC/cache vs full corpus; DNN skipped in latest save; Pages cannot host GPU demo; suburban Fatal recall gap

**TEAM WRITE:** tie each point to *your* system with examples (TC-2/TC-5, geo table).

---

## 5. Reflection and Future Improvements (0.5)

Suggested themes (rewrite in team voice):
- **Challenge:** Fatal rarity + multimodal fusion under live API constraints  
- **Decision:** RF for deploy/SHAP; Stage A for recall KPI; live CCTV optional with fallback  
- **Lesson:** Accuracy ≠ safety; disclose warm-start vs full train; geo Acc gap ≠ equal Fatal recall  
- **Next:** full GPU refresh logs, better Fatal precision path, public demo host, Final Technical Report

---

## Continuity from prior PRs (reuse facts, don’t copy whole PR)

| Prior PR | Reuse for D3 |
|----------|----------------|
| PR2–PR4 | Pipeline milestones already done — only cite as “completed earlier,” don’t rewrite |
| PR5 | Metrics/KPI gate language, SHAP plan, dataset limitation honesty |
| PR7 | Model selection rationale (RF vs KNN vs DNN), fusion logic — compress into D3 §§2–4 |

---

## Figure insert checklist (core set)

**Must-use**
- [ ] `fig07b_cm_rf_tuned.png` — deploy CM  
- [ ] `fig06_baseline_comparison.png` or `fig08a` — model table visual  
- [ ] `fig05c_geo_parity.png` — ethics evidence  
- [ ] `fig11_safety_score_fusion.png` — multimodal result  
- [ ] `fig12a_shap_summary.png` — transparency  

**Strongly recommended**
- [ ] `fig01_swimlane.png` — progress/context only (short caption)  
- [ ] `fig05a` / `fig05b` — imbalance + per-class recall  
- [ ] `fig10_nlp_tfidf.png` — NLP sample outputs  
- [ ] `fig09a_final_rf_evaluation.png` — Fatal class numbers  

**Appendix / skip if page-limited**
- `figA1`, `figA2`, Pearson, feature importance, vision grid

---

## Submission checklist (from brief)

- [ ] Current progress  
- [ ] Metrics + tables + graphs + CM + sample outputs  
- [ ] Testing / QA narrative  
- [ ] Formulas + calculations + interpretation for each metric  
- [ ] Ethics + limitations + Canadian responsible AI  
- [ ] Reflection + future improvements  
- [ ] CopyLeaks check; GenAI &lt; 10%  
- [ ] Single PDF on SLATE + printed stapled copy Week 12  

---

## Suggested owner split (edit as needed)

| Section | Suggested lead | Support |
|---------|----------------|---------|
| 1 Progress | PM / any | All confirm % |
| 2 Perf tables + QA | Tabular + QA | NLP/Vision owners add pillar rows |
| 3 Math | Tabular lead | Second person verifies arithmetic |
| 4 Ethics | Ethics/SHAP owner | Demo owner (CCTV/privacy) |
| 5 Reflection | Whole team | 5 bullets max |
