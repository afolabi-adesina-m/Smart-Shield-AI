# Traceability Matrix

Links audit findings to project artifacts for Sheridan / external review.

| Audit artifact | Repository path |
|----------------|-----------------|
| Audit package root | `improvements/speed-advisory-audit/` |
| Case study | `improvements/speed-advisory-audit/case-study/01-toronto-barrie-ice-storm.md` |
| Screenshot evidence (before) | `improvements/speed-advisory-audit/evidence/ice_storm_toronto_barrie_demo.png` |
| Screenshot evidence (after) | `improvements/speed-advisory-audit/evidence/ice_storm_toronto_barrie_postfix.png` |
| Improvement areas | `improvements/speed-advisory-audit/IMPROVEMENT-AREAS.md` |
| LaTeX paper (§4 table, §6 figure) | `docs/paper/main.tex` |
| Paper figure copy | `docs/paper/figures/ice_storm_toronto_barrie_demo.png` |
| Fusion + speed tiers | `src/safety_score.py` — `risk_tier()`, `build_operational_advisory()`, `recommended_speed_kmh()` |
| Demo route scoring | `demo/inference.py` — `SmartShieldEngine.score_route()` |
| Demo API | `demo/api_server.py` |
| Demo UI | `demo/templates/index.html`, `demo/static/js/app.js` |
| NLP preset (TC-5 ice storm) | `src/nlp_brain.py` — `SCENARIO_ALERTS`, `WEATHER_PRESETS` in inference |
| Vision preset V=0.82 | `demo/inference.py` — `VISION_BY_PRESET["ice_storm"]` |
| Ethics register (notebook) | `notebooks/capstone.ipynb` — Section 7 |
| ERD / pipeline reference | `docs/Smart-Shield_ERD_and_Flow_Reference.md` |

## Requirement → test mapping

| Requirement | Verification |
|-------------|--------------|
| Ice storm produces HIGH S | Case study repro steps; S≈80.6 |
| HIGH tier must not rely on 60 km/h alone post-fix | AC-2, AC-4 in `ACCEPTANCE-CRITERIA.md` |
| Route ranking preserved | AC-1 |
| Audit trail complete | This file + `AUDIT-LOG.md` |
