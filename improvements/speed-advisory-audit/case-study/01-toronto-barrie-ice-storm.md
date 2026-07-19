# Case Study: Toronto → Barrie, Ice Storm Preset

**Audit reference:** SS-AUDIT-2026-001  
**Evidence (before):** [`../evidence/ice_storm_toronto_barrie_demo.png`](../evidence/ice_storm_toronto_barrie_demo.png)  
**Evidence (after):** [`../evidence/ice_storm_toronto_barrie_postfix.png`](../evidence/ice_storm_toronto_barrie_postfix.png) *(capture after running post-fix demo)*

## Reproduction steps

1. `conda activate ai_work_final`
2. `cd demo` → `python api_server.py`
3. Open http://127.0.0.1:5050
4. **From:** Toronto, Ontario  
5. **To:** Barrie, Ontario  
6. **Weather / 511 scenario:** *Ice storm — QEW rush*
7. Click **Find safest routes**

## Before / after (Safest pick — fastest route, Hwy 400)

| Field | Before (pre-fix) | After (post-fix SS-AUDIT-2026-001) |
|-------|------------------|--------------------------------------|
| Safety Score **S** | **80.6** | **80.6** (unchanged — ranking preserved) |
| Tier | HIGH | HIGH |
| Primary user message | *(none — only km/h shown)* | **Consider postponing this trip — conditions are hazardous.** |
| `operational_guidance` | *(not exposed)* | `AVOID_TRAVEL` |
| Absolute speed shown | **60 km/h** (prominent) | **Relative:** reduce ~**25 km/h** below ~105 km/h flow |
| `recommended_speed_kmh` | 60 | **80** (400-series floor clamp) |
| `naive_recommended_speed_kmh` | 60 | 60 *(retained for audit transparency)* |
| Prototype disclaimer | absent | **Research prototype — not official MTO or 511 Ontario guidance** |

## Observed outputs — post-fix detail

| Field | Value | Interpretation |
|-------|-------|----------------|
| Safety Score **S** | **80.6** | HIGH tier (71–100) |
| Tier label | HIGH risk | Correctly flags severe conditions |
| **Operational message** | Postpone / avoid travel | Trip-level guidance (IA-2) |
| **Relative speed** | ~25 km/h below ~105 km/h flow | Traffic-aware framing (IA-3) |
| **Clamped advisory** | **80 km/h** | Floor on 400-series demo default (IA-4) |
| **T** (NLP) | 1.00 | TC-5 alert saturated hazard lexicon |
| **V** (Vision preset) | 0.82 | Ice-storm surface proxy |
| **E** (Environmental) | 0.625 | Winter-storm flags + non-winter month temp term |
| Collision **P** | 0.594 | Tabular RF (labeled *uncalibrated demo* in UI) |
| Distance / duration | 95 km · 84 min | OSRM driving route |

Alternate route: **S = 83.4** (worse), same operational guidance pattern.

## Contrast: same OD, clear preset

| Field | Clear — summer highway | Ice storm — QEW rush |
|-------|------------------------|----------------------|
| S | 11.3 | 80.6 |
| Tier | LOW | HIGH |
| Primary message | Normal conditions | Avoid / postpone travel |
| v_rec (clamped) | 100 km/h | **80 km/h** |
| Relative text | Maintain posted speed | Reduce ~25 km/h vs flow |

## Fusion walkthrough (ice storm)

Base score from charter weights \(w_T=0.25\), \(w_V=0.35\), \(w_E=0.40\):

\[
S_{\text{base}} = (0.25 \times 1.00 + 0.35 \times 0.82 + 0.40 \times 0.625) \times 100 \approx 78.7
\]

Demo adds route/distance adjustment in `demo/inference.py` → **S ≈ 80.6**.

**Before:** HIGH tier applied \(\phi(S) = 0.60\) → **\(v_{\text{rec}} = 60\) km/h** only.

**After:** `build_operational_advisory()` in `src/safety_score.py` separates ranking from operations:
- `operational_guidance = AVOID_TRAVEL`
- `naive_recommended_speed_kmh = 60`
- `recommended_speed_kmh = max(80, min(100, 60)) = 80`
- `relative_speed_text` = reduce ~25 km/h below assumed ~105 km/h prevailing flow

## Peer-review finding

> *If AI advises 60 km/h on a highway currently operating at 100–110 km/h, would that not cause an accident?*

### Assessment (updated)

| Aspect | Verdict |
|--------|---------|
| Risk **detection** (high S in ice storm) | ✅ Appropriate |
| Route **ranking** (80.6 vs 83.4) | ✅ Appropriate |
| Absolute **60 km/h in live lane** on 400-series | ✅ **Mitigated** — floor + relative messaging |
| Primary user message at HIGH S | ✅ **Mitigated** — avoid/delay travel first |

## Root cause (system design) — resolution status

| Issue | Status |
|-------|--------|
| Single formula maps tier → fixed fraction of posted limit | **Partially addressed** — naive value retained; clamp + relative text added |
| No live traffic speed or minimum safe differential | **Partially addressed** — assumed prevailing flow (105 km/h) + relative reduction |
| UI displays absolute km/h without trip-level warnings | **Addressed** — banner + operational message |
| Collision P not calibrated | **Open** — B-07; UI notes *uncalibrated demo* |

This case study is the **evidence anchor** for all items in [`../IMPROVEMENT-AREAS.md`](../IMPROVEMENT-AREAS.md).
