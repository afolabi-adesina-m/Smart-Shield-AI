# D3 Asset Pack | Team 2B (Smart-Shield AI)

Figures and metric tables exported from `notebooks/capstone_with_results.ipynb`.

## What's here

| Path | Purpose |
|------|---------|
| `figures/` | PNG charts |
| `tables/d3_metrics.json` | Canonical numbers for the metric tables |
| `tables/baselines.csv`, `tuned.csv`, `safety_scores.csv` | Metric tables |
| `tables/raw_cell_outputs.txt` | Raw notebook stdout excerpts |
| `FIGURE_MANIFEST.csv` | Which figure maps to which section |
| `../D3_MATH_WORKSHEET.md` | Formulas with the reported values plugged in |

## Notes on the numbers

1. The last notebook chart refresh skipped the vision fine-tune and the DNN train. Tuned scikit-learn models were warm-loaded.
2. KNN leads 3-class MCC. RF Tuned is the deploy pick because it can be explained with SHAP.
3. The Stage A Fatal recall target is met, with very low precision (many false alarms).
4. Use section 10.2 Safety Scores as the canonical scores.
