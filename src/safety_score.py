"""Safety Score S — fuse NLP (T), Vision (V), and Environmental (E) brains."""

from __future__ import annotations

from typing import Dict, Tuple

# Brain fusion weights (charter defaults; Lasso can tune in production)
W_T = 0.25
W_V = 0.35
W_E = 0.40

# E_index component weights (Paper 2 grounded)
E_WEIGHTS = {"surface": 0.35, "visibility": 0.30, "wind": 0.20, "temp": 0.15}

POSTED_SPEED_KMH = 100  # typical 400-series limit


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
    _, _, frac = risk_tier(s)
    return int(round(posted * frac))


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
    tier, _, speed_frac = risk_tier(s)
    return {
        "T_nlp": round(t_nlp, 3),
        "V_vision": round(v_vision, 3),
        "E_index": round(e, 3),
        "S": round(s, 1),
        "tier": tier,
        "V_rec_kmh": recommended_speed_kmh(s),
        "speed_frac": speed_frac,
    }
