#!/usr/bin/env python3
"""Download a balanced subset of HuggingFace RSCD-1M into Data/vision_cache/.

Source: https://huggingface.co/datasets/rezzzq/RSCD-1million
Does not pull the full 1M set — samples PER_LABEL images per surface label.

Usage:
  source .venv/bin/activate
  python scripts/seed_vision_cache_rscd.py
  python scripts/seed_vision_cache_rscd.py --per-label 80
  # Boost Snow / Ice toward ~33% of the training mix:
  python scripts/seed_vision_cache_rscd.py --balance-snow
  python scripts/seed_vision_cache_rscd.py --labels fresh_snow,ice --per-label 200
"""
from __future__ import annotations

import argparse
import random
import sys
from collections import defaultdict
from pathlib import Path

from huggingface_hub import hf_hub_download, list_repo_files
from tqdm import tqdm

REPO = "rezzzq/RSCD-1million"
ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "Data" / "vision_cache"

LABEL_TO_FOLDER = {
    "dry-asphalt-smooth": "dry_asphalt_smooth",
    "dry-asphalt-slight": "dry_asphalt_slight",
    "dry-concrete-smooth": "dry_concrete_smooth",
    "dry-gravel": "dry_gravel",
    "wet-asphalt-smooth": "wet_asphalt_smooth",
    "wet-asphalt-slight": "wet_asphalt_slight",
    "water-asphalt-smooth": "water_asphalt_smooth",
    "wet-concrete-smooth": "wet_concrete_smooth",
    "melted_snow": "melted_snow",
    "fresh_snow": "fresh_snow",
    "ice": "ice",
}

# Fine-grained RSCD labels that map into DISPLAY_ORDER "Snow / Ice"
# (melted_snow is intentionally Wet / Slush in vision_brain.CACHE_FOLDERS)
SNOW_LABELS = ("fresh_snow", "ice")

WANTED = list(LABEL_TO_FOLDER.keys())


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--per-label", type=int, default=40)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument(
        "--labels",
        type=str,
        default="",
        help="Comma-separated RSCD labels to download (default: all). "
             "Example for snow boost: fresh_snow,ice",
    )
    parser.add_argument(
        "--balance-snow",
        action="store_true",
        help="Auto-pick fresh_snow+ice + per-label so Snow/Ice ≈ 33.3%% of usable cache "
             "(keeps existing Clear/Wet counts).",
    )
    args = parser.parse_args()

    wanted = WANTED
    if args.labels.strip():
        wanted = [x.strip() for x in args.labels.split(",") if x.strip()]
        unknown = [x for x in wanted if x not in LABEL_TO_FOLDER]
        if unknown:
            print(f"Unknown labels: {unknown}", file=sys.stderr)
            print(f"Known: {list(LABEL_TO_FOLDER)}", file=sys.stderr)
            return 2

    per_label = args.per_label
    if args.balance_snow:
        wanted = list(SNOW_LABELS)
        sys.path.insert(0, str(ROOT / "src"))
        from collections import Counter

        from vision_brain import _load_all_from_cache

        _, labels, _real = _load_all_from_cache(CACHE)
        counts = Counter(labels)
        clear_n = counts.get("Clear Asphalt", 0)
        wet_n = counts.get("Wet / Slush", 0)
        snow_n = counts.get("Snow / Ice", 0)
        # Exact 1/3 with fixed Clear+Wet: snow = (clear+wet)/2
        target_snow = max(snow_n, int(round((clear_n + wet_n) / 2)))
        need = max(0, target_snow - snow_n)
        # Only download *additional* images, split across snow labels (+small cushion)
        cushion = min(20, max(6, need // 10))
        per_label = max(1, int((need + cushion + len(SNOW_LABELS) - 1) / max(len(SNOW_LABELS), 1)))
        print(
            f"Balance-snow: Clear={clear_n} Wet={wet_n} Snow={snow_n} → "
            f"target Snow≈{target_snow} (+{need} new). "
            f"Downloading ~{per_label} fresh images per {wanted}"
        )
        # When balancing, only pick fresh (uncached) files — never re-select the whole quota
        balance_fresh_only = True
    else:
        balance_fresh_only = False

    print(f"Listing {REPO} files...")
    files = list_repo_files(REPO, repo_type="dataset")
    by_label: dict[str, list[str]] = defaultdict(list)
    for f in files:
        if not f.startswith("train/") or not f.lower().endswith((".jpg", ".jpeg", ".png")):
            continue
        stem = Path(f).stem
        if "-" not in stem:
            continue
        label = stem.split("-", 1)[1]
        if label in LABEL_TO_FOLDER:
            by_label[label].append(f)

    rng = random.Random(args.seed)
    selected: list[tuple[str, str]] = []
    for lab in wanted:
        pool = by_label.get(lab, [])
        rng.shuffle(pool)
        # Prefer files not already in cache so we grow the set
        folder = CACHE / LABEL_TO_FOLDER[lab]
        existing = {p.name for p in folder.glob("*") if p.suffix.lower() in {".jpg", ".jpeg", ".png"}} if folder.is_dir() else set()
        fresh = [f for f in pool if Path(f).name not in existing]
        reuse = [f for f in pool if Path(f).name in existing]
        if balance_fresh_only:
            take = fresh[:per_label]
        else:
            ordered = fresh + reuse
            take = ordered[:per_label]
        print(
            f"  {lab}: available={len(pool)} cached={len(existing)} "
            f"fresh_pick={sum(1 for f in take if Path(f).name not in existing)} selected={len(take)}"
        )
        selected.extend((lab, f) for f in take)

    print(f"Downloading {len(selected)} images → {CACHE}")
    ok = fail = 0
    for lab, rel in tqdm(selected, desc="RSCD"):
        dest_dir = CACHE / LABEL_TO_FOLDER[lab]
        dest_dir.mkdir(parents=True, exist_ok=True)
        dest = dest_dir / Path(rel).name
        mirrors = []
        if lab == "wet-asphalt-smooth":
            mirrors.append(CACHE / "wet" / Path(rel).name)
        if lab.startswith("dry-asphalt"):
            mirrors.append(CACHE / "clear" / Path(rel).name)
        if lab == "fresh_snow":
            mirrors.append(CACHE / "snow" / Path(rel).name)
        try:
            if not dest.exists() or dest.stat().st_size == 0:
                local = hf_hub_download(REPO, filename=rel, repo_type="dataset")
                data = Path(local).read_bytes()
                dest.write_bytes(data)
            else:
                data = dest.read_bytes()
            for m in mirrors:
                m.parent.mkdir(parents=True, exist_ok=True)
                if not m.exists():
                    m.write_bytes(data)
            ok += 1
        except Exception as exc:
            fail += 1
            if fail <= 5:
                print("fail", rel, exc)

    print(f"Done. ok={ok} fail={fail}")
    sys.path.insert(0, str(ROOT / "src"))
    from collections import Counter

    from vision_brain import _load_all_from_cache

    _, labels, real = _load_all_from_cache(CACHE)
    print("usable by class:", dict(Counter(labels)), "real=", real)
    return 0 if fail == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
