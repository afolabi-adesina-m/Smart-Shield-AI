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
├── improvements/              # Post-capstone audits & enhancement tracking
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

**Desktop** (sidebar + map):

```bash
cd demo
pip install -r requirements-demo.txt
python api_server.py
# http://127.0.0.1:5050
```

**Mobile** (portrait map + bottom sheet — iPhone & Android):

```bash
cd demo
python mobile_server.py
# http://127.0.0.1:5051
```

On a physical phone (same Wi‑Fi as your PC), use the LAN URL printed by `mobile_server.py`, e.g. `http://192.168.x.x:5051`.

**Run both at once:** open two terminals, or double-click `demo/run_both.bat` (Windows).

| Demo | Port | Command |
|------|------|---------|
| Desktop | 5050 | `python api_server.py` |
| Mobile | 5051 | `python mobile_server.py` |

Both can run simultaneously — they use different ports and share the same scoring API logic.

Requires trained models in `../models/` (run the notebook modeling section first).

## Improvements & audit

Peer-review finding on speed advisories (ice-storm case study): see [`improvements/speed-advisory-audit/`](improvements/speed-advisory-audit/) (audit ID **SS-AUDIT-2026-001**).

## Future work, use cases & ERP integration

Route planning vision for individuals and businesses, plus ERP/TMS integration patterns: [`docs/ROUTE-PLANNING-USE-CASES-AND-ERP.md`](docs/ROUTE-PLANNING-USE-CASES-AND-ERP.md).

Final presentation slide outline (12–15 slides): [`docs/FINAL-PRESENTATION-SLIDE-OUTLINE.md`](docs/FINAL-PRESENTATION-SLIDE-OUTLINE.md).

## Course

Sheridan College — INFO53883 AI & ML Capstone Project, Spring 2026.
