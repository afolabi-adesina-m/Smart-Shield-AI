"""Vision Brain helpers — offline-first road-condition samples + ResNet18 fine-tuning.

Runtime never calls `datasets.load_dataset` (broken for RSCD on Hub).
Images load from local `Data/vision_cache/` or synthetic panels.
Optional one-time seeding: run `seed_vision_cache.py` when online.

Hybrid Vision Brain (Section 6.2b):
  - ResNet18 classifier → V_class (supervised hazard probability)
  - Conv autoencoder on Clear Asphalt → V_anomaly (reconstruction error)
  - Fused V_vision = alpha * V_class + (1 - alpha) * V_anomaly
"""

from __future__ import annotations

from pathlib import Path
from typing import Dict, List, Optional, Tuple

import matplotlib.pyplot as plt
import numpy as np

DISPLAY_ORDER = ["Clear Asphalt", "Wet / Slush", "Snow / Ice"]
CLASS_TO_IDX = {name: i for i, name in enumerate(DISPLAY_ORDER)}

# Maps cache subfolder names -> display class (real RSCD folders first; demo_* last)
CACHE_FOLDERS: Dict[str, List[str]] = {
    "Clear Asphalt": [
        "clear", "dry_asphalt_smooth", "dry_asphalt_slight",
        "dry_concrete_smooth", "dry_gravel",
    ],
    "Wet / Slush": [
        "wet_asphalt_smooth", "wet_asphalt_slight", "water_asphalt_smooth",
        "wet_concrete_smooth", "melted_snow", "wet",
    ],
    "Snow / Ice": ["fresh_snow", "ice", "snow"],
}


def resolve_cache_dir(cache_dir: Optional[str] = None) -> Path:
    """Find project data/vision_cache from repo root."""
    if cache_dir:
        return Path(cache_dir)
    here = Path(__file__).resolve().parent
    repo = here.parent
    candidates = [
        repo / "Data" / "vision_cache",
        repo / "data" / "vision_cache",
        Path.cwd().parent / "Data" / "vision_cache",
        Path.cwd() / "Data" / "vision_cache",
    ]
    for p in candidates:
        if p.is_dir():
            return p
    return repo / "data" / "vision_cache"


def _is_placeholder_image(arr: np.ndarray) -> bool:
    """Reject solid-colour demo panels (seed_vision_cache demo_*.jpg)."""
    if arr.ndim != 3 or arr.shape[2] != 3:
        return True
    small = arr
    if small.shape[0] > 128 or small.shape[1] > 128:
        step = max(small.shape[0], small.shape[1]) // 64
        small = small[::step, ::step]
    flat = small.reshape(-1, 3)
    if flat.shape[0] < 16:
        return True
    # Solid demo panels have almost no colour diversity; real road photos have hundreds+.
    if len(np.unique(flat, axis=0)) < 48:
        return True
    return False


def _synthetic_road_panel(cond: str, seed: int) -> np.ndarray:
    """Procedural road texture when no cached photo exists — not a flat colour block."""
    rng = np.random.default_rng(seed + hash(cond) % 10_000)
    h, w = 224, 224
    yy, xx = np.mgrid[0:h, 0:w]

    if cond == "Clear Asphalt":
        base = rng.integers(48, 78, (h, w), dtype=np.uint8)
        grain = rng.integers(-18, 18, (h, w), dtype=np.int16)
        arr = np.stack([base, base, base], axis=-1).astype(np.int16) + grain[..., None]
    elif cond == "Wet / Slush":
        base = rng.integers(55, 95, (h, w), dtype=np.uint8)
        sheen = (np.sin(xx / 14.0) * np.cos(yy / 11.0) * 22).astype(np.int16)
        arr = np.stack([base - 8, base + 6, base + 28], axis=-1).astype(np.int16) + sheen[..., None]
        arr += rng.integers(-12, 12, (h, w, 3), dtype=np.int16)
    else:  # Snow / Ice
        base = rng.integers(185, 225, (h, w), dtype=np.uint8)
        drift = rng.integers(-20, 20, (h, w), dtype=np.int16)
        arr = np.stack([base, base + 4, base + 10], axis=-1).astype(np.int16) + drift[..., None]
        arr += rng.integers(-14, 14, (h, w, 3), dtype=np.int16)

    return np.clip(arr, 0, 255).astype(np.uint8)


def _synthetic_samples(n_per_class: int) -> Tuple[List, List[str]]:
    """Deterministic textured demo panels — always available, no network."""
    images, labels = [], []
    for cond in DISPLAY_ORDER:
        for i in range(n_per_class):
            images.append(_synthetic_road_panel(cond, i))
            labels.append(cond)
    return images, labels


def _load_from_cache(cache_dir: Path, n_per_class: int) -> Tuple[List, List[str]]:
    """Load JPEG/PNG from vision_cache subfolders; fill gaps with synthetic."""
    from PIL import Image

    buckets: Dict[str, list] = {c: [] for c in DISPLAY_ORDER}

    for cond, folder_names in CACHE_FOLDERS.items():
        for folder in folder_names:
            if len(buckets[cond]) >= n_per_class:
                break
            folder_path = cache_dir / folder
            if not folder_path.is_dir():
                continue
            for img_path in sorted(folder_path.glob("*")):
                if img_path.suffix.lower() not in {".jpg", ".jpeg", ".png", ".webp"}:
                    continue
                if len(buckets[cond]) >= n_per_class:
                    break
                try:
                    arr = np.array(Image.open(img_path).convert("RGB"))
                    if _is_placeholder_image(arr):
                        continue
                    buckets[cond].append(arr)
                except Exception:
                    continue

    images, labels = [], []
    real = 0
    for cond in DISPLAY_ORDER:
        have = len(buckets[cond])
        real += have
        # Cycle real photos before falling back to procedural panels
        if have and have < n_per_class:
            idx = 0
            while len(buckets[cond]) < n_per_class:
                buckets[cond].append(buckets[cond][idx % have])
                idx += 1
        if len(buckets[cond]) < n_per_class:
            syn, syn_lbl = _synthetic_samples(n_per_class - len(buckets[cond]))
            for arr, lbl in zip(syn, syn_lbl):
                if lbl == cond:
                    buckets[cond].append(arr)
        for arr in buckets[cond][:n_per_class]:
            images.append(arr)
            labels.append(cond)

    return images, labels, real


def sync_cache_from_hf_snapshot(cache_dir: Path) -> int:
    """Copy any locally cached RSCD train images into vision_cache (offline, no API)."""
    from shutil import copy2

    snap_root = Path.home() / ".cache/huggingface/hub/datasets--rezzzq--RSCD-1million/snapshots"
    if not snap_root.is_dir():
        return 0
    snap = max(snap_root.iterdir(), key=lambda p: p.stat().st_mtime)
    train_root = snap / "train"
    if not train_root.is_dir():
        return 0

    copied = 0
    for folder in train_root.iterdir():
        if not folder.is_dir():
            continue
        out = cache_dir / folder.name
        out.mkdir(parents=True, exist_ok=True)
        for img in folder.glob("*.jpg"):
            dest = out / img.name
            if not dest.exists():
                copy2(img, dest)
                copied += 1
    return copied


def _load_all_from_cache(cache_dir: Path) -> Tuple[List[np.ndarray], List[str], int]:
    """Load every non-placeholder photo per surface class (deduplicated)."""
    from PIL import Image

    buckets: Dict[str, List[np.ndarray]] = {c: [] for c in DISPLAY_ORDER}
    seen: set = set()

    for cond, folder_names in CACHE_FOLDERS.items():
        for folder in folder_names:
            folder_path = cache_dir / folder
            if not folder_path.is_dir():
                continue
            for img_path in sorted(folder_path.glob("*")):
                if img_path.suffix.lower() not in {".jpg", ".jpeg", ".png", ".webp"}:
                    continue
                try:
                    digest = img_path.stat().st_size ^ hash(img_path.name)
                    if digest in seen:
                        continue
                    arr = np.array(Image.open(img_path).convert("RGB"))
                    if _is_placeholder_image(arr):
                        continue
                    seen.add(digest)
                    buckets[cond].append(arr)
                except Exception:
                    continue

    images, labels = [], []
    real = 0
    for cond in DISPLAY_ORDER:
        for arr in buckets[cond]:
            images.append(arr)
            labels.append(cond)
            real += 1
    return images, labels, real


def _stratified_split(
    arrays: List[np.ndarray],
    labels: List[str],
    val_frac: float = 0.2,
    seed: int = 42,
) -> Tuple[List, List, List, List]:
    """Per-class train/val split so each class appears in validation when possible."""
    rng = np.random.default_rng(seed)
    by_class: Dict[str, List[int]] = {c: [] for c in DISPLAY_ORDER}
    for i, lbl in enumerate(labels):
        by_class[lbl].append(i)

    train_idx, val_idx = [], []
    for cond in DISPLAY_ORDER:
        idxs = by_class[cond]
        if not idxs:
            continue
        rng.shuffle(idxs)
        n_val = max(1, int(round(len(idxs) * val_frac))) if len(idxs) >= 3 else 1
        n_val = min(n_val, len(idxs) - 1) if len(idxs) > 1 else 1
        val_idx.extend(idxs[:n_val])
        train_idx.extend(idxs[n_val:])

    if not train_idx:
        train_idx, val_idx = val_idx, train_idx

    tr_a = [arrays[i] for i in train_idx]
    tr_y = [labels[i] for i in train_idx]
    va_a = [arrays[i] for i in val_idx]
    va_y = [labels[i] for i in val_idx]
    return tr_a, tr_y, va_a, va_y


def load_sample_images(n_per_class: int = 3, cache_dir: Optional[str] = None) -> Tuple[List, List[str]]:
    """Load road-condition sample images (local cache + synthetic fill). No HuggingFace at runtime."""
    cache = resolve_cache_dir(cache_dir)
    cache.mkdir(parents=True, exist_ok=True)

    images, labels, real = _load_from_cache(cache, n_per_class)
    if real == 0:
        print("Vision cache empty — using offline demo panels (run seed_vision_cache.py once for real photos).")
    elif real < len(images):
        print(f"Loaded {real} cached photos + synthetic fill from {cache}.")
    else:
        print(f"Loaded {len(images)} cached photos from {cache}.")
    return images, labels


def display_condition_samples(images: List, labels: List[str], title: str = "Road Surface Conditions — Sample Images") -> None:
    """Show a grid: one row per condition (Clear, Wet/Slush, Snow/Ice)."""
    if not images:
        print("No images to display.")
        return

    by_cond: Dict[str, List] = {c: [] for c in DISPLAY_ORDER}
    for img, lbl in zip(images, labels):
        if lbl in by_cond:
            by_cond[lbl].append(img)

    n_cols = max(len(v) for v in by_cond.values()) or 1
    fig, axes = plt.subplots(len(DISPLAY_ORDER), n_cols, figsize=(3.2 * n_cols, 3.2 * len(DISPLAY_ORDER)))
    if len(DISPLAY_ORDER) == 1:
        axes = np.array([axes])
    fig.suptitle(title, fontsize=13, fontweight="bold", y=1.02)

    for row, cond in enumerate(DISPLAY_ORDER):
        row_imgs = by_cond[cond]
        for col in range(n_cols):
            ax = axes[row, col] if n_cols > 1 else axes[row]
            ax.axis("off")
            if col < len(row_imgs):
                ax.imshow(row_imgs[col])
            else:
                ax.set_visible(False)
        axes[row, 0].set_title(cond, loc="left", fontsize=10, fontweight="bold", pad=8)

    plt.tight_layout()
    plt.show()


def _build_synthetic_training_dataset(max_per_class: int, transform):
    """Last-resort training set — procedural panels only when zero real photos exist."""
    import torch
    from PIL import Image
    from torch.utils.data import TensorDataset

    images, labels = _synthetic_samples(max_per_class)
    xs = [transform(Image.fromarray(arr)) for arr in images]
    ys = [CLASS_TO_IDX[lbl] for lbl in labels]

    X = torch.stack(xs)
    y = torch.tensor(ys, dtype=torch.long)
    n = len(y)
    perm = torch.randperm(n)
    split = int(0.8 * n)
    tr, va = perm[:split], perm[split:]
    print("WARNING: training on procedural panels only — metrics are demo-grade, not deployment-grade.")
    return TensorDataset(X[tr], y[tr]), TensorDataset(X[va], y[va]), DISPLAY_ORDER


class _AugmentedRoadDataset:
    """On-the-fly augmentation with oversampling — new view each epoch for small caches."""

    def __init__(self, arrays, labels, transform, oversample: int = 1):
        import torch

        self.arrays = arrays
        self.labels = [CLASS_TO_IDX[l] for l in labels]
        self.transform = transform
        self.oversample = max(1, int(oversample))

    def __len__(self):
        return len(self.arrays) * self.oversample

    def __getitem__(self, idx):
        from PIL import Image

        i = idx % len(self.arrays)
        img = Image.fromarray(self.arrays[i])
        return self.transform(img), self.labels[i]


def build_training_dataset(
    max_per_class: int = 120,
    cache_dir: Optional[str] = None,
    target_train_size: Optional[int] = None,
    fast: bool = False,
    max_oversample: int = 6,
):
    """Build train/val sets from all cached RSCD photos with augmentation.

    fast=True: lighter transforms + tighter oversample cap (CPU-friendly).
    """
    from torchvision import transforms

    imagenet_norm = transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225])
    if fast:
        train_tf = transforms.Compose([
            transforms.Resize((224, 224)),
            transforms.RandomHorizontalFlip(),
            transforms.ToTensor(),
            imagenet_norm,
        ])
        oversample_cap = min(max_oversample, 4)
    else:
        train_tf = transforms.Compose([
            transforms.Resize((256, 256)),
            transforms.RandomResizedCrop(224, scale=(0.72, 1.0)),
            transforms.RandomHorizontalFlip(),
            transforms.ColorJitter(brightness=0.2, contrast=0.2, saturation=0.15, hue=0.03),
            transforms.ToTensor(),
            imagenet_norm,
        ])
        oversample_cap = max_oversample
    val_tf = transforms.Compose([
        transforms.Resize((224, 224)),
        transforms.ToTensor(),
        imagenet_norm,
    ])

    cache = resolve_cache_dir(cache_dir)
    cache.mkdir(parents=True, exist_ok=True)
    added = sync_cache_from_hf_snapshot(cache)
    if added:
        print(f"Synced {added} RSCD photo(s) from local HuggingFace cache → {cache}")

    images, labels, real = _load_all_from_cache(cache)
    per_class = {c: sum(1 for l in labels if l == c) for c in DISPLAY_ORDER}
    print(f"Real photos by class: {per_class}  (total={real})")

    if real == 0:
        print("Vision cache empty — using offline procedural training set.")
        basic = transforms.Compose([transforms.Resize((224, 224)), transforms.ToTensor()])
        return _build_synthetic_training_dataset(max_per_class, basic)

    tr_a, tr_y, va_a, va_y = _stratified_split(images, labels, val_frac=0.22)

    # Fill missing classes with a few procedural panels so training does not collapse
    for cond in DISPLAY_ORDER:
        if cond not in tr_y and cond not in va_y:
            syn, syn_lbl = _synthetic_samples(4)
            for arr, lbl in zip(syn, syn_lbl):
                if lbl == cond:
                    tr_a.append(arr)
                    tr_y.append(lbl)

    target = target_train_size or max_per_class * len(DISPLAY_ORDER)
    # Cap oversample — tiny caches were expanding to 20–30× and grinding on CPU
    oversample = min(oversample_cap, max(2, target // max(len(tr_a), 1)))
    train_ds = _AugmentedRoadDataset(tr_a, tr_y, train_tf, oversample=oversample)
    val_ds = _AugmentedRoadDataset(va_a, va_y, val_tf, oversample=1)

    print(
        f"Training on {real} unique RSCD photos | "
        f"train views/epoch={len(train_ds)} | val={len(val_ds)} | oversample×{oversample}"
        + (" | FAST mode" if fast else "")
    )
    return train_ds, val_ds, DISPLAY_ORDER


def fine_tune_vision_model(
    train_ds,
    val_ds,
    epochs: int = 12,
    lr: float = 3e-5,
    weight_decay: float = 1e-4,
    patience: int = 4,
    device=None,
    freeze_backbone: bool = False,
):
    """Fine-tune ResNet18 with regularization and early stopping on validation loss.

    freeze_backbone=True trains only the final FC (+ last residual block) — much faster on CPU.
    """
    import copy
    import torch
    import torch.nn as nn
    from torch.utils.data import DataLoader
    from torchvision import models

    if device is None:
        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    model = models.resnet18(weights=models.ResNet18_Weights.IMAGENET1K_V1)
    model.fc = nn.Linear(model.fc.in_features, len(DISPLAY_ORDER))

    if freeze_backbone:
        for p in model.parameters():
            p.requires_grad = False
        for p in model.layer4.parameters():
            p.requires_grad = True
        for p in model.fc.parameters():
            p.requires_grad = True
        print("ResNet18: backbone frozen (training layer4 + fc only).")

    model = model.to(device)

    criterion = nn.CrossEntropyLoss()
    trainable = [p for p in model.parameters() if p.requires_grad]
    optimizer = torch.optim.AdamW(trainable, lr=lr, weight_decay=weight_decay)

    batch = min(16, max(4, len(train_ds) // 4))
    train_dl = DataLoader(train_ds, batch_size=batch, shuffle=True, drop_last=len(train_ds) > batch)
    val_dl = DataLoader(val_ds, batch_size=batch)

    history = {"train_loss": [], "val_loss": [], "val_acc": []}
    best_val_loss = float("inf")
    best_state = None
    stale = 0

    try:
        for epoch in range(epochs):
            model.train()
            total_loss = 0.0
            for xb, yb in train_dl:
                xb, yb = xb.to(device), yb.to(device)
                optimizer.zero_grad()
                loss = criterion(model(xb), yb)
                loss.backward()
                optimizer.step()
                total_loss += loss.item() * len(xb)
            train_loss = total_loss / max(len(train_ds), 1)

            model.eval()
            correct = total = 0
            val_loss_acc = 0.0
            with torch.no_grad():
                for xb, yb in val_dl:
                    xb, yb = xb.to(device), yb.to(device)
                    logits = model(xb)
                    val_loss_acc += criterion(logits, yb).item() * len(xb)
                    pred = logits.argmax(1)
                    correct += (pred == yb).sum().item()
                    total += len(yb)
            val_loss = val_loss_acc / max(total, 1)
            val_acc = correct / max(total, 1)

            history["train_loss"].append(train_loss)
            history["val_loss"].append(val_loss)
            history["val_acc"].append(val_acc)
            print(
                f"  Epoch {epoch+1}/{epochs}  "
                f"loss={train_loss:.4f}  val_loss={val_loss:.4f}  val_acc={val_acc:.2%}"
            )

            if val_loss < best_val_loss - 1e-4:
                best_val_loss = val_loss
                best_state = copy.deepcopy(model.state_dict())
                stale = 0
            else:
                stale += 1
                if stale >= patience:
                    print(f"  Early stop at epoch {epoch+1} (val_loss plateau, patience={patience}).")
                    break
    except KeyboardInterrupt:
        print("\nTraining interrupted by user. Returning the model trained so far.")

    if best_state is not None:
        model.load_state_dict(best_state)
        print(f"Restored best checkpoint (val_loss={best_val_loss:.4f}).")

    return model, history, DISPLAY_ORDER


def plot_vision_training(history: dict) -> None:
    fig, ax1 = plt.subplots(figsize=(10, 4.5))
    epochs = range(1, len(history["train_loss"]) + 1)
    ax1.plot(epochs, history["train_loss"], color="#4C72B0", marker="o", label="Train loss")
    if "val_loss" in history:
        ax1.plot(epochs, history["val_loss"], color="#55A868", marker="s", label="Val loss")
    ax1.set_xlabel("Epoch")
    ax1.set_ylabel("Loss")
    ax2 = ax1.twinx()
    ax2.plot(epochs, history["val_acc"], color="#DD8452", marker="^", label="Val accuracy")
    ax2.set_ylabel("Val accuracy", color="#DD8452")
    ax2.set_ylim(0, 1.05)

    h1, l1 = ax1.get_legend_handles_labels()
    h2, l2 = ax2.get_legend_handles_labels()
    ax1.legend(
        h1 + h2,
        l1 + l2,
        loc="upper center",
        bbox_to_anchor=(0.5, 1.14),
        ncol=3,
        framealpha=0.95,
        fontsize=9,
    )

    plt.title("Vision Brain — Fine-Tuning Curve (early-stopped best checkpoint)", fontweight="bold", pad=28)
    fig.subplots_adjust(top=0.82)
    plt.show()


def evaluate_vision_model(model, val_ds, class_names, device=None):
    """Return accuracy and confusion matrix arrays."""
    import torch
    from sklearn.metrics import accuracy_score, confusion_matrix

    if device is None:
        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    model.eval()
    ys, preds = [], []
    with torch.no_grad():
        for xb, yb in torch.utils.data.DataLoader(val_ds, batch_size=32):
            xb = xb.to(device)
            out = model(xb).argmax(1).cpu().numpy()
            preds.extend(out)
            ys.extend(yb.numpy())

    acc = accuracy_score(ys, preds)
    cm = confusion_matrix(ys, preds, labels=list(range(len(class_names))))
    return acc, cm, np.array(ys), np.array(preds)


# ── Hybrid Vision Brain: autoencoder anomaly branch (Section 6.2b) ─────────────

# Default fusion weight: supervised classifier vs unsupervised anomaly sensor
V_FUSION_ALPHA = 0.70  # weight on ResNet V_class; remainder on V_anomaly

CLEAR_CLASS = "Clear Asphalt"
HAZARD_CLASSES = ("Wet / Slush", "Snow / Ice")


def build_clear_only_dataset(max_per_class: int = 120, cache_dir: Optional[str] = None):
    """TensorDataset of Clear Asphalt frames for autoencoder training (unsupervised)."""
    import torch
    from PIL import Image
    from torch.utils.data import TensorDataset
    from torchvision import transforms

    transform = transforms.Compose([
        transforms.Resize((224, 224)),
        transforms.ToTensor(),
    ])
    cache = resolve_cache_dir(cache_dir)
    sync_cache_from_hf_snapshot(cache)
    images, labels, _real = _load_all_from_cache(cache)
    clear_arrs = [arr for arr, lbl in zip(images, labels) if lbl == CLEAR_CLASS]
    if not clear_arrs:
        syn, syn_lbl = _synthetic_samples(max_per_class)
        clear_arrs = [arr for arr, lbl in zip(syn, syn_lbl) if lbl == CLEAR_CLASS]

    xs = [transform(Image.fromarray(arr)) for arr in clear_arrs]
    # Cap repeats — AE on tiny clear caches was needlessly large
    target_n = min(max_per_class, max(12, len(xs) * 4))
    reps = max(1, target_n // max(len(xs), 1))
    xs = xs * reps
    X = torch.stack(xs)
    n = len(X)
    perm = torch.randperm(n)
    split = max(1, int(0.85 * n))
    tr, va = perm[:split], perm[split:] if split < n else perm[:1]
    print(f"Autoencoder: {len(clear_arrs)} clear frames -> {len(X)} samples (train={len(tr)}, val={len(va)})")
    return TensorDataset(X[tr]), TensorDataset(X[va])


def _make_road_autoencoder():
    """Convolutional autoencoder for 224x224 RGB road frames."""
    import torch.nn as nn

    class RoadAutoencoder(nn.Module):
        def __init__(self, latent_dim: int = 128):
            super().__init__()
            self.encoder = nn.Sequential(
                nn.Conv2d(3, 32, 3, stride=2, padding=1),
                nn.ReLU(),
                nn.Conv2d(32, 64, 3, stride=2, padding=1),
                nn.ReLU(),
                nn.Conv2d(64, 128, 3, stride=2, padding=1),
                nn.ReLU(),
                nn.Flatten(),
                nn.Linear(128 * 28 * 28, latent_dim),
            )
            self.decoder = nn.Sequential(
                nn.Linear(latent_dim, 128 * 28 * 28),
                nn.ReLU(),
                nn.Unflatten(1, (128, 28, 28)),
                nn.ConvTranspose2d(128, 64, 4, stride=2, padding=1),
                nn.ReLU(),
                nn.ConvTranspose2d(64, 32, 4, stride=2, padding=1),
                nn.ReLU(),
                nn.ConvTranspose2d(32, 3, 4, stride=2, padding=1),
                nn.Sigmoid(),
            )

        def forward(self, x):
            return self.decoder(self.encoder(x))

        def encode(self, x):
            return self.encoder(x)

    return RoadAutoencoder()


def train_road_autoencoder(
    train_ds,
    val_ds,
    epochs: int = 6,
    lr: float = 1e-3,
    patience: int = 3,
    min_delta: float = 1e-5,
    device=None,
):
    """Train AE on clear-road images with early stopping on val MSE. Returns (model, history)."""
    import copy
    import torch
    import torch.nn as nn
    from torch.utils.data import DataLoader

    if device is None:
        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    model = _make_road_autoencoder().to(device)
    criterion = nn.MSELoss()
    optimizer = torch.optim.Adam(model.parameters(), lr=lr)

    train_dl = DataLoader(train_ds, batch_size=16, shuffle=True)
    val_dl = DataLoader(val_ds, batch_size=16)

    history = {"train_loss": [], "val_loss": [], "best_epoch": None}
    best_val_loss = float("inf")
    best_state = None
    best_epoch = 0
    stale = 0

    try:
        for epoch in range(epochs):
            model.train()
            total = 0.0
            for (xb,) in train_dl:
                xb = xb.to(device)
                optimizer.zero_grad()
                loss = criterion(model(xb), xb)
                loss.backward()
                optimizer.step()
                total += loss.item() * len(xb)
            train_loss = total / max(len(train_ds), 1)

            model.eval()
            vtotal = 0.0
            with torch.no_grad():
                for (xb,) in val_dl:
                    xb = xb.to(device)
                    vtotal += criterion(model(xb), xb).item() * len(xb)
            val_loss = vtotal / max(len(val_ds), 1)
            history["train_loss"].append(train_loss)
            history["val_loss"].append(val_loss)
            print(f"  AE Epoch {epoch+1}/{epochs}  train_mse={train_loss:.5f}  val_mse={val_loss:.5f}")

            if val_loss < best_val_loss - min_delta:
                best_val_loss = val_loss
                best_state = copy.deepcopy(model.state_dict())
                best_epoch = epoch + 1
                stale = 0
            else:
                stale += 1
                if stale >= patience:
                    print(
                        f"  AE early stop at epoch {epoch+1} "
                        f"(best val_mse={best_val_loss:.5f} @ epoch {best_epoch}, patience={patience})."
                    )
                    break
    except KeyboardInterrupt:
        print("\nAutoencoder training interrupted. Returning best checkpoint so far.")

    if best_state is not None:
        model.load_state_dict(best_state)
        history["best_epoch"] = best_epoch
        print(f"Restored best AE checkpoint (val_mse={best_val_loss:.5f} @ epoch {best_epoch}).")

    return model, history


def plot_autoencoder_training(history: dict) -> None:
    fig, ax = plt.subplots(figsize=(9, 4))
    epochs = range(1, len(history["train_loss"]) + 1)
    ax.plot(epochs, history["train_loss"], color="#4C72B0", marker="o", label="Train MSE")
    ax.plot(epochs, history["val_loss"], color="#DD8452", marker="s", label="Val MSE")
    best_ep = history.get("best_epoch")
    if best_ep:
        ax.axvline(best_ep, color="#55A868", linestyle="--", linewidth=1.2, label=f"Best epoch {best_ep}")
    ax.set_xlabel("Epoch")
    ax.set_ylabel("Reconstruction MSE")
    ax.set_title("Vision Brain — Autoencoder Training (early-stopped best checkpoint)", fontweight="bold")
    ax.legend()
    fig.tight_layout()
    plt.show()


def calibrate_anomaly_threshold(ae_model, clear_val_ds, device=None, percentile: float = 95.0) -> float:
    """Set anomaly threshold from clear-road validation reconstruction errors."""
    import torch

    if device is None:
        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    ae_model.eval()
    errors = []
    with torch.no_grad():
        for (xb,) in torch.utils.data.DataLoader(clear_val_ds, batch_size=16):
            xb = xb.to(device)
            recon = ae_model(xb)
            err = torch.mean((xb - recon) ** 2, dim=(1, 2, 3)).cpu().numpy()
            errors.extend(err.tolist())
    if not errors:
        return 0.01
    return float(np.percentile(errors, percentile))


def reconstruction_errors(ae_model, dataset, device=None) -> np.ndarray:
    """Per-sample MSE reconstruction error."""
    import torch

    if device is None:
        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    ae_model.eval()
    errors = []
    with torch.no_grad():
        for batch in torch.utils.data.DataLoader(dataset, batch_size=16):
            xb = batch[0] if isinstance(batch, (list, tuple)) else batch
            xb = xb.to(device)
            recon = ae_model(xb)
            err = torch.mean((xb - recon) ** 2, dim=(1, 2, 3)).cpu().numpy()
            errors.extend(err.tolist())
    return np.array(errors)


def v_anomaly_from_error(error: float, threshold: float) -> float:
    """Map reconstruction error to [0, 1] anomaly score."""
    if threshold <= 0:
        return float(np.clip(error, 0, 1))
    return float(np.clip(error / (2.0 * threshold), 0.0, 1.0))


def v_class_from_resnet(model, x_tensor, class_names: List[str], device=None) -> float:
    """Hazard probability: P(Wet/Slush) + P(Snow/Ice), clipped to [0, 1]."""
    import torch
    import torch.nn.functional as F

    if device is None:
        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    model.eval()
    with torch.no_grad():
        logits = model(x_tensor.unsqueeze(0).to(device))
        probs = F.softmax(logits, dim=1).cpu().numpy()[0]

    hazard = 0.0
    for name in HAZARD_CLASSES:
        if name in class_names:
            hazard += float(probs[class_names.index(name)])
    return float(np.clip(hazard, 0.0, 1.0))


def fuse_vision_score(
    v_class: float,
    v_anomaly: float,
    alpha: float = V_FUSION_ALPHA,
) -> float:
    """Fused Vision Brain output V_vision in [0, 1]."""
    alpha = float(np.clip(alpha, 0.0, 1.0))
    return float(np.clip(alpha * v_class + (1.0 - alpha) * v_anomaly, 0.0, 1.0))


def score_frame_hybrid(
    resnet_model,
    ae_model,
    x_tensor,
    class_names: List[str],
    anomaly_threshold: float,
    alpha: float = V_FUSION_ALPHA,
    device=None,
) -> Dict[str, float]:
    """Score one frame; returns V_class, V_anomaly, and fused V_vision."""
    import torch

    if device is None:
        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    v_class = v_class_from_resnet(resnet_model, x_tensor, class_names, device=device)

    ae_model.eval()
    with torch.no_grad():
        xb = x_tensor.unsqueeze(0).to(device)
        recon = ae_model(xb)
        err = float(torch.mean((xb - recon) ** 2).item())
    v_anom = v_anomaly_from_error(err, anomaly_threshold)
    v_fused = fuse_vision_score(v_class, v_anom, alpha=alpha)

    return {
        "V_class": round(v_class, 4),
        "V_anomaly": round(v_anom, 4),
        "recon_error": round(err, 6),
        "V_vision": round(v_fused, 4),
    }


def plot_reconstruction_samples(ae_model, dataset, n: int = 3, device=None, title: str = "Autoencoder Reconstructions") -> None:
    """Show original vs reconstructed clear-road frames."""
    import torch

    if device is None:
        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    ae_model.eval()
    shown = 0
    fig, axes = plt.subplots(2, n, figsize=(3.2 * n, 6))
    if n == 1:
        axes = np.array([[axes[0]], [axes[1]]])

    with torch.no_grad():
        for (xb,) in torch.utils.data.DataLoader(dataset, batch_size=1):
            xb = xb.to(device)
            recon = ae_model(xb).cpu()
            orig = xb.cpu().squeeze(0).permute(1, 2, 0).numpy()
            rec = recon.squeeze(0).permute(1, 2, 0).numpy()
            axes[0, shown].imshow(np.clip(orig, 0, 1))
            axes[0, shown].axis("off")
            axes[0, shown].set_title("Original", fontsize=9)
            axes[1, shown].imshow(np.clip(rec, 0, 1))
            axes[1, shown].axis("off")
            axes[1, shown].set_title("Reconstructed", fontsize=9)
            shown += 1
            if shown >= n:
                break

    fig.suptitle(title, fontweight="bold")
    plt.tight_layout()
    plt.show()


def compare_vision_backends(
    resnet_model,
    ae_model,
    val_ds,
    class_names: List[str],
    anomaly_threshold: float,
    alpha: float = V_FUSION_ALPHA,
    device=None,
    max_per_class: int = 40,
) -> Tuple:
    """
    Compare ResNet-only vs ResNet+autoencoder hybrid on the validation set.

    Selection score (higher is better):
      0.65 * (mean V | Snow/Ice − mean V | Clear)
      + 0.25 * (mean V | Wet − mean V | Clear)
      + 0.10 ranking bonus if Snow ≥ Wet ≥ Clear

    Tie → ResNet18 (simpler). Returns (comparison_df, selection_dict).
    """
    import pandas as pd
    import torch

    if device is None:
        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    # Collect balanced per-class frames
    buckets: Dict[str, list] = {c: [] for c in class_names}
    for i in range(len(val_ds)):
        x, y = val_ds[i]
        lbl = class_names[int(y)]
        if len(buckets[lbl]) < max_per_class:
            buckets[lbl].append(x)

    rows = []
    backend_scores: Dict[str, Dict[str, List[float]]] = {
        "ResNet18": {c: [] for c in class_names},
        "ResNet18 + Autoencoder": {c: [] for c in class_names},
    }

    for lbl, xs in buckets.items():
        for x in xs:
            v_cls = v_class_from_resnet(resnet_model, x, class_names, device=device)
            backend_scores["ResNet18"][lbl].append(v_cls)

            hybrid = score_frame_hybrid(
                resnet_model, ae_model, x, class_names,
                anomaly_threshold=anomaly_threshold, alpha=alpha, device=device,
            )
            backend_scores["ResNet18 + Autoencoder"][lbl].append(hybrid["V_vision"])

    for backend, by_cls in backend_scores.items():
        means = {c: (float(np.mean(by_cls[c])) if by_cls[c] else np.nan) for c in class_names}
        clear_m = means.get(CLEAR_CLASS, np.nan)
        wet_m = means.get("Wet / Slush", np.nan)
        snow_m = means.get("Snow / Ice", np.nan)
        snow_clear_gap = snow_m - clear_m if np.isfinite(snow_m) and np.isfinite(clear_m) else np.nan
        wet_clear_gap = wet_m - clear_m if np.isfinite(wet_m) and np.isfinite(clear_m) else np.nan
        # Prefer models that rank Snow > Wet > Clear
        ranking_ok = (
            np.isfinite(snow_clear_gap)
            and np.isfinite(wet_clear_gap)
            and snow_m >= wet_m >= clear_m
        )
        # Composite selection score: separation of hazard from clear + ranking bonus
        selection_score = 0.0
        if np.isfinite(snow_clear_gap):
            selection_score += 0.65 * snow_clear_gap
        if np.isfinite(wet_clear_gap):
            selection_score += 0.25 * wet_clear_gap
        if ranking_ok:
            selection_score += 0.10

        rows.append({
            "Backend": backend,
            "Mean V | Clear": round(clear_m, 4) if np.isfinite(clear_m) else np.nan,
            "Mean V | Wet/Slush": round(wet_m, 4) if np.isfinite(wet_m) else np.nan,
            "Mean V | Snow/Ice": round(snow_m, 4) if np.isfinite(snow_m) else np.nan,
            "Snow−Clear gap": round(snow_clear_gap, 4) if np.isfinite(snow_clear_gap) else np.nan,
            "Wet−Clear gap": round(wet_clear_gap, 4) if np.isfinite(wet_clear_gap) else np.nan,
            "Ranking OK (Snow≥Wet≥Clear)": bool(ranking_ok),
            "Selection score": round(float(selection_score), 4),
            "N frames": sum(len(v) for v in by_cls.values()),
        })

    comparison_df = pd.DataFrame(rows)

    # Pick higher selection score; tie → prefer ResNet-only (simpler)
    if comparison_df.empty:
        selection = {
            "selected_backend": "ResNet18",
            "use_hybrid": False,
            "fusion_alpha": 1.0,
            "reason": "No comparison rows — defaulting to ResNet18.",
        }
    else:
        scores = comparison_df["Selection score"].fillna(-1e9)
        # Explicit tie-break: if scores within epsilon, pick ResNet18
        if len(scores) >= 2 and abs(float(scores.iloc[0]) - float(scores.iloc[1])) < 1e-4:
            chosen = "ResNet18"
            reason = "Selection scores tied — prefer simpler ResNet18 backend."
            best_score = float(scores.iloc[0])
        else:
            best_pos = int(scores.values.argmax())
            chosen = str(comparison_df.iloc[best_pos]["Backend"])
            best_score = float(scores.iloc[best_pos])
            reason = f"Highest selection score ({best_score:.4f})."
        use_hybrid = chosen == "ResNet18 + Autoencoder"
        selection = {
            "selected_backend": chosen,
            "use_hybrid": use_hybrid,
            "fusion_alpha": float(alpha if use_hybrid else 1.0),
            "reason": reason,
            "anomaly_threshold": float(anomaly_threshold),
            "selection_score": best_score,
        }

    return comparison_df, selection


def select_vision_v_score(
    resnet_model,
    ae_model,
    x_tensor,
    class_names: List[str],
    anomaly_threshold: float,
    selection: Dict,
    alpha: float = V_FUSION_ALPHA,
    device=None,
) -> Dict[str, float]:
    """Score one frame using the selected backend (ResNet-only or hybrid)."""
    use_hybrid = bool(selection.get("use_hybrid", False))
    if use_hybrid and ae_model is not None:
        out = score_frame_hybrid(
            resnet_model, ae_model, x_tensor, class_names,
            anomaly_threshold=anomaly_threshold, alpha=alpha, device=device,
        )
        out["backend"] = "ResNet18 + Autoencoder"
        return out

    v_cls = v_class_from_resnet(resnet_model, x_tensor, class_names, device=device)
    return {
        "V_class": round(v_cls, 4),
        "V_anomaly": None,
        "recon_error": None,
        "V_vision": round(v_cls, 4),
        "backend": "ResNet18",
    }


def save_vision_artifacts(
    resnet_model,
    ae_model,
    anomaly_threshold: float,
    models_dir: Optional[Path] = None,
    alpha: float = V_FUSION_ALPHA,
    selection: Optional[Dict] = None,
    comparison_records: Optional[List[Dict]] = None,
) -> Path:
    """Persist ResNet, autoencoder, and fusion metadata (including selected backend)."""
    import json
    import torch

    if models_dir is None:
        models_dir = Path(__file__).resolve().parent.parent / "models"
    models_dir.mkdir(parents=True, exist_ok=True)

    torch.save(resnet_model.state_dict(), models_dir / "vision_resnet18.pt")
    if ae_model is not None:
        torch.save(ae_model.state_dict(), models_dir / "vision_autoencoder.pt")

    selected = selection or {
        "selected_backend": "ResNet18 + Autoencoder" if ae_model is not None else "ResNet18",
        "use_hybrid": ae_model is not None,
        "fusion_alpha": alpha,
        "reason": "Default (no comparison run).",
    }
    meta = {
        "anomaly_threshold": anomaly_threshold,
        "fusion_alpha": selected.get("fusion_alpha", alpha),
        "class_names": DISPLAY_ORDER,
        "hazard_classes": list(HAZARD_CLASSES),
        "selected_backend": selected.get("selected_backend"),
        "use_hybrid": bool(selected.get("use_hybrid", False)),
        "selection_reason": selected.get("reason"),
        "comparison": comparison_records or [],
    }
    (models_dir / "vision_meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")

    # Also write a small CSV-friendly comparison table when available
    if comparison_records:
        try:
            import pandas as pd
            results_dir = models_dir.parent / "Data" / "results" / "vision"
            results_dir.mkdir(parents=True, exist_ok=True)
            pd.DataFrame(comparison_records).to_csv(results_dir / "vision_backend_comparison.csv", index=False)
            print(f"Saved comparison table → {results_dir / 'vision_backend_comparison.csv'}")
        except Exception as exc:
            print(f"Could not write comparison CSV: {exc}")

    print(f"Saved vision artifacts to {models_dir}")
    print(f"  Selected backend for equation V: {meta['selected_backend']} (use_hybrid={meta['use_hybrid']})")
    return models_dir


# ── Latent space + t-SNE visualization (Section 6.2c) ────────────────────────

def resnet_softmax_probs(model, x_tensor, class_names: List[str], device=None) -> Dict[str, float]:
    """Per-class softmax probabilities from fine-tuned ResNet18."""
    import torch
    import torch.nn.functional as F

    if device is None:
        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    model.eval()
    with torch.no_grad():
        logits = model(x_tensor.unsqueeze(0).to(device))
        probs = F.softmax(logits, dim=1).cpu().numpy()[0]

    return {name: round(float(probs[i]), 4) for i, name in enumerate(class_names)}


def extract_ae_latents(ae_model, dataset, device=None, max_samples: Optional[int] = None) -> np.ndarray:
    """Encode dataset images into autoencoder latent vectors (shape: n x latent_dim)."""
    import torch

    if device is None:
        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    ae_model.eval()
    latents: List[np.ndarray] = []
    seen = 0
    with torch.no_grad():
        for batch in torch.utils.data.DataLoader(dataset, batch_size=16):
            xb = batch[0] if isinstance(batch, (list, tuple)) else batch
            xb = xb.to(device)
            z = ae_model.encode(xb).cpu().numpy()
            latents.append(z)
            seen += len(z)
            if max_samples is not None and seen >= max_samples:
                break

    if not latents:
        return np.empty((0, 128))
    out = np.vstack(latents)
    if max_samples is not None:
        out = out[:max_samples]
    return out


def labeled_latents_from_val(
    ae_model,
    val_ds,
    class_names: List[str],
    device=None,
    max_per_class: int = 40,
) -> Tuple[np.ndarray, List[str]]:
    """Balanced latent vectors + surface labels from validation tensors."""
    import torch

    if device is None:
        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    buckets: Dict[str, List[np.ndarray]] = {c: [] for c in class_names}
    ae_model.eval()

    with torch.no_grad():
        for i in range(len(val_ds)):
            x, y = val_ds[i]
            lbl = class_names[int(y)]
            if len(buckets[lbl]) >= max_per_class:
                continue
            z = ae_model.encode(x.unsqueeze(0).to(device)).cpu().numpy()[0]
            buckets[lbl].append(z)

    vectors, labels = [], []
    for lbl in class_names:
        for z in buckets[lbl]:
            vectors.append(z)
            labels.append(lbl)
    if not vectors:
        return np.empty((0, 128)), []
    return np.vstack(vectors), labels


def plot_latent_tsne(
    latent_matrix: np.ndarray,
    labels: List[str],
    title: str = "Autoencoder Latent Space — t-SNE (2D)",
    perplexity: float = 30.0,
    random_state: int = 42,
) -> np.ndarray:
    """Project latent vectors to 2D with t-SNE and plot coloured by road-surface class."""
    from sklearn.manifold import TSNE

    if latent_matrix.shape[0] < 3:
        print("Need at least 3 latent vectors for t-SNE.")
        return np.empty((0, 2))

    n = latent_matrix.shape[0]
    perp = min(perplexity, max(2.0, (n - 1) / 3.0))
    tsne = TSNE(n_components=2, perplexity=perp, random_state=random_state, init="pca", learning_rate="auto")
    emb = tsne.fit_transform(latent_matrix)

    palette = {
        "Clear Asphalt": "#3B7A57",
        "Wet / Slush": "#2E86AB",
        "Snow / Ice": "#C73E1D",
    }
    fig, ax = plt.subplots(figsize=(9, 7))
    for lbl in sorted(set(labels)):
        mask = np.array([l == lbl for l in labels])
        ax.scatter(
            emb[mask, 0], emb[mask, 1],
            s=55, alpha=0.85, label=lbl,
            c=palette.get(lbl, "#666666"), edgecolors="white", linewidths=0.4,
        )
    ax.set_xlabel("t-SNE dimension 1")
    ax.set_ylabel("t-SNE dimension 2")
    ax.set_title(title, fontweight="bold")
    ax.legend(title="Surface class", loc="best")
    fig.tight_layout()
    plt.show()
    return emb


def summarize_softmax_hazard(
    resnet_model,
    val_ds,
    class_names: List[str],
    device=None,
    max_per_class: int = 15,
) -> None:
    """Print mean softmax hazard probabilities per surface class."""
    import torch
    import torch.nn.functional as F

    if device is None:
        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    sums: Dict[str, List[float]] = {c: [] for c in class_names}
    resnet_model.eval()
    counts: Dict[str, int] = {c: 0 for c in class_names}

    with torch.no_grad():
        for i in range(len(val_ds)):
            x, y = val_ds[i]
            lbl = class_names[int(y)]
            if counts[lbl] >= max_per_class:
                continue
            logits = resnet_model(x.unsqueeze(0).to(device))
            probs = F.softmax(logits, dim=1).cpu().numpy()[0]
            hazard = sum(float(probs[class_names.index(h)]) for h in HAZARD_CLASSES if h in class_names)
            sums[lbl].append(hazard)
            counts[lbl] += 1

    print("ResNet18 softmax hazard summary (P_Wet + P_Snow/Ice):")
    print(f"{'Class':<16} {'Mean hazard':>12} {'Std':>8} {'N':>5}")
    print("-" * 45)
    for lbl in class_names:
        if sums[lbl]:
            arr = np.array(sums[lbl])
            print(f"{lbl:<16} {arr.mean():>12.3f} {arr.std():>8.3f} {len(arr):>5}")


