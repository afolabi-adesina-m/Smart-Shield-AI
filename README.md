# Smart-Shield AI — INFO53883 Capstone (Team 2B)

Multimodal highway safety scoring: **NLP alerts** + **vision road conditions** + **tabular collision risk** → fused Smart-Shield score.

> **Full file-by-file guide:** see [`PROJECT_FILES.md`](PROJECT_FILES.md) for an explanation of every folder and file in this repository.

## Repository layout

```
├── notebooks/capstone.ipynb              # Main notebook (Colab / local / Kaggle)
├── notebooks/capstone_with_results.ipynb # Annotated copy with saved outputs + explanations
├── PROJECT_FILES.md                      # File-by-file guide (this repo)
├── src/                                  # nlp_brain, vision_brain, safety_score, cm_helpers
├── demo/                                 # Flask maps demo (api_server.py)
├── Data/                                 # CSV datasets (gitignored) + vision_cache/
├── models/                               # Trained artifacts (see models/README.md)
├── docs/                                 # Proposals, design docs, literature
├── improvements/                         # Post-capstone audits & enhancement tracking
├── explanations/                         # Auto-generated glossary, swimlane, split docs
├── assets/                               # Diagrams
└── archive/                              # Old notebooks + notebook build scripts
```

## Quick start (local)

```bash
pip install -r requirements.txt
pip install torch>=2.4 torchvision --index-url https://download.pytorch.org/whl/cpu
```

1. Copy casualty CSV files into `data/` (see `data/README.md`).
2. Open `notebooks/capstone.ipynb` and run the **Environment Setup** cell first.
3. Run all cells top-to-bottom (or use *Run All*).

**Auto-save & doc updates:** The last cell in each notebook runs `post_notebook_run.py` when execution finishes — syncing outputs, refreshing annotations, and rebuilding `explanations/`. Workspace auto-save is enabled (1.5s delay). For a fully headless run: `run_notebook.bat` or `python scripts/run_notebook_pipeline.py`.

**Collapsible sections:** Sections start collapsed (like hiding Excel rows). Click the **▶** arrow beside a section heading to expand only that part. See the **Section Navigator** cell near the top of the notebook.

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

## Explanation docs (auto-updated)

Glossary, sprint swimlane, and train/test split reference live in [`explanations/`](explanations/). They rebuild from `definitions.json` plus live notebook/data scans.

| Trigger | How |
|---------|-----|
| Edit notebook or `definitions.json` | Cursor hook (`.cursor/hooks.json`) |
| Git commit | Enable once: `git config core.hooksPath .githooks` |
| Manual | `python explanations/build_all.py` or double-click `explanations/update.bat` |
| Background | `python explanations/build_all.py --watch` |

Edit **`explanations/definitions.json`** to change glossary terms, pipeline steps, or split constants.

## Course

Sheridan College — INFO53883 AI & ML Capstone Project, Spring 2026.
