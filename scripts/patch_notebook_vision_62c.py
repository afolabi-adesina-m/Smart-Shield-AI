"""Insert Section 6.2c (latent space + t-SNE + softmax) into capstone_with_results.ipynb."""
from __future__ import annotations

import json
from pathlib import Path

NOTEBOOK = Path(__file__).resolve().parent.parent / "notebooks" / "capstone_with_results.ipynb"

MARKDOWN_62C = """### 6.2c · Latent Space, t-SNE & Softmax Analysis

This section connects three core deep-learning ideas used in the Vision Brain:

| Concept | Model | What it shows |
|---------|-------|----------------|
| **Latent space** | Autoencoder encoder | 128-dim compressed representation of each road frame |
| **t-SNE** | Dimensionality reduction | Whether Clear / Wet / Snow clusters separate in 2D |
| **Softmax** | ResNet18 classifier | Calibrated class probabilities → hazard score |

**Latent space:** The encoder maps each 224×224 image to a compact vector **z ∈ ℝ¹²⁸**.
Similar surfaces should lie near each other; hazardous surfaces should drift away from the
clear-road manifold learned during autoencoder training.

**t-SNE (t-Distributed Stochastic Neighbor Embedding):** Non-linear projection of **z** to 2D
for visualization. Points that were close in latent space stay close in the plot.

**Softmax:** ResNet outputs raw logits **zᵢ**; `softmax(zᵢ) = exp(zᵢ) / Σⱼ exp(zⱼ)` converts them
to probabilities that sum to 1. We sum hazard-class probabilities for the **V_class** score.
"""

CODE_62C = '''# ── 6.2c  Latent space extraction, t-SNE, and softmax probabilities ───────────

if not TORCH_OK:
    print("PyTorch not available — skip latent / t-SNE analysis.")
elif vision_model is None or ae_model is None:
    print("Run Sections 6.2 and 6.2b first (ResNet + autoencoder).")
else:
    import importlib
    import sys
    if "vision_brain" in sys.modules:
        del sys.modules["vision_brain"]
    import vision_brain
    importlib.reload(vision_brain)

    from vision_brain import (
        labeled_latents_from_val,
        plot_latent_tsne,
        resnet_softmax_probs,
        summarize_softmax_hazard,
        HAZARD_CLASSES,
    )

    # 1) Extract latent vectors from autoencoder encoder
    print("Extracting autoencoder latent vectors from validation set...")
    latents, latent_labels = labeled_latents_from_val(
        ae_model, val_ds, vision_class_names, device=device, max_per_class=40,
    )
    print(f"  Latent matrix shape: {latents.shape}  (n_samples × latent_dim)")

    # 2) t-SNE projection of latent space
    print("\\nRunning t-SNE on latent space...")
    tsne_2d = plot_latent_tsne(
        latents, latent_labels,
        title="Vision Brain — Autoencoder Latent Space (t-SNE)",
        perplexity=30.0,
    )

    # 3) Softmax probabilities from ResNet18
    print("\\nSoftmax class probabilities (one example per surface class):")
    print(f"{'Class':<16} " + "  ".join(f"{c[:8]:>8}" for c in vision_class_names) + "  | Hazard")
    print("-" * 70)
    shown = set()
    for i in range(len(val_ds)):
        x_i, y_i = val_ds[i]
        lbl = vision_class_names[int(y_i)]
        if lbl in shown:
            continue
        shown.add(lbl)
        probs = resnet_softmax_probs(vision_model, x_i, vision_class_names, device=device)
        hazard = sum(probs.get(h, 0.0) for h in HAZARD_CLASSES)
        row = "  ".join(f"{probs.get(c, 0.0):8.3f}" for c in vision_class_names)
        print(f"{lbl:<16} {row}  | {hazard:.3f}")

    print("\\nMean softmax hazard by class (validation sample):")
    summarize_softmax_hazard(vision_model, val_ds, vision_class_names, device=device)
'''

MARKDOWN_62C_FINDINGS = """**Findings & importance:**
- **Latent space** compresses high-dimensional road images into a 128-dim vector suitable for clustering and anomaly detection.
- **t-SNE** confirms (visually) whether surface classes form separable groups — overlapping clusters suggest the model may confuse Wet vs Snow under limited training data.
- **Softmax** turns ResNet logits into interpretable probabilities; hazard classes (Wet + Snow/Ice) should score higher on winter/slush frames than on Clear Asphalt.

**What to check in the output:**
- t-SNE plot: Clear (green), Wet (blue), Snow/Ice (red) should form distinct or partially separated clusters
- Softmax table: Snow/Ice and Wet rows should show higher hazard sums than Clear Asphalt
"""


def patch() -> None:
    nb = json.loads(NOTEBOOK.read_text(encoding="utf-8"))
    cells = nb["cells"]

    if any("6.2c" in "".join(c.get("source", [])) for c in cells):
        print("Section 6.2c already present — skipping.")
        return

    # Insert after last 6.2b cell (before Section 7)
    insert_at = None
    for i, c in enumerate(cells):
        if "6.2b" in "".join(c.get("source", [])):
            insert_at = i + 1
        if "vision_autoencoder.pt" in "".join(c.get("source", [])):
            insert_at = i + 1

    if insert_at is None:
        # fallback: before Section 7
        for i, c in enumerate(cells):
            if "Section 7" in "".join(c.get("source", [])):
                insert_at = i
                break

    if insert_at is None:
        raise RuntimeError("Could not find insertion point for Section 6.2c")

    new_cells = [
        {"cell_type": "markdown", "metadata": {}, "source": [MARKDOWN_62C], "id": "vision_latent_md"},
        {"cell_type": "code", "metadata": {}, "source": [CODE_62C], "outputs": [], "execution_count": None, "id": "vision_latent_code"},
        {"cell_type": "markdown", "metadata": {}, "source": [MARKDOWN_62C_FINDINGS], "id": "vision_latent_findings"},
    ]
    for j, nc in enumerate(new_cells):
        cells.insert(insert_at + j, nc)

    nb["cells"] = cells
    NOTEBOOK.write_text(json.dumps(nb, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"Inserted Section 6.2c into {NOTEBOOK}")


if __name__ == "__main__":
    patch()
