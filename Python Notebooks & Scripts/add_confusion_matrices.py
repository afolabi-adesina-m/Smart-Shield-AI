"""Add raw + normalized confusion matrices across the capstone notebook."""
import json
from pathlib import Path

NB = Path(__file__).parent / "Captone - Draft.ipynb"
nb = json.load(open(NB, encoding="utf-8"))
cells = nb["cells"]

SEVERITY_LABELS = '["PD-Only", "Injury", "Fatal"]'
SEVERITY_LABELS_LONG = '["PD-Only (0)", "Injury (1)", "Fatal (2)"]'

# ── Patch cell 5: add cm_helpers import ──────────────────────────────────────
for c in cells:
    if c["cell_type"] == "code" and "CELL 3: All imports" in "".join(c.get("source", "")):
        src = "".join(c.get("source", ""))
        if "cm_helpers" not in src:
            src = src.replace(
                "from scipy.stats import chi2_contingency, pointbiserialr",
                "from scipy.stats import chi2_contingency, pointbiserialr\n\nfrom cm_helpers import plot_confusion_matrices_pair",
            )
            c["source"] = src
            print("Patched imports cell")
        break

# ── Cell 49: add CM pair for best baseline ───────────────────────────────────
OLD_49 = """print(classification_report(y_test, best_clf.predict(X_test_sc),
      target_names=["PD-Only (0)","Injury (1)","Fatal (2)"], zero_division=0))"""

NEW_49 = """best_preds = best_clf.predict(X_test_sc)
print(classification_report(y_test, best_preds,
      target_names=["PD-Only (0)","Injury (1)","Fatal (2)"], zero_division=0))

plot_confusion_matrices_pair(
    y_test, best_preds, labels=""" + SEVERITY_LABELS + """,
    title_prefix=f"Best Baseline — {best_base}",
)"""

# ── New cell 8.3c after tuned results ─────────────────────────────────────────
CELL_53C_MD = {
    "cell_type": "markdown",
    "id": "cm_all_md",
    "metadata": {},
    "source": """### Section 8.3c · Confusion Matrices (All Tuned Models)

Each model shows **two** matrices side by side:
- **Without Normalization** — raw prediction counts
- **With Normalization** — row percentages (recall per true class; useful under class imbalance)
""",
}

CELL_53C_CODE = {
    "cell_type": "code",
    "id": "cm_all_code",
    "metadata": {},
    "execution_count": None,
    "outputs": [],
    "source": """# ── 8.3c  Confusion matrices for all tuned sklearn models ───────────────────
if "best_estimators" not in dir() or not best_estimators:
    print("Run Section 8.3 GridSearchCV first.")
else:
    for name, clf in best_estimators.items():
        preds = clf.predict(X_test_sc)
        print(f"\\n{'='*60}\\n  {name}\\n{'='*60}")
        plot_confusion_matrices_pair(
            y_test, preds, labels=""" + SEVERITY_LABELS + """,
            title_prefix=name,
        )
""",
}

# ── Vision cell 41 ───────────────────────────────────────────────────────────
VISION_OLD = """    fig, ax = plt.subplots(figsize=(6, 5))
    ConfusionMatrixDisplay(vision_cm, display_labels=vision_class_names).plot(ax=ax, cmap="Blues")
    ax.set_title("Vision Brain — Confusion Matrix (Snow/Ice vs Wet vs Clear)", fontweight="bold")
    plt.tight_layout()
    plt.show()"""

VISION_NEW = """    plot_confusion_matrices_pair(
        y_true, y_pred, labels=vision_class_names,
        title_prefix="Vision Brain (ResNet18)",
        cmap="Greens",
    )"""

# ── DNN cell 56 ──────────────────────────────────────────────────────────────
DNN_OLD = """        cm = confusion_matrix(y_test, preds)
        ConfusionMatrixDisplay(cm, display_labels=["PD-Only","Injury","Fatal"]).plot(cmap="Blues")
        plt.title("Confusion Matrix - PyTorch DNN", fontweight="bold")
        plt.tight_layout(); plt.show()"""

DNN_NEW = """        plot_confusion_matrices_pair(
            y_test, preds, labels=""" + SEVERITY_LABELS + """,
            title_prefix="PyTorch DNN",
            cmap="Purples",
        )"""

# ── Final RF cell 62 ─────────────────────────────────────────────────────────
RF_OLD = """cm = confusion_matrix(y_test, final_preds)
ConfusionMatrixDisplay(cm, display_labels=["PD-Only","Injury","Fatal"]).plot(
    ax=axes[1], colorbar=False, cmap="Blues")
axes[1].set_title("Confusion Matrix - Final RF Model", fontweight="bold")
plt.tight_layout(); plt.show()"""

RF_NEW = """plt.tight_layout(); plt.show()

plot_confusion_matrices_pair(
    y_test, final_preds, labels=""" + SEVERITY_LABELS + """,
    title_prefix="Final Model — Random Forest (Tuned)",
)"""

for c in cells:
    src = "".join(c.get("source", ""))
    cid = c.get("id", "")

    if OLD_49 in src:
        c["source"] = src.replace(OLD_49, NEW_49)
        print("Patched cell 49 (best baseline CM)")

    if VISION_OLD in src:
        c["source"] = src.replace(VISION_OLD, VISION_NEW)
        c["outputs"] = []
        print("Patched vision CM cell")

    if DNN_OLD in src:
        c["source"] = src.replace(DNN_OLD, DNN_NEW)
        c["outputs"] = []
        print("Patched DNN CM cell")

    if RF_OLD in src:
        c["source"] = src.replace(RF_OLD, RF_NEW)
        # Fix fig layout — only feature importance in first figure
        src2 = "".join(c.get("source", ""))
        src2 = src2.replace(
            "fig, axes = plt.subplots(1, 2, figsize=(16, 5))",
            "fig, ax = plt.subplots(figsize=(8, 5))",
        ).replace(
            "fi_final.plot(kind=\"barh\", ax=axes[0], color=\"#4C72B0\")\naxes[0].set_title",
            "fi_final.plot(kind=\"barh\", ax=ax, color=\"#4C72B0\")\nax.set_title",
        ).replace(
            "axes[0].set_xlabel",
            "ax.set_xlabel",
        ).replace(
            "for bar, val in zip(axes[0].patches, fi_final.values):\n    axes[0].text",
            "for bar, val in zip(ax.patches, fi_final.values):\n    ax.text",
        )
        c["source"] = src2
        c["outputs"] = []
        print("Patched final RF CM cell")

# Remove old 8.3c if re-running
cells = [c for c in cells if c.get("id") not in {"cm_all_md", "cm_all_code"}]

# Insert 8.3c after 8.3b (Evaluate Tuned Models)
insert_at = None
for i, c in enumerate(cells):
    if c["cell_type"] == "code" and "8.3b  Evaluate Tuned Models" in "".join(c.get("source", "")):
        insert_at = i + 1
        break

if insert_at:
    cells.insert(insert_at, CELL_53C_MD)
    cells.insert(insert_at + 1, CELL_53C_CODE)
    print(f"Inserted 8.3c at index {insert_at}")

nb["cells"] = cells
json.dump(nb, open(NB, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
print("DONE")
