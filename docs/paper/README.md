# Smart-Shield AI — LaTeX paper

Draft manuscript for capstone publication, workshop submission, or arXiv preprint.

## Files

| File | Purpose |
|------|---------|
| `main.tex` | Full paper (intro through appendix) |
| `references.bib` | Bibliography — verify and expand before submission |
| `README.md` | This file |

## Compile (Windows / Anaconda)

```powershell
conda activate ai_work_final
cd "...\INFO53883 - AI & ML Capstone Project\docs\paper"

# Option A: pdflatex + bibtex (recommended)
pdflatex main.tex
bibtex main
pdflatex main.tex
pdflatex main.tex

# Option B: latexmk (if installed)
latexmk -pdf main.tex
```

Output: `main.pdf`

If `pdflatex` is missing: `conda install -c conda-forge texlive-core` (minimal) or install [MiKTeX](https://miktex.org/).

## Before submitting

1. Replace `[Author names and emails]` in `main.tex`.
2. Copy latest metric tables from `notebooks/capstone.ipynb` into Section 5 or Appendix.
3. Verify bibliography entries (especially `ahmad2022speed` placeholder).
4. Ice-storm case study figure is included: `figures/ice_storm_toronto_barrie_demo.png`.
5. Optional: add pipeline diagram from `assets/Final.png` as a second figure.
6. Business Value one-page summary: Appendix §Business Value \& ERP Integration; slide outline: `../FINAL-PRESENTATION-SLIDE-OUTLINE.md`.
7. Run plagiarism and Sheridan submission checklist.

## Speed-advisory discussion

Section 6 documents the peer-review question: advising **60 km/h** on **100–110 km/h** freeways can increase risk via **speed differential**. See Section 6.2 for seven improvement areas to implement in code (`src/safety_score.py`, `demo/inference.py`).
