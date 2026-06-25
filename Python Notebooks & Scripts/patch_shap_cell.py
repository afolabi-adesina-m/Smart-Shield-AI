"""Fix SHAP cell for multi-class RF shape mismatch (newer shap versions)."""
import json
from pathlib import Path

NB = Path(__file__).parent / "Captone - Draft.ipynb"
nb = json.load(open(NB, encoding="utf-8"))

NEW_CELL = '''# ── 10.3  SHAP explainability for final RF model ─────────────────────────────
try:
    import shap
except ImportError:
    import subprocess, sys
    subprocess.check_call([sys.executable, "-m", "pip", "install", "-q", "shap"])
    import shap

if "best_estimators" not in globals() or not best_estimators:
    raise RuntimeError("Run Section 8.3 GridSearchCV first (cell ~51).")

rf_model = best_estimators["Random Forest (Tuned)"]
feat_names = available if "available" in globals() else [f"f{i}" for i in range(X_test_sc.shape[1])]

SHAP_SAMPLE = min(500, len(X_test_sc))
rng = np.random.default_rng(42)
idx = rng.choice(len(X_test_sc), SHAP_SAMPLE, replace=False)
X_shap = X_test_sc[idx]
n_feat = X_shap.shape[1]


def _shap_for_class(shap_values, cls_idx: int, n_features: int) -> np.ndarray:
    """Align SHAP matrix to X columns (handles list/3D output + offset column)."""
    if isinstance(shap_values, list):
        sv = np.asarray(shap_values[cls_idx])
    elif isinstance(shap_values, np.ndarray) and shap_values.ndim == 3:
        sv = shap_values[:, :, cls_idx]
    else:
        sv = np.asarray(shap_values)

    if sv.ndim == 2 and sv.shape[1] == n_features + 1:
        sv = sv[:, :-1]  # drop constant offset column (newer SHAP)
    if sv.ndim == 2 and sv.shape[1] > n_features:
        sv = sv[:, :n_features]
    return sv


print(f"Computing SHAP values for {SHAP_SAMPLE} test samples...")
explainer = shap.TreeExplainer(rf_model)
shap_values = explainer.shap_values(X_shap)

class_names = ["PD-Only", "Injury", "Fatal"]
for cls_idx, cls_name in enumerate(class_names):
    sv = _shap_for_class(shap_values, cls_idx, n_feat)
    print(f"\\n--- SHAP summary: class {cls_name} (shape {sv.shape}) ---")
    shap.summary_plot(
        sv, X_shap, feature_names=feat_names,
        show=False, max_display=len(feat_names),
    )
    plt.title(f"SHAP — Random Forest (Tuned) · Predicting {cls_name}", fontweight="bold")
    plt.tight_layout()
    plt.show()

fatal_sv = _shap_for_class(shap_values, 2, n_feat)
fatal_shap = np.abs(fatal_sv).mean(axis=0)
fi_shap = pd.Series(fatal_shap, index=feat_names[: len(fatal_shap)]).sort_values(ascending=True)
fig, ax = plt.subplots(figsize=(8, 4))
fi_shap.plot(kind="barh", ax=ax, color="#C73E1D")
ax.set_title("Mean |SHAP| for Fatal class — Feature Impact", fontweight="bold")
ax.set_xlabel("Mean absolute SHAP value")
plt.tight_layout()
plt.show()
'''

for i, c in enumerate(nb["cells"]):
    src = "".join(c.get("source", []))
    if "10.3  SHAP explainability" in src:
        c["source"] = NEW_CELL
        print(f"Patched cell {i}")
        break

json.dump(nb, open(NB, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
print("DONE")
