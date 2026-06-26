# Smart-Shield AI — Route Planning Use Cases & ERP Integration

**Project:** INFO53883 AI & ML Capstone · Team 2B  
**Status:** Future-work / deployment vision (beyond current research prototype)  
**Related:** [`paper/main.tex`](paper/main.tex) §Future Work · [`improvements/speed-advisory-audit/`](../improvements/speed-advisory-audit/)

---

## 1. Positioning

Smart-Shield AI is a **safety-aware route planning and decision-support layer**. It ranks alternative paths using a fused Safety Score **S** (NLP alerts + vision proxies + environmental/tabular risk) and returns **operational guidance** separate from ranking (e.g. postpone travel, relative speed advice).

In production, it would sit **alongside** — not replace — existing navigation, TMS (Transportation Management Systems), and ERP workflows:

```text
ERP / TMS (orders, fleet, schedules)
        │
        ▼
Smart-Shield API  ──►  Safety Score S + operational guidance per route leg
        │
        ▼
Dispatcher / driver UI  ──►  Human confirms or overrides (logged)
        │
        ▼
Navigation (OSRM, Google, TomTom, etc.)  ──►  Turn-by-turn execution
```

**Principle:** Smart-Shield recommends; humans (or governed automation rules in ERP) decide.

---

## 2. Individual use cases

| Persona | Scenario | Smart-Shield value |
|---------|----------|-------------------|
| **Daily commuter** | Toronto ↔ Barrie on Hwy 400/404 | Compare fastest vs alternate routes when weather alerts spike; see HIGH-tier “postpone travel” before leaving home |
| **Weekend driver** | Cottage country, seasonal storms | Rank routes by **S**, not only ETA; understand *why* (T, V, E breakdown) |
| **EV driver** | Long Ontario highway trip | Optional layer: fast chargers within X km of route (future work); safety-first messaging during ice storm |
| **Rideshare / gig driver** | Multi-stop urban + highway mix | Per-leg safety score; avoid accepting runs that cross HIGH-risk corridors in blizzard presets |
| **Newcomer / tourist** | Unfamiliar with Ontario winter driving | Plain-language 511-style alerts fused into one score + trip-level guidance |
| **Caregiver / family planner** | School pickup, hospital visit in bad weather | “Safest pick” among OSRM alternates; delay-trip banner when S ≥ 71 |

**Individual product shape:** Web/mobile app or browser add-in (current demo direction) with free OSM/OSRM backend and optional premium live 511 + traffic probes.

---

## 3. Business use cases

| Industry | Use case | How Smart-Shield helps | ERP / system touchpoint |
|----------|----------|------------------------|-------------------------|
| **Logistics & LTL/FTL** | Line-haul Toronto → Northern Ontario | Rank alternates for **crew safety** and liability; flag trips to reschedule | TMS route planning, dispatch board |
| **Last-mile delivery** | Urban routes with weather windows | Score routes before manifest lock; delay high-S deliveries | WMS + route optimization (Onfleet, Route4Me, custom) |
| **Field service** | Utility / telecom truck rolls | Send technicians on lowest-S route; document advisory at dispatch time | ServiceMax, Salesforce Field Service, Dynamics 365 |
| **Fleet leasing / insurance** | Telematics + risk pricing | Export S and tier history per trip for underwriting analytics | Insurance data warehouse, telematics API |
| **Municipal / provincial ops** | Winter maintenance prioritization | Correlate alert NLP + E_index with plow/salt deployment (decision support) | Asset management, 511 ops dashboards |
| **School transportation** | Bus route safety review | Audit alternate paths for HIGH S before snow days | Student information + routing systems |
| **Construction / oversize haul** | Permitted corridor selection | Avoid HIGH-tier legs when moving wide loads | Project ERP (Procore, SAP PS), permit workflow |
| **Emergency management** | Evacuation / resupply planning | Rank ingress routes under scenario weather presets | EOC GIS, CAD systems |

**B2B value proposition:** Reduce **preventable exposure** (speed differential, wrong-route-in-storm), improve **audit trail** for duty-of-care, and unify **511 text + historical collision + conditions** in one API response.

---

## 4. ERP integration architecture

### 4.1 Where Smart-Shield plugs in

Most ERPs do not compute routes natively; they integrate with TMS or call routing APIs. Smart-Shield fits as a **scoring microservice**:

| ERP domain | Typical modules | Smart-Shield role |
|------------|-----------------|-------------------|
| **Order-to-cash** | Sales orders, delivery promises | Score proposed delivery routes before promise date commit |
| **Procurement / inbound** | PO lines, supplier slots | Score inbound milk-run alternates |
| **Manufacturing** | Production schedules, shipments | Align ship windows with weather-risk windows |
| **HR / workforce** | Driver shifts, overtime | Block dispatch when operational_guidance = `AVOID_TRAVEL` unless override |
| **Finance** | Cost centres, chargebacks | Allocate “weather delay” cost codes when trips postponed |
| **Analytics** | Power BI, SAP BW, Snowflake | Store S, tier, operational_message per trip_id |

### 4.2 Integration patterns

**Pattern A — Synchronous REST (simplest for capstone → ERP pilot)**

1. ERP/TMS sends `{ origin, destination, waypoints[], weather_context, vehicle_type }` to `POST /api/score-routes`.
2. Smart-Shield returns ranked routes + `operational_guidance`, `safety_score`, `relative_speed_text`.
3. Dispatcher UI or business rule engine selects route or triggers “postpone” workflow.

**Pattern B — Event-driven (scalable fleets)**

1. Order released in ERP → message to queue (Kafka, Azure Service Bus, SAP Event Mesh).
2. Smart-Shield worker scores routes → publishes `TripSafetyScored` event.
3. TMS updates dispatch; ERP updates expected delivery datetime.

**Pattern C — Embedded iframe / plugin**

- Current Flask demo evolves into embeddable widget inside SAP Fiori, Dynamics 365, or NetSuite Suitelet.
- Same scoring API; SSO via OAuth2 / SAML for enterprise tenants.

### 4.3 Sample API contract (enterprise extension)

Current demo: `POST /api/score-routes`. Production extension fields:

```json
{
  "trip_id": "ERP-SO-88421",
  "vehicle_type": "heavy_truck",
  "ev_mode": false,
  "routes": [{ "distance_m": 95200, "duration_s": 5040, "summary": "Hwy 400" }],
  "weather": "ice_storm",
  "erp_context": {
    "customer_priority": "standard",
    "sla_hours": 24,
    "allow_delay": true
  }
}
```

Response adds audit fields: `scored_at`, `model_version`, `override_allowed`, `recommended_action` (`DISPATCH` | `DELAY` | `REROUTE`).

### 4.4 ERP platforms (examples)

| Platform | Integration approach |
|----------|---------------------|
| **SAP S/4HANA + TM** | BAPI/IDoc or OData wrapper around Smart-Shield API; safety outcome on freight unit |
| **Microsoft Dynamics 365 Supply Chain** | Power Automate flow on shipment create → HTTP score → update route |
| **Oracle NetSuite** | SuiteScript RESTlet calling Smart-Shield; custom record for trip safety log |
| **Odoo** | Module hook on `stock.picking` / fleet route wizard |
| **Custom TMS + PostgreSQL** | Direct microservice; store scores in `trip_safety_audit` table |

### 4.5 Governance & compliance (required for ERP)

- **Human-in-the-loop:** No auto-dispatch on HIGH S without logged override (SS-AUDIT-2026-001 alignment).
- **Immutable audit log:** `trip_id`, `S`, `operational_guidance`, dispatcher_id, override_reason, timestamp.
- **Prototype disclaimer** in UI until MTO / insurer sign-off.
- **Data residency:** Canadian hosting for public-sector pilots (PIPEDA).

---

## 5. Future work roadmap

Prioritized extensions beyond the capstone prototype:

| ID | Area | Description | Priority |
|----|------|-------------|----------|
| FW-01 | **Traffic-aware advisories** | Live probe speeds vs assumed 105 km/h flow | P1 — partially done (SS-AUDIT-2026-001) |
| FW-02 | **511 live feed** | Real Ontario alert text instead of TC-1–TC-5 presets | P1 |
| FW-03 | **Collision P calibration** | Platt scaling; hide or label uncalibrated P | P1 |
| FW-04 | **EV charging layer** | OSM / Open Charge Map stations within X km of route; optional `ev_mode` | P2 |
| FW-05 | **ERP REST + webhooks** | `trip_id`, audit log, `DISPATCH`/`DELAY`/`REROUTE` actions | P2 |
| FW-06 | **TMS connectors** | SAP TM, Dynamics, generic webhook adapter | P2 |
| FW-07 | **Multi-objective ranking** | Pareto front: minimize S, time, distance, cost | P2 |
| FW-08 | **Transformer NLP** | Fine-tuned alert encoder replacing TF-IDF | P3 |
| FW-09 | **Live MTO vision** | Camera API or crowd-sourced surface state | P3 |
| FW-10 | **Mobile app + offline** | Cached models for disconnected highway segments | P3 |
| FW-11 | **Microsimulation validation** | SUMO/VISSIM for speed-differential scenarios | P3 |
| FW-12 | **Pilot with agency partner** | MTO / municipal winter-ops decision support (non-operational) | P3 |

---

## 6. What we are *not* claiming (capstone scope)

- Not a replacement for Google Maps, Waze, or certified navigation devices.
- Not autonomous vehicle control or speed enforcement.
- Not official MTO or 511 Ontario guidance without agency partnership.
- Not production ERP-ready without security, SLA, and calibration work (FW-05–FW-06).

---

## 7. Suggested presentation slide (one-liner)

> **Smart-Shield AI:** Multimodal safety scoring for route choice — consumable by commuters today and by **ERP/TMS dispatch workflows** tomorrow, with human confirmation and full audit trail.

---

*Document version: 2026-06-26 · Team 2B*
