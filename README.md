# Smart-Shield AI — INFO53883 Capstone (Team 2B)

Multimodal highway safety scoring: **NLP alerts** + **vision road conditions** + **tabular collision risk** → fused Smart-Shield score.

## Repository layout

```
├── notebooks/capstone.ipynb   # Main notebook (Colab / local / Kaggle)
├── src/                       # nlp_brain, vision_brain, safety_score, cm_helpers
├── demo/                      # Flask maps demo (api_server.py)
├── data/                      # CSV datasets (gitignored) + vision_cache/
├── models/                    # Trained artifacts (see models/README.md)
├── docs/                      # Proposals, design docs, literature
├── assets/                    # Diagrams
└── archive/                   # Old notebooks + notebook build scripts
```

## Quick start (local)

```bash
pip install -r requirements.txt
pip install torch>=2.4 torchvision --index-url https://download.pytorch.org/whl/cpu
```

1. Copy casualty CSV files into `data/` (see `data/README.md`).
2. Open `notebooks/capstone.ipynb` and run the **Environment Setup** cell first.
3. Run all cells top-to-bottom (or use *Run All*).

## Google Colab

1. Upload repo or mount Drive.
2. Set `DRIVE_DATA` in the setup cell to your `data/` folder path.
3. Run setup → restart kernel if PyTorch was installed → continue.

## Web demo

```bash
cd demo
pip install -r requirements-demo.txt
python api_server.py
```

Requires trained models in `../models/` (run the notebook modeling section first).

## Course

Sheridan College — INFO53883 AI & ML Capstone Project, Spring 2026.
