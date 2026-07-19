# Improvement Backlog — Speed Advisory

**Audit ID:** SS-AUDIT-2026-001  
**Last updated:** 2026-06-26

Status key: `open` | `in_progress` | `done` | `wontfix`

| ID | Task | Priority | Status | Owner | Target files |
|----|------|----------|--------|-------|--------------|
| B-01 | Add HIGH-tier trip-level messages to API response | P1 | done | Team 2B | `demo/inference.py` |
| B-02 | Show “Avoid travel / delay trip” banner in UI when S≥71 | P1 | done | Team 2B | `demo/static/js/app.js`, `index.html` |
| B-03 | Implement `operational_guidance` field separate from S | P1 | done | Team 2B | `src/safety_score.py` |
| B-04 | Add relative speed text (“reduce by X km/h vs traffic”) | P1 | done | Team 2B | `src/safety_score.py`, `inference.py` |
| B-05 | Clamp v_rec with configurable floor (no &lt;80 km/h on 400-series demo default) | P1 | done | Team 2B | `src/safety_score.py` |
| B-06 | Research prototype disclaimer in demo header | P3 | done | Team 2B | `demo/templates/index.html` |
| B-07 | Calibrate RF collision P; document in notebook | P2 | open | — | `notebooks/capstone.ipynb` |
| B-08 | Re-run ice-storm case study; update evidence screenshot | P1 | in_progress | Team 2B | `evidence/` |
| B-09 | Update LaTeX paper with “post-fix” comparison table | P2 | done | Team 2B | `docs/paper/main.tex` |
| B-10 | Instructor audit sign-off | P3 | open | — | `tracking/AUDIT-LOG.md` |

## Sprint suggestion (minimal close-out)

1. ~~**B-03, B-04, B-05** — logic in `safety_score.py`~~ ✅  
2. ~~**B-01, B-02, B-06** — demo UX~~ ✅  
3. **B-08** — new screenshot for evidence (manual capture or Playwright)  
4. **B-10** — reviewer sign-off  
