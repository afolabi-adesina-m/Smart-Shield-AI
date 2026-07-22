#!/usr/bin/env python3
"""Retrain Vision Brain (ResNet18 + AE) from Data/vision_cache and save models/.

Usage:
  source .venv/bin/activate
  python scripts/retrain_vision_brain.py
  python scripts/retrain_vision_brain.py --full   # longer training, unfrozen backbone
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
sys.path.insert(0, str(SRC))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--full",
        action="store_true",
        help="Full fine-tune (more epochs, unfrozen backbone). Default is FAST/CPU-friendly.",
    )
    parser.add_argument("--epochs-resnet", type=int, default=None)
    parser.add_argument("--epochs-ae", type=int, default=None)
    args = parser.parse_args()

    import torch
    from vision_brain import (
        DISPLAY_ORDER,
        build_clear_only_dataset,
        build_training_dataset,
        calibrate_anomaly_threshold,
        compare_vision_backends,
        evaluate_vision_model,
        fine_tune_vision_model,
        resolve_cache_dir,
        save_vision_artifacts,
        train_road_autoencoder,
    )

    fast = not args.full
    per_class = 40 if fast else 120
    epochs_resnet = args.epochs_resnet or (6 if fast else 12)
    epochs_ae = args.epochs_ae or (12 if fast else 20)
    patience_r = 2 if fast else 4
    lr = 1e-4 if fast else 3e-5

    cache = resolve_cache_dir()
    print(f"Cache: {cache}")
    print(f"Mode: {'FAST' if fast else 'FULL'} | device check…")
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Device: {device}")

    print("\n=== 1/4 Build ResNet dataset ===")
    train_ds, val_ds, class_names = build_training_dataset(
        max_per_class=per_class,
        cache_dir=str(cache),
        target_train_size=per_class * len(DISPLAY_ORDER),
        fast=fast,
        max_oversample=4 if fast else 6,
    )
    print(f"Classes: {class_names}")
    print(f"Train views/epoch={len(train_ds)} | val={len(val_ds)}")

    print(f"\n=== 2/4 Fine-tune ResNet18 (epochs≤{epochs_resnet}) ===")
    vision_model, history, class_names = fine_tune_vision_model(
        train_ds,
        val_ds,
        epochs=epochs_resnet,
        lr=lr,
        patience=patience_r,
        device=device,
        freeze_backbone=fast,
    )
    acc, *_ = evaluate_vision_model(vision_model, val_ds, class_names, device=device)
    print(f"Validation accuracy: {acc:.2%}")
    print(f"Best epoch hint: {history.get('best_epoch')}")

    print(f"\n=== 3/4 Train clear-road autoencoder (epochs≤{epochs_ae}) ===")
    ae_train, ae_val = build_clear_only_dataset(
        max_per_class=max(80, per_class * 2),
        cache_dir=str(cache),
    )
    print(f"AE train={len(ae_train)} | AE val={len(ae_val)}")
    ae_model, ae_hist = train_road_autoencoder(
        ae_train,
        ae_val,
        epochs=epochs_ae,
        patience=4 if fast else 6,
        device=device,
    )
    anomaly_threshold = calibrate_anomaly_threshold(ae_model, ae_val, device=device)
    print(f"Anomaly threshold: {anomaly_threshold:.6f}")

    print("\n=== 4/4 Compare backends + save artifacts ===")
    comparison_df, selection = compare_vision_backends(
        vision_model,
        ae_model,
        val_ds,
        class_names,
        anomaly_threshold=anomaly_threshold,
        device=device,
        max_per_class=min(40, per_class),
    )
    print(comparison_df.to_string(index=False))
    print(
        f"\nSelected: {selection.get('selected_backend')} "
        f"(hybrid={selection.get('use_hybrid')}) — {selection.get('reason')}"
    )

    models_dir = ROOT / "models"
    out = save_vision_artifacts(
        vision_model,
        ae_model,
        anomaly_threshold,
        models_dir=models_dir,
        selection=selection,
        comparison_records=comparison_df.to_dict(orient="records"),
    )
    print(f"\nSaved vision artifacts → {models_dir}")
    print(f"Meta: {out}")

    # Sanity: Clear < Wet < Snow on selected row
    row = comparison_df[comparison_df["Backend"] == selection["selected_backend"]]
    if not row.empty:
        r = row.iloc[0]
        ok = bool(r.get("Ranking OK (Snow≥Wet≥Clear)"))
        print(
            f"Ranking check: Clear={r['Mean V | Clear']}  "
            f"Wet={r['Mean V | Wet/Slush']}  Snow={r['Mean V | Snow/Ice']}  OK={ok}"
        )
        if not ok:
            print("WARNING: ranking not monotonic — inspect comparison table before demo use.")
            return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
