# D3 Asset Pack — Team 2B (Smart-Shield AI)

Exported from `notebooks/capstone_with_results.ipynb` for the **Performance, Quality, and Ethical Consideration Report (D3, 10%, due W12)**.

## What’s here

| Path | Purpose |
|------|---------|
| `figures/` | PNG charts ready to insert into Word/LaTeX |
| `tables/d3_metrics.json` | Canonical numbers for tables + math section |
| `tables/baselines.csv`, `tuned.csv`, `safety_scores.csv` | Paste-friendly metric tables |
| `tables/raw_cell_outputs.txt` | Raw notebook stdout excerpts (traceability) |
| `FIGURE_MANIFEST.csv` | Which figure maps to which D3 section |
| `../D3_DRAFT_OUTLINE.md` | Rubric-mapped draft plan (planning notes) |
| `../D3_MATH_WORKSHEET.md` | Formulas + plugged-in values for Section 3 |
| `../D3_Performance_Quality_Ethical_Brief.pdf` | Assignment brief |
| `../D3_Rubric.pdf` | Official rubric |

## GenAI / integrity reminder

D3 forbids submitting AI-generated report text, math explanations, figures, or conclusions.  
These files are **evidence + planning notes**. The team must write interpretations in their own words and keep CopyLeaks GenAI usage **&lt; 10%**.

## Honesty flags (must disclose in D3)

1. Last notebook chart-refresh **skipped** Vision fine-tune + DNN train; tuned sklearn models were **warm-loaded**.
2. **KNN** leads 3-class MCC; **RF Tuned** is the deploy/explainability pick.
3. Stage A Fatal recall KPI is **met** with tiny precision (false alarms).
4. Use **§10.2** Safety Scores as canonical (not §8.6 placeholders).
