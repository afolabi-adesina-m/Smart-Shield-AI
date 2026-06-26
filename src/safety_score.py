"""Safety Score S — fuse NLP (T), Vision (V), and Environmental (E) brains."""

from __future__ import annotations

from typing import Any, Dict, List, Tuple

# Brain fusion weights (charter defaults; Lasso can tune in production)
W_T = 0.25
W_V = 0.35
W_E = 0.40

# E_index component weights (Paper 2 grounded)
E_WEIGHTS = {"surface": 0.35, "visibility": 0.30, "wind": 0.20, "temp": 0.15}

POSTED_SPEED_KMH = 100  # typical 400-series limit
# Audit SS-AUDIT-2026-001: avoid sub-80 km/h absolute caps on 400-series demo defaults
FREEWAY_MIN_ADVISORY_KMH = 80
# Assumed prevailing speed when live probe data unavailable (Ontario freeway typical)
DEFAULT_PREVAILING_TRAFFIC_KMH = 105


def compute_e_index(
    surface_risk: float,
    visibility_risk: float,
    wind_risk: float,
    temp_risk: float,
) -> float:
    """Environmental risk index in [0, 1]."""
    e = (
        E_WEIGHTS["surface"] * surface_risk
        + E_WEIGHTS["visibility"] * visibility_risk
        + E_WEIGHTS["wind"] * wind_risk
        + E_WEIGHTS["temp"] * temp_risk
    )
    return min(1.0, max(0.0, e))


def e_index_from_features(
    month_num: int,
    season_num: int,
    is_night: int,
    is_winter_storm: bool = False,
) -> float:
    """Derive E_index from tabular scenario features (matches live test cases)."""
    surface = 1.0 if is_winter_storm or season_num == 1 else 0.2
    wind = 1.0 if is_winter_storm else (0.5 if season_num == 1 else 0.1)
    visibility = min(1.0, 0.8 * is_night + 0.2 * (1 - is_night))
    temp = 1.0 if month_num in (12, 1, 2) else 0.1
    return compute_e_index(surface, visibility, wind, temp)


def compute_safety_score(t_nlp: float, v_vision: float, e_index: float) -> float:
    """Master Safety Score S in [0, 100]."""
    return (W_T * t_nlp + W_V * v_vision + W_E * e_index) * 100


def risk_tier(s: float) -> Tuple[str, str, float]:
    """
    Return (tier_label, colour, recommended_speed_fraction).
    Charter: LOW 0-30, MEDIUM 31-70, HIGH 71-100.
    """
    if s >= 71:
        return "HIGH", "#C73E1D", 0.60
    if s >= 31:
        return "MEDIUM", "#F18F01", 0.80
    return "LOW", "#3B7A57", 1.00


def recommended_speed_kmh(s: float, posted: float = POSTED_SPEED_KMH) -> int:
    """Legacy helper — returns clamped advisory speed (see build_operational_advisory)."""
    return build_operational_advisory(s, posted=posted)["recommended_speed_kmh"]


def build_operational_advisory(
    s: float,
    posted: float = POSTED_SPEED_KMH,
    prevailing_traffic_kmh: float = DEFAULT_PREVAILING_TRAFFIC_KMH,
    freeway_min_kmh: float = FREEWAY_MIN_ADVISORY_KMH,
) -> Dict[str, Any]:
    """
    Separate route-ranking score S from user-facing operational guidance.
    SS-AUDIT-2026-001: trip-level messages + traffic-aware speed floor.
    """
    tier, color, frac = risk_tier(s)
    naive_rec = int(round(posted * frac))
    clamped_rec = int(round(min(posted, max(freeway_min_kmh, naive_rec))))
    relative_reduction = max(0, int(round(prevailing_traffic_kmh - clamped_rec)))

    if tier == "HIGH":
        guidance = "AVOID_TRAVEL"
        primary = "Consider postponing this trip — conditions are hazardous."
        steps: List[str] = [
            "Consider postponing travel or waiting until conditions improve.",
            "If you must travel, use the lowest Safety Score route shown.",
            "Right lane, hazard lights, match truck pace — avoid isolated slow driving in passing lanes.",
        ]
        relative_text = (
            f"If driving, reduce speed by about {relative_reduction} km/h below "
            f"typical highway flow (~{int(prevailing_traffic_kmh)} km/h)."
        )
    elif tier == "MEDIUM":
        guidance = "REDUCE_RELATIVE"
        primary = "Increase caution — reduce speed and following distance."
        steps = [
            "Increase following distance and reduce speed gradually with traffic.",
            f"Aim for roughly {relative_reduction} km/h below typical flow if conditions warrant.",
        ]
        relative_text = (
            f"Reduce speed by about {relative_reduction} km/h below typical flow "
            f"(~{int(prevailing_traffic_kmh)} km/h)."
        )
    else:
        guidance = "NORMAL"
        primary = "Conditions appear favourable — drive to posted limit and stay alert."
        steps = []
        relative_text = "Maintain posted highway speed unless traffic or signs indicate otherwise."

    return {
        "operational_guidance": guidance,
        "operational_message": primary,
        "guidance_steps": steps,
        "recommended_speed_kmh": clamped_rec,
        "naive_recommended_speed_kmh": naive_rec,
        "relative_speed_reduction_kmh": relative_reduction,
        "relative_speed_text": relative_text,
        "prevailing_traffic_kmh_assumed": int(prevailing_traffic_kmh),
        "tier": tier,
        "tier_color": color,
    }


def fuse_scenario(
    t_nlp: float,
    v_vision: float,
    month_num: int,
    season_num: int,
    is_night: int,
    is_winter_storm: bool = False,
) -> Dict[str, float]:
    """Full fusion for one highway scenario."""
    e = e_index_from_features(month_num, season_num, is_night, is_winter_storm)
    s = compute_safety_score(t_nlp, v_vision, e)
    _, _, speed_frac = risk_tier(s)
    advisory = build_operational_advisory(s)
    return {
        "T_nlp": round(t_nlp, 3),
        "V_vision": round(v_vision, 3),
        "E_index": round(e, 3),
        "S": round(s, 1),
        "tier": advisory["tier"],
        "V_rec_kmh": advisory["recommended_speed_kmh"],
        "speed_frac": speed_frac,
        **{k: advisory[k] for k in (
            "operational_guidance",
            "operational_message",
            "guidance_steps",
            "relative_speed_reduction_kmh",
            "relative_speed_text",
        )},
    }
