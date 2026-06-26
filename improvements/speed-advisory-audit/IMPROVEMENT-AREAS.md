# Improvement Areas (from Ice-Storm Case Study)

**Source finding:** Toronto → Barrie, ice-storm preset, S=80.6, advisory 60 km/h on Hwy 400  
**Audit ID:** SS-AUDIT-2026-001

Each area maps to backlog items in [`tracking/BACKLOG.md`](tracking/BACKLOG.md).

---

## Priority 1 — Must fix before any operational pilot

### IA-1: Trip-level messaging for HIGH tier

**Problem:** At S ≥ 71, users see “60 km/h” but not **avoid travel**, **delay**, or **exit highway**.

**Improvement:** When tier = HIGH, UI and API return ordered guidance:

1. Consider postponing trip  
2. Use safest ranked alternate route  
3. If driving: right lane, hazard lights, match prevailing traffic pace — not isolated slow driving in passing lanes  

**Affected files:** `demo/inference.py`, `demo/static/js/app.js`, `demo/templates/index.html`

---

### IA-2: Traffic-aware speed floor (speed-differential guard)

**Problem:** 60 km/h vs 100–110 km/h prevailing flow → rear-end / lane-change conflicts.

**Improvement:** Replace naked `v_p × φ(S)` with:

```
v_rec = clamp(v_p × φ(S), v_min_safe, v_p)
v_min_safe = max(v_posted_min, v_traffic_p85 − margin)   # when probe data available
```

Until probe data exists, use **relative advisory**: “Reduce speed by 15–20 km/h below surrounding traffic” instead of absolute 60 km/h on freeways.

**Affected files:** `src/safety_score.py`, `demo/inference.py`

---

### IA-3: Separate “risk score” from “operational advice”

**Problem:** One number S drives both ranking and speed text.

**Improvement:** API returns:

- `safety_score` — for route ranking (unchanged)  
- `operational_guidance` — enum + text (`AVOID_TRAVEL`, `REDUCE_RELATIVE`, `NORMAL`)  
- `speed_advisory_kmh` — optional, only when context supports it  

**Affected files:** `src/safety_score.py`, `demo/inference.py`, `demo/api_server.py`

---

## Priority 2 — Should fix for publishable / credible demo

### IA-4: Calibrate collision probability P

**Problem:** Ice-storm and clear routes both show **P ≈ 0.59**, undermining trust.

**Improvement:** Platt scaling or isotonic regression on held-out Toronto data; hide P in UI until calibrated, or show tier-aligned buckets.

**Affected files:** `notebooks/capstone.ipynb`, `demo/inference.py`, `models/` artifacts

---

### IA-5: Speed-variance penalty in fusion (optional S_Δv term)

**Problem:** Fusion ignores whether recommended speed conflicts with expected traffic.

**Improvement:** Add penalty when `|v_rec − v_traffic| > threshold` before finalizing user-facing advice (not necessarily S itself).

**Affected files:** new module under `improvements/speed-advisory-audit/prototypes/` or `src/safety_score.py`

---

### IA-6: Live 511 + probe data integration

**Problem:** Demo uses static weather presets and preset V values.

**Improvement:** Pull Ontario 511 alerts for NLP; optional INRIX/simulated probe speeds for v_traffic.

**Affected files:** new `src/data_511.py` (future), `demo/inference.py`

---

## Priority 3 — Governance and validation

### IA-7: Decision-support disclaimer and audit logging

**Problem:** Demo can be read as authoritative MTO guidance.

**Improvement:** Persistent banner: “Research prototype — not official traffic control”; log user overrides; ethics register cross-reference (notebook Section 7).

**Affected files:** `demo/templates/index.html`, `tracking/AUDIT-LOG.md`

---

## Summary matrix

| ID | Area | Priority | Closes audit? |
|----|------|----------|---------------|
| IA-1 | Trip-level HIGH messaging | P1 | Partial |
| IA-2 | Traffic-aware speed floor | P1 | Partial |
| IA-3 | Risk vs operational split | P1 | Partial |
| IA-4 | Calibrate collision P | P2 | No |
| IA-5 | Speed-variance penalty | P2 | No |
| IA-6 | Live 511 / probe data | P2 | No |
| IA-7 | Disclaimer + audit log | P3 | Yes (governance) |

**Minimum to close SS-AUDIT-2026-001:** IA-1 + IA-2 + IA-3 + IA-7 (see [`tracking/ACCEPTANCE-CRITERIA.md`](tracking/ACCEPTANCE-CRITERIA.md)).
