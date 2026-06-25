"""Vision Brain helpers — offline-first road-condition samples + ResNet18 fine-tuning.

Runtime never calls `datasets.load_dataset` (broken for RSCD on Hub).
Images load from local `Data/vision_cache/` or synthetic panels.
Optional one-time seeding: run `seed_vision_cache.py` when online.
"""

from __future__ import annotations

from pathlib import Path
from typing import Dict, List, Optional, Tuple

import matplotlib.pyplot as plt
import numpy as np

DISPLAY_ORDER = ["Clear Asphalt", "Wet / Slush", "Snow / Ice"]
CLASS_TO_IDX = {name: i for i, name in enumerate(DISPLAY_ORDER)}

# Maps cache subfolder names -> display class
CACHE_FOLDERS: Dict[str, List[str]] = {
    "Clear Asphalt": ["clear", "dry_asphalt_smooth", "dry_asphalt_slight", "dry_concrete_smooth", "dry_gravel"],
    "Wet / Slush": ["wet", "wet_asphalt_smooth", "wet_asphalt_slight", "water_asphalt_smooth", "wet_concrete_smooth", "melted_snow"],
    "Snow / Ice": ["snow", "ice", "fresh_snow"],
}


def resolve_cache_dir(cache_dir: Optional[str] = None) -> Path:
    """Find project vision_cache (parent Data/ preferred over Scripts/Data/)."""
    if cache_dir:
        return Path(cache_dir)
    here = Path(__file__).resolve().parent
    candidates = [
        here.parent / "Data" / "vision_cache",
        here / "Data" / "vision_cache",
        Path.cwd().parent / "Data" / "vision_cache",
        Path.cwd() / "Data" / "vision_cache",
    ]
    for p in candidates:
        if p.is_dir():
            return p
    return here.parent / "Data" / "vision_cache"


def _synthetic_samples(n_per_class: int) -> Tuple[List, List[str]]:
    """Deterministic demo panels — always available, no network."""
    images, labels = [], []
    patterns = {
        "Clear Asphalt": (60, 60, 60),
        "Wet / Slush": (90, 110, 130),
        "Snow / Ice": (220, 225, 235),
    }
    for cond, rgb in patterns.items():
        for i in range(n_per_class):
            arr = np.zeros((224, 224, 3), dtype=np.uint8)
            arr[:] = rgb
            noise = np.random.default_rng(i + hash(cond) % 1000).integers(-15, 15, arr.shape, dtype=np.int16)
            arr = np.clip(arr.astype(np.int16) + noise, 0, 255).astype(np.uint8)
            images.append(arr)
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
                    buckets[cond].append(np.array(Image.open(img_path).convert("RGB")))
                except Exception:
                    continue

    images, labels = [], []
    real = 0
    for cond in DISPLAY_ORDER:
        have = len(buckets[cond])
        real += have
        if have < n_per_class:
            syn, syn_lbl = _synthetic_samples(n_per_class - have)
            for arr, lbl in zip(syn, syn_lbl):
                if lbl == cond:
                    buckets[cond].append(arr)
        for arr in buckets[cond][:n_per_class]:
            images.append(arr)
            labels.append(cond)

    return images, labels, real


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
    """Training tensors from synthetic panels — fast, offline, reproducible."""
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
    return TensorDataset(X[tr], y[tr]), TensorDataset(X[va], y[va]), DISPLAY_ORDER


def build_training_dataset(max_per_class: int = 120, cache_dir: Optional[str] = None):
    """Build train/val tensors from local cache; synthetic fallback if sparse."""
    import torch
    from PIL import Image
    from torch.utils.data import TensorDataset
    from torchvision import transforms

    transform = transforms.Compose([
        transforms.Resize((224, 224)),
        transforms.ToTensor(),
        transforms.RandomHorizontalFlip(),
    ])
    cache = resolve_cache_dir(cache_dir)
    cache.mkdir(parents=True, exist_ok=True)

    images, labels, real = _load_from_cache(cache, max_per_class)
    if real < 30:
        print(f"Only {real} cached photos — using offline synthetic training set.")
        return _build_synthetic_training_dataset(max_per_class, transform)

    # Repeat cached images to reach training size with light augmentation via tensor stack
    xs, ys = [], []
    reps = max(1, max_per_class * 3 // max(real, 1))
    for _ in range(reps):
        for arr, lbl in zip(images, labels):
            xs.append(transform(Image.fromarray(arr)))
            ys.append(CLASS_TO_IDX[lbl])

    X = torch.stack(xs)
    y = torch.tensor(ys, dtype=torch.long)
    n = len(y)
    perm = torch.randperm(n)
    split = int(0.8 * n)
    tr, va = perm[:split], perm[split:]
    print(f"Training on {real} cached photos ({len(xs)} augmented samples).")
    return TensorDataset(X[tr], y[tr]), TensorDataset(X[va], y[va]), DISPLAY_ORDER


def fine_tune_vision_model(train_ds, val_ds, epochs: int = 8, lr: float = 1e-4, device=None):
    """Fine-tune ResNet18 on road-surface conditions. Returns (model, history, class_names)."""
    import torch
    import torch.nn as nn
    from torch.utils.data import DataLoader
    from torchvision import models

    if device is None:
        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    model = models.resnet18(weights=models.ResNet18_Weights.IMAGENET1K_V1)
    model.fc = nn.Linear(model.fc.in_features, len(DISPLAY_ORDER))
    model = model.to(device)

    criterion = nn.CrossEntropyLoss()
    optimizer = torch.optim.Adam(model.parameters(), lr=lr)

    train_dl = DataLoader(train_ds, batch_size=32, shuffle=True)
    val_dl = DataLoader(val_ds, batch_size=32)

    history = {"train_loss": [], "val_acc": []}

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
        train_loss = total_loss / len(train_ds)

        model.eval()
        correct = total = 0
        with torch.no_grad():
            for xb, yb in val_dl:
                xb, yb = xb.to(device), yb.to(device)
                pred = model(xb).argmax(1)
                correct += (pred == yb).sum().item()
                total += len(yb)
        val_acc = correct / max(total, 1)
        history["train_loss"].append(train_loss)
        history["val_acc"].append(val_acc)
        print(f"  Epoch {epoch+1}/{epochs}  loss={train_loss:.4f}  val_acc={val_acc:.2%}")

    return model, history, DISPLAY_ORDER


def plot_vision_training(history: dict) -> None:
    fig, ax1 = plt.subplots(figsize=(9, 4))
    ax1.plot(history["train_loss"], color="#4C72B0", label="Train loss")
    ax1.set_xlabel("Epoch")
    ax1.set_ylabel("Loss", color="#4C72B0")
    ax2 = ax1.twinx()
    ax2.plot(history["val_acc"], color="#DD8452", label="Val accuracy")
    ax2.set_ylabel("Accuracy", color="#DD8452")
    ax2.set_ylim(0, 1.05)
    plt.title("Vision Brain — Fine-Tuning Curve", fontweight="bold")
    fig.tight_layout()
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
