# Acceptance Criteria — Closing SS-AUDIT-2026-001

This audit may be marked **closed** when all mandatory criteria pass on a fresh localhost run.

## Mandatory (P1)

- [x] **AC-1:** Reproduce ice-storm Toronto→Barrie; S remains HIGH (≈71–85); route ranking unchanged.
- [x] **AC-2:** For S ≥ 71, UI shows **primary** message: *Consider avoiding travel* or *Delay trip* (not only km/h).
- [x] **AC-3:** API JSON includes `operational_guidance` distinct from `safety_score` and `recommended_speed_kmh`.
- [x] **AC-4:** For 400-series demo defaults, user-facing text includes **relative** guidance (e.g. reduce speed vs surrounding traffic) when absolute cap would fall below 80 km/h.
- [x] **AC-5:** Demo header states **research prototype — not official MTO / 511 guidance**.

## Evidence required

- [ ] **AC-6:** New screenshot in `evidence/` showing updated HIGH-tier messaging (same route as original case study).
- [x] **AC-7:** `case-study/01-toronto-barrie-ice-storm.md` updated with “before / after” table.
- [x] **AC-8:** Entry added to `tracking/AUDIT-LOG.md` with closure date.

## Optional (P2 — recommended but not blocking)

- [x] **AC-9:** Collision P calibrated or hidden until calibrated. *(UI labels as uncalibrated demo; raw P de-emphasized)*
- [x] **AC-10:** Paper appendix updated with post-fix behaviour. *(Appendix §Post-Fix Speed Advisory in `docs/paper/main.tex`)*

## Explicit non-goals (capstone scope)

- Live 511 API integration (IA-6) — future work  
- Field trial / IRB user study  
- MTO operational approval  

## Sign-off

| Criterion block | Pass? | Verified by | Date |
|-----------------|-------|-------------|------|
| AC-1 – AC-5 | Yes | Team 2B (API + logic test) | 2026-06-26 |
| AC-6 – AC-8 | Partial (AC-6 pending screenshot) | Team 2B | 2026-06-26 |
