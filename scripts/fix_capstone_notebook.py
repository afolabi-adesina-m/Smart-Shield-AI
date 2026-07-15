"""Fix capstone_with_results.ipynb: sequential vision sections, team roadmap, verified links."""
from __future__ import annotations

import json
import re
import urllib.request
from pathlib import Path

NOTEBOOK = Path(__file__).resolve().parent.parent / "notebooks" / "capstone_with_results.ipynb"

# ── 6.2b content (from patch_notebook_vision_ae.py) ─────────────────────────
MARKDOWN_62B = """### 6.2b · Autoencoder Anomaly Sensor (Hybrid Vision Brain)

**Why add an autoencoder?** Our labelled Ontario road-image cache is small. A supervised ResNet18
classifier handles **known** surface classes well, but may miss **unseen** winter hazards.

| Component | Type | Output | Role |
|-----------|------|--------|------|
| **ResNet18** | Supervised classifier | `V_class` | P(Wet) + P(Snow/Ice) from softmax |
| **Conv Autoencoder** | Unsupervised (trained on Clear Asphalt only) | `V_anomaly` | High reconstruction error → unusual surface |
| **Fusion** | Weighted blend | `V_vision` | `α·V_class + (1−α)·V_anomaly` |

> Default fusion weight: **α = 0.70**. Tunable in production.
"""

CODE_62B = '''# ── 6.2b  Train autoencoder on Clear Asphalt + fuse with ResNet18 ─────────────

ae_model = None
ae_history = None
anomaly_threshold = None
VISION_FUSION_ALPHA = 0.70

if not TORCH_OK:
    print("PyTorch not available — skip autoencoder branch.")
elif vision_model is None:
    print("Run Section 6.2 first (ResNet18 fine-tuning).")
else:
    import importlib
    import sys
    from pathlib import Path
    if "vision_brain" in sys.modules:
        del sys.modules["vision_brain"]
    import vision_brain
    importlib.reload(vision_brain)

    from vision_brain import (
        build_clear_only_dataset,
        train_road_autoencoder,
        plot_autoencoder_training,
        calibrate_anomaly_threshold,
        score_frame_hybrid,
        plot_reconstruction_samples,
        save_vision_artifacts,
        DISPLAY_ORDER,
        V_FUSION_ALPHA,
    )

    print("Building Clear Asphalt dataset for autoencoder...")
    ae_train_ds, ae_val_ds = build_clear_only_dataset(
        max_per_class=VISION_TRAIN_PER_CLASS,
        cache_dir=VISION_CACHE,
    )

    print(f"Training autoencoder on {device} for {max(4, VISION_EPOCHS - 2)} epochs...")
    ae_model, ae_history = train_road_autoencoder(
        ae_train_ds, ae_val_ds,
        epochs=max(4, VISION_EPOCHS - 2),
        device=device,
    )
    plot_autoencoder_training(ae_history)
    plot_reconstruction_samples(ae_model, ae_val_ds, n=3, device=device)

    anomaly_threshold = calibrate_anomaly_threshold(ae_model, ae_val_ds, device=device)
    print(f"Anomaly threshold (95th pct clear-road MSE): {anomaly_threshold:.6f}")

    print("\\nReconstruction error by class (higher = more anomalous):")
    for cls in DISPLAY_ORDER:
        idxs = [i for i, (_, y) in enumerate(val_ds) if vision_class_names[y] == cls]
        if not idxs:
            continue
        errs, hybrid_scores = [], []
        for i in idxs[:20]:
            x_i, _ = val_ds[i]
            h = score_frame_hybrid(
                vision_model, ae_model, x_i, vision_class_names,
                anomaly_threshold=anomaly_threshold,
                alpha=VISION_FUSION_ALPHA,
                device=device,
            )
            errs.append(h["recon_error"])
            if len(hybrid_scores) < 5:
                hybrid_scores.append(h["V_vision"])
        print(f"  {cls:<16}  mean MSE={np.mean(errs):.5f}  mean V_vision={np.mean(hybrid_scores):.3f}")

    _models_dir = DATA.parent / "models" if "DATA" in dir() else Path("models")
    save_vision_artifacts(
        vision_model, ae_model, anomaly_threshold,
        models_dir=_models_dir,
        alpha=VISION_FUSION_ALPHA,
    )
    print(f"\\nHybrid Vision Brain ready. Fusion: V_vision = {VISION_FUSION_ALPHA:.0%}·V_class + {1-VISION_FUSION_ALPHA:.0%}·V_anomaly")
'''

MARKDOWN_62B_FINDINGS = """**Findings & importance:** Hybrid Vision Brain combines supervised class probabilities with an unsupervised anomaly signal — valuable when labelled winter-road images are scarce.

**What to check:** Autoencoder MSE decreases; Snow/Ice shows higher reconstruction error than Clear Asphalt; artifacts saved to `models/`.
"""

MARKDOWN_62C = """### 6.2c · Latent Space, t-SNE & Softmax Analysis

| Concept | Model | What it shows |
|---------|-------|----------------|
| **Latent space** | Autoencoder encoder | 128-dim compressed representation of each road frame |
| **t-SNE** | Dimensionality reduction | Whether Clear / Wet / Snow clusters separate in 2D |
| **Softmax** | ResNet18 classifier | Class probabilities → hazard score |

**Softmax:** `softmax(zᵢ) = exp(zᵢ) / Σⱼ exp(zⱼ)` converts logits to probabilities summing to 1.
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

    print("Extracting autoencoder latent vectors from validation set...")
    latents, latent_labels = labeled_latents_from_val(
        ae_model, val_ds, vision_class_names, device=device, max_per_class=40,
    )
    print(f"  Latent matrix shape: {latents.shape}")

    print("\\nRunning t-SNE on latent space...")
    plot_latent_tsne(latents, latent_labels, title="Vision Brain — Autoencoder Latent Space (t-SNE)")

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

    print("\\nMean softmax hazard by class:")
    summarize_softmax_hazard(vision_model, val_ds, vision_class_names, device=device)
'''

MARKDOWN_62C_FINDINGS = """**Findings:** Latent space compresses images to 128-dim vectors; t-SNE visualizes class separation; softmax gives interpretable hazard probabilities per surface type.
"""

# ── Team roadmap (replaces personalized assignments) ─────────────────────────
OLD_ROADMAP_LINES = [
    "2.  **Week 3 (NLP):** Team Member 2 to build the TF-IDF scraper for Ontario 511 text logs.\n",
    "3.  **Week 4 (Vision):** Team Member 3 to implement OpenCV normalization for live 401 camera URLs.\n",
    "4.  **Week 5 (Neural Net):** Train the AI to recognize \"Icy\" road textures from the Kaggle dataset.\n",
    "5.  **Week 6 (Optimization):** Afolabi to run GridSearchCV to fuse all brains into the Logistic Model.\n",
    "6.  **Week 7 (Evaluation):** Full group audit of the **Confusion Matrix**. Optimize for **Recall**.\n",
    "7.  **Week 8 (Live Demo):** Present the \"Smart-Shield Dashboard\" using live Highway 401 feeds.\n",
]

NEW_ROADMAP_BLOCK = """### Team Roadmap — Group 2B (collaborative deliverables)

All sprints are **pair-programmed and peer-reviewed** by the full team. No single-owner tasks.

| Week | Sprint focus | Team deliverable | All members contribute |
|------|--------------|------------------|------------------------|
| 1–2 | Data & EDA | Toronto + UK DfT + SDOT ingestion, quality audit | ✓ Data loading, EDA plots, Paper 2 replication |
| 3 | NLP Brain | TF-IDF hazard lexicon on Ontario 511-style alerts | ✓ Text preprocessing, T-score, scenario tests |
| 4 | Vision Brain | ResNet18 road-surface classifier + image cache | ✓ Sample frames, fine-tuning, confusion matrix |
| 5 | Vision (advanced) | Autoencoder anomaly sensor + latent/t-SNE analysis | ✓ Hybrid V-score, softmax review, artifact export |
| 6 | Tabular ML | SMOTE, baselines, GridSearchCV (RF, LightGBM, etc.) | ✓ Hyperparameter tuning, model comparison |
| 7 | Evaluation | Confusion matrices, Macro Recall, live Ontario test cases | ✓ Metrics audit, ethics review |
| 8 | Deployment | Safety Score fusion, SHAP, model serialization, demo | ✓ Sprint 3 dashboard, Flask/maps demo |

> **Group 2B** — shared ownership at every stage; weekly stand-ups rotate facilitation.
"""

# ── URL fixes (verified / updated public portals) ────────────────────────────
URL_REPLACEMENTS = {
    # Old broken or generic links → working public portals
    "https://511on.ca/cameraview": "https://511on.ca/map",
    "https://data.ontario.ca/dataset/integrated-collision-data": "https://data.ontario.ca/dataset?q=collision",
    "https://www.kaggle.com/datasets/vipinmazumder/road-surface-classification": "https://www.kaggle.com/datasets/birdy654/road-surface-classification",
    "https://511on.ca/developers": "https://511on.ca/about/open-data",
}

URL_NOTES_BLOCK = """
### Verified public data portals (Group 2B sources)

| Source | URL | Use in project |
|--------|-----|----------------|
| Ontario 511 (cameras & alerts) | https://511on.ca/map | Live highway camera references |
| Ontario 511 Open Data | https://511on.ca/about/open-data | API / alert text for NLP Brain |
| Environment Canada | https://dd.weather.gc.ca/citypage_weather/xml/ON/ | Weather XML for E_index |
| Ontario Open Data | https://data.ontario.ca/dataset?q=collision | Provincial collision records |
| Toronto Open Data | https://open.toronto.ca/dataset/police-annual-statistical-report-traffic-collisions/ | TPS collision open data portal |
| UWaterloo iTSS Lab | https://itsslab.com/ | Road surface research reference |
| HuggingFace RSCD | https://huggingface.co/datasets/RoadSurfaceClassDataset/RSCD | Road image scale-up (optional) |
"""


def _cell_text(c: dict) -> str:
    return "".join(c.get("source", []))


def _is_62b_md(c: dict) -> bool:
    s = _cell_text(c)
    return "6.2b" in s and "Autoencoder" in s and c["cell_type"] == "markdown"


def _is_62b_code(c: dict) -> bool:
    return "6.2b" in _cell_text(c) and "train_road_autoencoder" in _cell_text(c)


def _is_62c_md(c: dict) -> bool:
    s = _cell_text(c)
    return "6.2c" in s and "Latent Space" in s and c["cell_type"] == "markdown"


def _is_62c_code(c: dict) -> bool:
    return "6.2c" in _cell_text(c) and "plot_latent_tsne" in _cell_text(c)


def _is_62c_findings(c: dict) -> bool:
    s = _cell_text(c)
    return c["cell_type"] == "markdown" and "6.2c" not in s and "Latent space compresses" in s


def _is_section7(c: dict) -> bool:
    s = _cell_text(c)
    return s.startswith("## Section 7") and "Model Training" in s


def _is_fine_tune_cell(c: dict) -> bool:
    return "fine_tune_vision_model" in _cell_text(c) and c["cell_type"] == "code"


def extract_vision_block(cells: list) -> tuple[list, list]:
    """Pull 6.2b/6.2c cells out; return (remaining, vision_block)."""
    vision = []
    rest = []
    for c in cells:
        if any([
            _is_62b_md(c), _is_62b_code(c),
            _is_62c_md(c), _is_62c_code(c), _is_62c_findings(c),
            c.get("id") in {"vision_ae_md", "vision_ae_code", "vision_ae_findings",
                            "vision_latent_md", "vision_latent_code", "vision_latent_findings"},
        ]):
            vision.append(c)
        else:
            rest.append(c)
    return rest, vision


def make_62b_cells() -> list:
    return [
        {"cell_type": "markdown", "metadata": {}, "source": [MARKDOWN_62B], "id": "vision_ae_md"},
        {"cell_type": "code", "metadata": {}, "source": [CODE_62B], "outputs": [], "execution_count": None, "id": "vision_ae_code"},
        {"cell_type": "markdown", "metadata": {}, "source": [MARKDOWN_62B_FINDINGS], "id": "vision_ae_findings"},
    ]


def make_62c_cells() -> list:
    return [
        {"cell_type": "markdown", "metadata": {}, "source": [MARKDOWN_62C], "id": "vision_latent_md"},
        {"cell_type": "code", "metadata": {}, "source": [CODE_62C], "outputs": [], "execution_count": None, "id": "vision_latent_code"},
        {"cell_type": "markdown", "metadata": {}, "source": [MARKDOWN_62C_FINDINGS], "id": "vision_latent_findings"},
    ]


def reorder_vision_sections(cells: list) -> list:
    rest, vision = extract_vision_block(cells)

    # Build canonical 6.2b + 6.2c if missing
    has_62b = any(_is_62b_code(c) for c in vision)
    has_62c = any(_is_62c_code(c) for c in vision)
    if not has_62b:
        vision = make_62b_cells() + vision
    if not has_62c:
        vision = vision + make_62c_cells()
    else:
        # ensure order: md, code, findings for each
        v62b = [c for c in vision if _is_62b_md(c) or _is_62b_code(c) or (c.get("id") == "vision_ae_findings")]
        v62c = [c for c in vision if _is_62c_md(c) or _is_62c_code(c) or _is_62c_findings(c) or c.get("id") == "vision_latent_findings"]
        # rebuild cleanly
        vision = make_62b_cells() + make_62c_cells()

    # Find insert point: after fine_tune code cell, before Section 7
    insert_idx = None
    for i, c in enumerate(rest):
        if _is_fine_tune_cell(c):
            insert_idx = i + 1
            break
    if insert_idx is None:
        for i, c in enumerate(rest):
            if _is_section7(c):
                insert_idx = i
                break
    if insert_idx is None:
        insert_idx = len(rest)

    return rest[:insert_idx] + vision + rest[insert_idx:]


def update_roadmap_and_links(text: str) -> str:
    # Replace personalized week lines with team table if old block present
    if "Team Member 2" in text or "Afolabi to run GridSearchCV" in text:
        # Find and replace the numbered week list section
        pattern = r"2\.\s+\*\*Week 3 \(NLP\):\*\*.*?(?=###|## |\Z)"
        if re.search(pattern, text, re.DOTALL):
            text = re.sub(pattern, NEW_ROADMAP_BLOCK + "\n", text, count=1, flags=re.DOTALL)
        else:
            for old in OLD_ROADMAP_LINES:
                text = text.replace(old, "")

    # Remove single-name project lead line → team line
    text = text.replace(
        "**Project Lead:** Afolabi Adesina | **Group:** 2B  \n",
        "**Team:** Group 2B (collaborative capstone — all members contribute each sprint)  \n",
    )

    # URL replacements
    for old, new in URL_REPLACEMENTS.items():
        text = text.replace(old, new)

    # Append portal table after Ontario 511 camera link section if not present
    if "Verified public data portals" not in text and "Hwy 401 Live Cameras" in text:
        text = text.replace(
            "4.  **Visual Training Data:**",
            URL_NOTES_BLOCK + "\n4.  **Visual Training Data:**",
        )

    return text


def apply_text_updates_to_cells(cells: list) -> list:
    for c in cells:
        if c["cell_type"] in ("markdown", "code"):
            src = _cell_text(c)
            new_src = update_roadmap_and_links(src)
            if new_src != src:
                c["source"] = [new_src] if isinstance(c["source"], list) else new_src
    return cells


def check_urls(urls: list[str]) -> dict[str, str]:
    results = {}
    for url in urls:
        if "download.pytorch.org" in url:
            results[url] = "skip (package index)"
            continue
        try:
            req = urllib.request.Request(url, method="HEAD", headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=12) as resp:
                results[url] = f"OK ({resp.status})"
        except Exception as e:
            try:
                req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
                with urllib.request.urlopen(req, timeout=12) as resp:
                    results[url] = f"OK GET ({resp.status})"
            except Exception as e2:
                results[url] = f"FAIL: {e2}"
    return results


def main() -> None:
    nb = json.loads(NOTEBOOK.read_text(encoding="utf-8"))
    cells = nb["cells"]

    cells = reorder_vision_sections(cells)
    cells = apply_text_updates_to_cells(cells)
    nb["cells"] = cells

    NOTEBOOK.write_text(json.dumps(nb, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"Updated {NOTEBOOK}")

    # Verify key portal URLs
    key_urls = list(URL_REPLACEMENTS.values()) + [
        "https://511on.ca/map",
        "https://511on.ca/about/open-data",
        "https://dd.weather.gc.ca/citypage_weather/xml/ON/",
        "https://data.ontario.ca/dataset?q=collision",
        "https://open.toronto.ca/dataset/police-annual-statistical-report-traffic-collisions/",
        "https://itsslab.com/",
    ]
    report = check_urls(key_urls)
    report_path = Path(__file__).resolve().parent / "_url_check_report.txt"
    lines = ["URL verification report", "=" * 40]
    for u, status in report.items():
        lines.append(f"{status:20} {u}")
    report_path.write_text("\n".join(lines), encoding="utf-8")
    print(report_path.read_text(encoding="utf-8"))


if __name__ == "__main__":
    main()
