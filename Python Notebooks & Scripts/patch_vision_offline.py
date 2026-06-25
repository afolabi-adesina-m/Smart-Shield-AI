"""Patch Vision cells: offline-only, no datasets library, force module reload."""
import json
from pathlib import Path

NB = Path(__file__).parent / "Captone - Draft.ipynb"
nb = json.load(open(NB, encoding="utf-8"))

CELL_61 = '''# ── 6.1  Display sample road-condition images ─────────────────────────────────
# Offline-first: reads Data/vision_cache/ or uses demo panels (no HuggingFace at runtime).
# Optional one-time seed: python seed_vision_cache.py

import sys
import importlib
from pathlib import Path

if "vision_brain" in sys.modules:
    del sys.modules["vision_brain"]
import vision_brain
importlib.reload(vision_brain)

from vision_brain import load_sample_images, display_condition_samples, DISPLAY_ORDER, resolve_cache_dir

VISION_CACHE = str((DATA.parent / "Data" / "vision_cache") if "DATA" in dir() else resolve_cache_dir())
SAMPLES_PER_CLASS = 3

sample_images, sample_labels = load_sample_images(
    n_per_class=SAMPLES_PER_CLASS,
    cache_dir=VISION_CACHE,
)

print("Conditions shown:", ", ".join(DISPLAY_ORDER))
print(f"Total sample images: {len(sample_images)}")
display_condition_samples(
    sample_images,
    sample_labels,
    title="Ontario Smart-Shield Vision Brain — Ice vs Wet vs Clear (Sample Frames)",
)
'''

CELL_62 = '''# ── 6.2  Fine-tune ResNet18 on road-surface conditions ────────────────────────

vision_model = None
vision_history = None
vision_class_names = None
vision_val_acc = None

if not TORCH_OK:
    print("PyTorch not available (TORCH_OK=False). Install torch, restart kernel, rerun.")
else:
    import sys
    import importlib
    import torch

    if "vision_brain" in sys.modules:
        del sys.modules["vision_brain"]
    import vision_brain
    importlib.reload(vision_brain)

    from vision_brain import (
        build_training_dataset,
        fine_tune_vision_model,
        plot_vision_training,
        evaluate_vision_model,
        DISPLAY_ORDER,
        resolve_cache_dir,
    )
    from sklearn.metrics import ConfusionMatrixDisplay

    VISION_CACHE = str((DATA.parent / "Data" / "vision_cache") if "DATA" in dir() else resolve_cache_dir())
    VISION_TRAIN_PER_CLASS = 120
    VISION_EPOCHS = 8

    print("Building training subset (offline cache / synthetic)...")
    train_ds, val_ds, vision_class_names = build_training_dataset(
        max_per_class=VISION_TRAIN_PER_CLASS,
        cache_dir=VISION_CACHE,
    )
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

    plot_confusion_matrices_pair(
        y_true, y_pred, labels=vision_class_names,
        title_prefix="Vision Brain (ResNet18)",
        cmap="Greens",
    )

    vision_model.eval()
    x0, y0 = val_ds[0]
    with torch.no_grad():
        probs = torch.softmax(vision_model(x0.unsqueeze(0).to(device)), dim=1).cpu().numpy()[0]
    ice_idx = vision_class_names.index("Snow / Ice")
    v_score = float(probs[ice_idx])
    print(f"Example V-score (P(Snow/Ice)) on one frame: {v_score:.3f}")
    print("  → This probability feeds the Safety Score S alongside NLP + tabular models.")
'''

for i, c in enumerate(nb["cells"]):
    src = "".join(c.get("source", []))
    if "6.1  Display sample road-condition" in src:
        c["source"] = CELL_61
        print(f"Patched cell {i} (6.1)")
    if "6.2  Fine-tune ResNet18" in src:
        c["source"] = CELL_62
        print(f"Patched cell {i} (6.2)")

json.dump(nb, open(NB, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
print("DONE")
