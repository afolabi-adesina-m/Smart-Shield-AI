# Smart-Shield AI — Final Presentation Slide Outline

**Course:** INFO53883 AI & ML Capstone · Team 2B · Spring 2026  
**Suggested length:** 12–15 slides · ~12–15 minutes + Q&A  
**Demo URL:** http://127.0.0.1:5050 (live or screenshot backup)

---

## Slide 1 — Title

- **Smart-Shield AI:** Multimodal Fusion for Ontario Highway Safety Routing
- Team 2B · Sheridan College PAIDA
- Names + date
- Visual: `assets/Final.png` pipeline diagram

**Speaker note:** One sentence — we fuse alert text, vision, and collision history into one Safety Score for route ranking.

---

## Slide 2 — Problem

- Ontario 400-series: high speeds + fast-changing weather
- Drivers get **511 alerts**, **maps ETA**, and **gut feel** — not one unified risk signal
- Fleet dispatchers lack a **safety-first** layer before ERP/TMS commits a route

**Visual:** Map of GTA + ice-storm icon

---

## Slide 3 — Research question

> Can we fuse NLP alerts, vision road conditions, and tabular collision risk into a single interpretable Safety Score **S** that ranks route alternatives?

- Sub-question (peer review): Does naïve speed advice (60 km/h on 100 km/h freeways) create new hazard?

---

## Slide 4 — Architecture (three brains + fusion)

| Brain | Input | Output |
|-------|-------|--------|
| **NLP** | 511-style alert text | T ∈ [0,1] |
| **Vision** | Road surface / weather proxy | V ∈ [0,1] |
| **Environmental** | Season, night, storm flags + tabular RF | E ∈ [0,1] |

**Fusion:** \( S = (0.25T + 0.35V + 0.40E) \times 100 \)

**Visual:** `assets/Final.png` or simplified three-box diagram

---

## Slide 5 — Data & models

- Toronto Police Service collisions (+ UK DfT benchmark)
- TF-IDF NLP · ResNet18 vision · Random Forest tabular
- SHAP explainability · fairness audit register (notebook §7)
- Artifacts in `models/` · reproducible via `notebooks/capstone.ipynb`

**Keep brief** — point to notebook for metrics table

---

## Slide 6 — Live demo walkthrough

1. Toronto → Barrie · **Clear** preset → S ≈ 11 (LOW)
2. Same route · **Ice storm — QEW rush** → S ≈ 80.6 (HIGH)
3. Show route ranking + map (OSRM + OpenStreetMap — free stack)

**Backup:** Screenshot `improvements/.../evidence/ice_storm_toronto_barrie_demo.png`

---

## Slide 7 — Peer review & audit (SS-AUDIT-2026-001)

- Critique: **60 km/h advisory** on 100–110 km/h traffic → speed differential risk
- Fix: separate **ranking (S)** from **operational guidance**
  - “Consider postponing this trip”
  - Relative speed vs flow (~25 km/h below ~105 km/h)
  - 80 km/h freeway floor (not prominent 60 km/h)

**Visual:** Before/after side-by-side (or live post-fix demo)

---

## Slide 8 — Individual use cases

| Persona | Value |
|---------|-------|
| Commuter | Compare alternates before leaving in a storm |
| EV driver | Safety rank + future charger layer |
| Rideshare | Skip HIGH-risk corridor trips |
| Family | Safest pick + delay-trip banner |

**Tagline:** Decision support for everyday Ontario drivers

---

## Slide 9 — Business use cases

| Industry | Value |
|----------|-------|
| Fleet / LTL | Crew safety + liability audit trail |
| Last-mile | Delay high-S manifests |
| Field service | Score technician routes at dispatch |
| Insurance | Tier history per trip for analytics |

**Tagline:** Reduce preventable exposure; document duty-of-care

---

## Slide 10 — ERP integration

```text
ERP order → TMS routes → Smart-Shield scores → Dispatcher confirms → Navigation
```

- REST API: `POST /api/score-routes` (+ future `trip_id`, audit fields)
- Touchpoints: delivery promises, dispatch, HR override rules, finance delay codes
- Platforms: SAP TM, Dynamics 365, NetSuite (via middleware)

**Visual:** Simple flow diagram (4–5 boxes)

**Speaker note:** Smart-Shield recommends; ERP workflow + human decides.

---

## Slide 11 — Governance & limitations

- Research prototype — **not** official MTO / 511 guidance
- Human-in-the-loop required for production
- Small NLP corpus · vision presets in demo · Toronto-trained tabular model
- No field trial / IRB study in capstone scope

---

## Slide 12 — Future work

| Priority | Item |
|----------|------|
| P1 | Live 511 feed · collision P calibration |
| P2 | EV charging layer · ERP webhooks · TMS connectors |
| P3 | Agency pilot · microsimulation validation |

Ref: `docs/ROUTE-PLANNING-USE-CASES-AND-ERP.md`

---

## Slide 13 — Conclusion

- Multimodal fusion → interpretable route ranking in open demo stack
- Peer review improved **operational messaging** (not just km/h)
- Path to product: commuter app **today**, ERP/TMS microservice **tomorrow**

**Closing line:**  
*“Risk minimization in a model is not the same as safe operational guidance.”*

---

## Slide 14 — Q&A / Thank you

- Repo structure · demo commands · paper appendix (Business Value)
- Contact / GitHub link if applicable

---

## Optional backup slides

### B1 — Ice storm fusion math
- T=1, V=0.82, E=0.625 → S ≈ 80.6 walkthrough

### B2 — API JSON sample
- `operational_guidance`, `safety_score`, `relative_speed_text`

### B3 — Fairness / ethics register
- Notebook Section 7 summary

### B4 — ERP sample payload
- From `ROUTE-PLANNING-USE-CASES-AND-ERP.md` §4.3

---

## Presentation tips

1. **Lead with demo** (Slide 6) if audience is non-technical — then explain brains.
2. **Spend 2–3 min on audit story** — shows critical thinking (Slide 7).
3. **Business slides (8–10)** matter for instructors and industry guests.
4. Have **offline screenshots** if Wi-Fi/OSRM fails during live demo.
5. Rehearse ice-storm vs clear toggle — clearest “wow” moment.

---

## Files to compile / show

| Asset | Path |
|-------|------|
| Pipeline diagram | `assets/Final.png` |
| Ice storm (before) | `improvements/speed-advisory-audit/evidence/ice_storm_toronto_barrie_demo.png` |
| Paper + Business appendix | `docs/paper/main.tex` → compile to PDF |
| Full use cases | `docs/ROUTE-PLANNING-USE-CASES-AND-ERP.md` |

---

*Outline version: 2026-06-26 · Team 2B*
