"""One-time optional script: download a few RSCD photos into Data/vision_cache/.

Run once when online (after `hf auth login`):
    conda activate ai_work_final
    python seed_vision_cache.py

The notebook never calls HuggingFace — it only reads this local folder.
"""
from pathlib import Path
from shutil import copy2

from PIL import Image

HF_DATASET = "rezzzq/RSCD-1million"
HERE = Path(__file__).resolve().parent
CACHE = HERE.parent / "Data" / "vision_cache"

# Known-good paths on the Hub (direct file download — no datasets.load_dataset)
SEED_FILES = {
    "dry_asphalt_smooth": [
        "train/dry_asphalt_smooth/202201252341401-dry-asphalt-smooth.jpg",
        "train/dry_asphalt_smooth/202201252342232-dry-asphalt-smooth.jpg",
        "train/dry_asphalt_smooth/202201252343337-dry-asphalt-smooth.jpg",
    ],
    "clear": [],  # filled from dry_asphalt after download
    "wet": [],
    "snow": [],
}


def _copy_hf_snapshot():
    """Copy any images already in the local HF cache."""
    snap_root = Path.home() / ".cache/huggingface/hub/datasets--rezzzq--RSCD-1million/snapshots"
    if not snap_root.is_dir():
        return 0
    snap = sorted(snap_root.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True)[0]
    n = 0
    for folder in snap.joinpath("train").iterdir():
        if not folder.is_dir():
            continue
        out = CACHE / folder.name
        out.mkdir(parents=True, exist_ok=True)
        for img in folder.glob("*.jpg"):
            copy2(img, out / img.name)
            n += 1
    return n


def _download_known():
    from huggingface_hub import hf_hub_download

    n = 0
    for folder, paths in SEED_FILES.items():
        if not paths:
            continue
        out = CACHE / folder
        out.mkdir(parents=True, exist_ok=True)
        for rel in paths:
            try:
                local = hf_hub_download(HF_DATASET, rel, repo_type="dataset")
                dest = out / Path(rel).name
                copy2(local, dest)
                n += 1
            except Exception as exc:
                print(f"  skip {rel}: {exc}")
    return n


def _write_synthetic_class_folders():
    """Ensure wet/snow/clear folders exist with demo panels if Hub download failed."""
    import numpy as np

    specs = {
        "clear": (60, 60, 60),
        "wet": (90, 110, 130),
        "snow": (220, 225, 235),
    }
    n = 0
    for folder, rgb in specs.items():
        out = CACHE / folder
        if any(out.glob("*.jpg")):
            continue
        out.mkdir(parents=True, exist_ok=True)
        for i in range(3):
            arr = np.zeros((224, 224, 3), dtype=np.uint8)
            arr[:] = rgb
            Image.fromarray(arr).save(out / f"demo_{i:02d}.jpg")
            n += 1
    return n


def main():
    CACHE.mkdir(parents=True, exist_ok=True)
    print(f"Seeding {CACHE} ...")
    n1 = _copy_hf_snapshot()
    print(f"  HF snapshot copies : {n1}")
    n2 = _download_known()
    print(f"  Hub downloads      : {n2}")
    # mirror dry photos into 'clear' alias folder
    dry = CACHE / "dry_asphalt_smooth"
    clear = CACHE / "clear"
    clear.mkdir(exist_ok=True)
    for img in dry.glob("*.jpg"):
        copy2(img, clear / img.name)
    n3 = _write_synthetic_class_folders()
    print(f"  synthetic demos    : {n3}")
    print("Done. Re-run the notebook — Vision section is now fully offline.")


if __name__ == "__main__":
    main()
