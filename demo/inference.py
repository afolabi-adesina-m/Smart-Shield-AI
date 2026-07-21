"""Load capstone models and score highway routes for the Maps demo."""

from __future__ import annotations

import sys
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

import joblib
import numpy as np

# Repo root: src/, models/, data/
_ROOT = Path(__file__).resolve().parent.parent
_SRC = _ROOT / "src"
if str(_SRC) not in sys.path:
    sys.path.insert(0, str(_SRC))

from nlp_brain import SCENARIO_ALERTS, fit_tfidf, t_score_from_text
from safety_score import build_operational_advisory, compute_e_index, fuse_scenario

# Fix 2 / Fix 3 — live 511 alerts + live weather. Both modules never raise;
# they return None on any failure so callers always have a safe fallback to
# the existing preset/calendar-based behaviour below.
from Live_alerts import nearby_alert_text
from Live_weather import live_risk_components

MODELS_DIR = _ROOT / "models"

# Demo weather presets → Ontario 511-style alert text
WEATHER_PRESETS: Dict[str, str] = {
    "clear": SCENARIO_ALERTS["TC-1 Clear rush-hour (401 Jul 5pm)"],
    "wet": SCENARIO_ALERTS["TC-3 Wet dawn bicycle (Hwy7 Apr 6am)"],
    "blizzard": SCENARIO_ALERTS["TC-2 Blizzard night (Hwy400 Jan 2am)"],
    "ice_storm": SCENARIO_ALERTS["TC-5 Ice storm rush (QEW Feb 5pm)"],
}

VISION_BY_PRESET = {
    "clear": 0.08,
    "wet": 0.42,
    "blizzard": 0.88,
    "ice_storm": 0.82,
}


class SmartShieldEngine:
  """Singleton-style loader for TF-IDF + optional tabular models."""

  def __init__(self) -> None:
      self.tfidf = None
      self.rf = None
      self.scaler = None
      self.feature_names: List[str] = []
      self._load()

  def _load(self) -> None:
      tfidf_path = MODELS_DIR / "tfidf_vectorizer.joblib"
      if tfidf_path.is_file():
          self.tfidf = joblib.load(tfidf_path)
      else:
          self.tfidf = fit_tfidf()

      rf_path = MODELS_DIR / "rf_tuned.joblib"
      if rf_path.is_file():
          self.rf = joblib.load(rf_path)
      scaler_path = MODELS_DIR / "scaler.joblib"
      if scaler_path.is_file():
          self.scaler = joblib.load(scaler_path)
      fn_path = MODELS_DIR / "feature_names.joblib"
      if fn_path.is_file():
          self.feature_names = list(joblib.load(fn_path))

  def _season(self, month: int) -> int:
      if month in (12, 1, 2):
          return 1
      if month in (3, 4, 5):
          return 2
      if month in (6, 7, 8):
          return 3
      return 4

  def _tabular_collision_risk(
      self, hour: int, month: int, is_night: int, is_rush: int
  ) -> Optional[float]:
      """RF probability of Injury+Fatal (demo signal), if model loaded."""
      if self.rf is None or self.scaler is None or not self.feature_names:
          return None
      row = {
          "OCC_HOUR": hour,
          "MONTH_NUM": month,
          "SEASON_NUM": self._season(month),
          "IS_NIGHT": is_night,
          "IS_RUSHHOUR": is_rush,
          "PEDESTRIAN_BIN": 0,
          "BICYCLE_BIN": 0,
          "AUTOMOBILE_BIN": 1,
      }
      x = np.array([[row.get(f, 0) for f in self.feature_names]], dtype=float)
      x_sc = self.scaler.transform(x)
      proba = self.rf.predict_proba(x_sc)[0]
      # classes 0=PD, 1=Injury, 2=Fatal — weight injury+fatal
      if len(proba) >= 3:
          return float(proba[1] + proba[2])
      return float(max(proba))

  def score_route(
      self,
      *,
      distance_m: float,
      duration_s: float,
      weather: str = "clear",
      custom_alert: str = "",
      hour: Optional[int] = None,
      month: Optional[int] = None,
      route_index: int = 0,
      lat: Optional[float] = None,
      lon: Optional[float] = None,
      force_preset: bool = False,
  ) -> Dict[str, Any]:
      """Fuse T+V+E into Safety Score S for one Directions API route leg.

      lat/lon (Fix 2 + Fix 3): when provided, real conditions near the route
      are used instead of the manual weather dropdown:
        - E_index comes from Live_weather.live_risk_components() (real
          surface/visibility/wind/temp), via safety_score.compute_e_index().
        - The NLP alert text comes from Live_alerts.nearby_alert_text()
          (real Ontario 511 events) instead of the fixed preset string.
      Either live source can fail independently (no network, nothing
      nearby, etc). Each falls back on its own to the previous behaviour —
      the calendar-based E_index guess, and the fixed preset/custom text —
      so the demo never breaks when live data isn't available.
      """
      now = datetime.now()
      hour = hour if hour is not None else now.hour
      month = month if month is not None else now.month
      is_rush = 1 if hour in (7, 8, 9, 16, 17, 18) else 0

      use_live = not force_preset and lat is not None and lon is not None

      # --- Fix 2: prefer a real nearby 511 alert over the fixed preset text.
      live_alert = nearby_alert_text(lat, lon) if use_live else None
      if custom_alert.strip():
          alert = custom_alert.strip()
          alert_source = "custom"
      elif live_alert:
          alert = live_alert
          alert_source = "live_511"
      else:
          alert = WEATHER_PRESETS.get(weather, WEATHER_PRESETS["clear"])
          alert_source = "preset_fallback"
      t_nlp = t_score_from_text(alert, self.tfidf)

      # --- Fix 3: prefer real weather over the calendar-based E_index guess.
      live_weather = live_risk_components(lat, lon) if use_live else None
      if live_weather:
          e_index_override = compute_e_index(
              live_weather["surface_risk"],
              live_weather["visibility_risk"],
              live_weather["wind_risk"],
              live_weather["temp_risk"],
          )
          is_night = 0 if live_weather["is_day"] else 1
          is_winter_storm = False  # unused once e_index_override is set
          e_source = "live_weather"
      else:
          e_index_override = None
          is_night = 1 if hour < 6 or hour >= 20 else 0
          is_winter_storm = weather in ("blizzard", "ice_storm")
          e_source = "calendar_fallback"

      v_vision = VISION_BY_PRESET.get(weather, 0.15)

      fused = fuse_scenario(
          t_nlp=t_nlp,
          v_vision=v_vision,
          month_num=month,
          season_num=self._season(month),
          is_night=is_night,
          is_winter_storm=is_winter_storm,
          e_index_override=e_index_override,
      )

      # Small route-specific adjustments (demo: alternate paths differ slightly)
      duration_min = duration_s / 60.0
      distance_km = distance_m / 1000.0
      route_adj = route_index * 2.5  # 2nd/3rd alternates often longer/slower
      night_adj = 4.0 if is_night else 0.0
      length_adj = min(6.0, distance_km * 0.02)

      s_raw = fused["S"] + route_adj + night_adj + length_adj
      s_raw = min(100.0, max(0.0, s_raw))
      advisory = build_operational_advisory(s_raw)

      collision_risk = self._tabular_collision_risk(hour, month, is_night, is_rush)

      return {
          "safety_score": round(s_raw, 1),
          "tier": advisory["tier"],
          "tier_color": advisory["tier_color"],
          "operational_guidance": advisory["operational_guidance"],
          "operational_message": advisory["operational_message"],
          "guidance_steps": advisory["guidance_steps"],
          "recommended_speed_kmh": advisory["recommended_speed_kmh"],
          "naive_recommended_speed_kmh": advisory["naive_recommended_speed_kmh"],
          "relative_speed_reduction_kmh": advisory["relative_speed_reduction_kmh"],
          "relative_speed_text": advisory["relative_speed_text"],
          "prevailing_traffic_kmh_assumed": advisory["prevailing_traffic_kmh_assumed"],
          "distance_km": round(distance_km, 1),
          "duration_min": round(duration_min, 0),
          "duration_text": _fmt_duration(duration_min),
          "T_nlp": fused["T_nlp"],
          "V_vision": fused["V_vision"],
          "E_index": fused["E_index"],
          "collision_risk_index": round(collision_risk, 3) if collision_risk is not None else None,
          "collision_risk_calibrated": False,
          "weather_preset": weather,
          "alert_preview": alert[:120] + ("..." if len(alert) > 120 else ""),
          "alert_source": alert_source,
          "e_index_source": e_source,
          "live_weather_raw": {
              k: v for k, v in live_weather.items() if k.startswith("raw_")
          } if live_weather else None,
      }


def _fmt_duration(minutes: float) -> str:
    m = int(round(minutes))
    if m < 60:
        return f"{m} min"
    h, rem = divmod(m, 60)
    return f"{h} hr {rem} min" if rem else f"{h} hr"


def score_routes_batch(
    routes: List[Dict],
    weather: str = "clear",
    custom_alert: str = "",
    force_preset: bool = False,
) -> List[Dict]:
    engine = SmartShieldEngine()
    out = []
    for i, r in enumerate(routes[:3]):
        scored = engine.score_route(
            distance_m=float(r.get("distance_m", 0)),
            duration_s=float(r.get("duration_s", 0)),
            weather=weather,
            custom_alert=custom_alert,
            hour=r.get("hour"),
            month=r.get("month"),
            route_index=i,
            lat=r.get("lat", r.get("mid_lat")),
            lon=r.get("lon", r.get("mid_lon")),
            force_preset=force_preset,
        )
        scored["route_index"] = i
        scored["summary"] = r.get("summary", f"Route {i + 1}")
        out.append(scored)
    out.sort(key=lambda x: x["safety_score"])
    for rank, item in enumerate(out, start=1):
        item["safety_rank"] = rank
    return out
