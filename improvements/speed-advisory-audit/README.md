# Speed Advisory Improvement — Audit Package

**Project:** Smart-Shield AI (INFO53883 Capstone, Team 2B)  
**Audit ID:** `SS-AUDIT-2026-001`  
**Opened:** 2026-06-26  
**Trigger:** Peer-review question on absolute speed advisories during ice-storm scenarios

## Purpose

This folder is the **official audit trail** for a known gap between:

- what the fusion model correctly detects (**high environmental risk**), and  
- what the demo currently tells drivers (**fixed km/h caps** that may conflict with live highway traffic).

It is separate from the capstone demo code so reviewers, instructors, and future implementers can trace **finding → evidence → improvement → verification** without digging through the notebook alone.

## Contents

| Path | Description |
|------|-------------|
| [`case-study/01-toronto-barrie-ice-storm.md`](case-study/01-toronto-barrie-ice-storm.md) | Documented reproduction of the ice-storm screenshot |
| [`IMPROVEMENT-AREAS.md`](IMPROVEMENT-AREAS.md) | Seven improvement areas ranked by priority |
| [`tracking/AUDIT-LOG.md`](tracking/AUDIT-LOG.md) | Chronological audit log |
| [`tracking/BACKLOG.md`](tracking/BACKLOG.md) | Action items with owners and status |
| [`tracking/ACCEPTANCE-CRITERIA.md`](tracking/ACCEPTANCE-CRITERIA.md) | Definition of done for closing this audit |
| [`tracking/TRACEABILITY.md`](tracking/TRACEABILITY.md) | Links to code, paper, and demo |
| [`evidence/`](evidence/) | Screenshots and run artifacts |

## Related artifacts

- LaTeX paper (Section 6 case study): [`docs/paper/main.tex`](../docs/paper/main.tex)
- Current speed logic: [`src/safety_score.py`](../src/safety_score.py) (`risk_tier`, `recommended_speed_kmh`)
- Demo scoring: [`demo/inference.py`](../demo/inference.py)

## Status summary

| Item | Status |
|------|--------|
| Issue documented | ✅ Complete |
| Evidence captured | ✅ Screenshot in `evidence/` |
| Improvement areas defined | ✅ See `IMPROVEMENT-AREAS.md` |
| Code / UI fixes | ⬜ Not started (tracked in `BACKLOG.md`) |
| Acceptance criteria met | ⬜ Open |

**Current system behaviour is acceptable for capstone demonstration only.** Operational deployment requires closing items in the backlog.
