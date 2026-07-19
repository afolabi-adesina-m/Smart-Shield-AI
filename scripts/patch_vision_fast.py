#!/usr/bin/env python3
"""Speed up Vision Brain notebook defaults (CPU-friendly)."""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PATHS = [
    ROOT / "notebooks" / "capstone_with_results.ipynb",
    ROOT / "notebooks" / "parts" / "02_vision_brain.ipynb",
]

# ResNet cell knobs
REPLACEMENTS_62 = [
    (
        "VISION_TRAIN_PER_CLASS = 120      # target volume; oversampling fills train views per epoch\n"
        "    VISION_EPOCHS = 15                # more epochs + early stopping for a trustworthy curve\n"
        "    VISION_LR = 3e-5                  # lower LR for stable ResNet fine-tune on a small cache\n"
        "    VISION_PATIENCE = 4               # stop when val_loss plateaus",
        "VISION_FAST = True                 # CPU-friendly defaults (set False for full fine-tune)\n"
        "    VISION_TRAIN_PER_CLASS = 40 if VISION_FAST else 120\n"
        "    VISION_EPOCHS = 6 if VISION_FAST else 15\n"
        "    VISION_LR = 1e-4 if VISION_FAST else 3e-5   # higher LR ok when backbone is mostly frozen\n"
        "    VISION_PATIENCE = 2 if VISION_FAST else 4",
    ),
    (
        "train_ds, val_ds, vision_class_names = build_training_dataset(\n"
        "        max_per_class=VISION_TRAIN_PER_CLASS,\n"
        "        cache_dir=VISION_CACHE,\n"
        "        target_train_size=VISION_TRAIN_PER_CLASS * len(DISPLAY_ORDER),\n"
        "    )",
        "train_ds, val_ds, vision_class_names = build_training_dataset(\n"
        "        max_per_class=VISION_TRAIN_PER_CLASS,\n"
        "        cache_dir=VISION_CACHE,\n"
        "        target_train_size=VISION_TRAIN_PER_CLASS * len(DISPLAY_ORDER),\n"
        "        fast=VISION_FAST,\n"
        "        max_oversample=4 if VISION_FAST else 6,\n"
        "    )",
    ),
    (
        "vision_model, vision_history, vision_class_names = fine_tune_vision_model(\n"
        "        train_ds, val_ds,\n"
        "        epochs=VISION_EPOCHS,\n"
        "        lr=VISION_LR,\n"
        "        patience=VISION_PATIENCE,\n"
        "        device=device,\n"
        "    )",
        "vision_model, vision_history, vision_class_names = fine_tune_vision_model(\n"
        "        train_ds, val_ds,\n"
        "        epochs=VISION_EPOCHS,\n"
        "        lr=VISION_LR,\n"
        "        patience=VISION_PATIENCE,\n"
        "        device=device,\n"
        "        freeze_backbone=VISION_FAST,\n"
        "    )",
    ),
]

REPLACEMENTS_AE = [
    (
        "VISION_AE_PATIENCE = 3",
        "VISION_AE_PATIENCE = 2 if globals().get('VISION_FAST', True) else 3",
    ),
    (
        "ae_epochs = max(6, VISION_EPOCHS - 2)",
        "ae_epochs = 5 if globals().get('VISION_FAST', True) else max(6, VISION_EPOCHS - 2)",
    ),
]


def patch(path: Path) -> None:
    nb = json.loads(path.read_text(encoding="utf-8"))
    changed = 0
    for cell in nb["cells"]:
        if cell.get("cell_type") != "code":
            continue
        src = "".join(cell.get("source", []))
        orig = src
        if "6.2  Fine-tune ResNet18" in src[:160]:
            for a, b in REPLACEMENTS_62:
                src = src.replace(a, b)
        if "6.2b  Train autoencoder" in src[:160]:
            for a, b in REPLACEMENTS_AE:
                src = src.replace(a, b)
        if src != orig:
            lines = src.split("\n")
            cell["source"] = [ln + "\n" for ln in lines[:-1]] + [lines[-1]]
            changed += 1
    path.write_text(json.dumps(nb, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{path.name}: {changed} cells updated")


def main() -> None:
    for p in PATHS:
        if p.is_file():
            patch(p)


if __name__ == "__main__":
    main()
