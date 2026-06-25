"""Insert Vision Brain section: sample images + CNN fine-tuning."""
import json
from pathlib import Path

NB = Path(__file__).parent / "Captone - Draft.ipynb"
nb = json.load(open(NB, encoding="utf-8"))
cells = nb["cells"]

# Find insert point: after Vision Brain data source reference
insert_at = None
for i, c in enumerate(cells):
    s = "".join(c.get("source", ""))
    if "Vision Brain data source reference" in s or "Vision Brain (Pillar 2)" in s:
        insert_at = i + 1
        break
if insert_at is None:
    for i, c in enumerate(cells):
        s = "".join(c.get("source", ""))
        if "Section 8" in s and "Model Training" in s:
            insert_at = i
            break

NEW = [
    {
        "cell_type": "markdown",
        "id": "vision_impl_md",
        "metadata": {},
        "source": """---
## Section 6 · Vision Brain — Sample Images & Fine-Tuning

**Goal:** Show your manager how the Vision Brain *sees* road conditions, then fine-tune a CNN.

| Step | What you will see |
|------|-------------------|
| **6.1** | Sample images: **Clear asphalt**, **Wet/Slush**, **Snow/Ice** |
| **6.2** | Fine-tune **ResNet18** (transfer learning) on road-surface images |
| **6.3** | Validation accuracy + confusion matrix → feeds **V score** in Safety Score S |

**Data source:** HuggingFace `keremberke/road-surface-classification` (proxy for Ontario RWIS cameras).  
Install once if needed: `pip install datasets torchvision`
""",
    },
    {
        "cell_type": "code",
        "id": "vision_samples",
        "metadata": {},
        "execution_count": None,
        "outputs": [],
        "source": """# ── 6.1  Display sample road-condition images ─────────────────────────────────
# Shows ice/snow vs wet vs clear — the three hazard classes for Vision Brain V score

try:
    import datasets  # noqa: F401
except ImportError:
    import subprocess, sys
    subprocess.check_call([sys.executable, "-m", "pip", "install", "-q", "datasets", "torchvision"])
    print("Installed datasets + torchvision — rerun this cell if import fails.")

from vision_brain import load_sample_images, display_condition_samples, DISPLAY_ORDER

SAMPLES_PER_CLASS = 3   # images shown per condition (increase for richer demo)
sample_images, sample_labels = load_sample_images(n_per_class=SAMPLES_PER_CLASS)

print("Conditions shown:", ", ".join(DISPLAY_ORDER))
print(f"Total sample images: {len(sample_images)}")
display_condition_samples(
    sample_images,
    sample_labels,
    title="Ontario Smart-Shield Vision Brain — Ice vs Wet vs Clear (Sample Frames)",
)
""",
    },
    {
        "cell_type": "markdown",
        "id": "vision_tune_md",
        "metadata": {},
        "source": """### 6.2 · Fine-Tune the Vision Model

We use **transfer learning**: start from ImageNet weights, replace the final layer for 3 road classes, and fine-tune on a subset (~120 images/class for speed).

| Setting | Value | Why |
|---------|-------|-----|
| Backbone | ResNet18 | Fast, good for demo + Colab |
| Input size | 224×224 RGB | Standard CNN input |
| Epochs | 8 | Enough to show learning without long waits |
| Metric | Val accuracy | Simple manager-friendly score |
""",
    },
    {
        "cell_type": "code",
        "id": "vision_finetune",
        "metadata": {},
        "execution_count": None,
        "outputs": [],
        "source": """# ── 6.2  Fine-tune ResNet18 on road-surface conditions ────────────────────────

vision_model = None
vision_history = None
vision_class_names = None
vision_val_acc = None

if not TORCH_OK:
    print("PyTorch not available (TORCH_OK=False). Install torch, restart kernel, rerun.")
else:
    import torch
    from vision_brain import (
        build_training_dataset,
        fine_tune_vision_model,
        plot_vision_training,
        evaluate_vision_model,
        DISPLAY_ORDER,
    )
    from sklearn.metrics import ConfusionMatrixDisplay

    VISION_TRAIN_PER_CLASS = 120   # lower = faster; raise for better accuracy
    VISION_EPOCHS = 8

    print("Building training subset...")
    train_ds, val_ds, vision_class_names = build_training_dataset(max_per_class=VISION_TRAIN_PER_CLASS)
    print(f"Train: {len(train_ds)}  |  Val: {len(val_ds)}  |  Classes: {vision_class_names}")

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Fine-tuning on {device} for {VISION_EPOCHS} epochs...")
    vision_model, vision_history, vision_class_names = fine_tune_vision_model(
        train_ds, val_ds, epochs=VISION_EPOCHS, device=device,
    )
    plot_vision_training(vision_history)

    vision_val_acc, vision_cm, y_true, y_pred = evaluate_vision_model(
        vision_model, val_ds, vision_class_names, device=device,
    )
    print(f"\\nVision Brain validation accuracy: {vision_val_acc:.2%}")

    fig, ax = plt.subplots(figsize=(6, 5))
    ConfusionMatrixDisplay(vision_cm, display_labels=vision_class_names).plot(ax=ax, cmap="Blues")
    ax.set_title("Vision Brain — Confusion Matrix (Snow/Ice vs Wet vs Clear)", fontweight="bold")
    plt.tight_layout()
    plt.show()

    # V-score example: probability of hazard class (Snow/Ice) on one validation image
    vision_model.eval()
    x0, y0 = val_ds[0]
    with torch.no_grad():
        probs = torch.softmax(vision_model(x0.unsqueeze(0).to(device)), dim=1).cpu().numpy()[0]
    ice_idx = vision_class_names.index("Snow / Ice")
    v_score = float(probs[ice_idx])
    print(f"Example V-score (P(Snow/Ice)) on one frame: {v_score:.3f}")
    print("  → This probability feeds the Safety Score S alongside NLP + tabular models.")
""",
    },
]

# Remove old vision impl cells if re-running script
cells = [c for c in cells if c.get("id") not in {"vision_impl_md", "vision_samples", "vision_tune_md", "vision_finetune"}]

if insert_at is not None:
    for j, cell in enumerate(NEW):
        cells.insert(insert_at + j, cell)
    print(f"Inserted {len(NEW)} vision cells at index {insert_at}")
else:
    print("WARNING: insert point not found")

nb["cells"] = cells
json.dump(nb, open(NB, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
print("DONE")
