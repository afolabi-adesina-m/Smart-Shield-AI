"""Load capstone models and score highway routes for the Maps demo."""

from __future__ import annotations

import sys
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

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
from vision_runtime import get_vision_runtime

MODELS_DIR = _ROOT / "models"

# vision_mode:
#   real  — ResNet18 weights drive V (weather-matched cache photo)
#   proxy — hardcoded VISION_BY_PRESET (old demo behaviour)
#   auto  — real when weights load, else proxy
DEFAULT_VISION_MODE = "auto"

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
      self.stage_a = None
      self.vision = get_vision_runtime()
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

      sa_path = MODELS_DIR / "fatal_vs_not_stage_a.joblib"
      if sa_path.is_file():
          try:
              self.stage_a = joblib.load(sa_path)
          except Exception:
              self.stage_a = None

  def _season(self, month: int) -> int:
      if month in (12, 1, 2):
          return 1
      if month in (3, 4, 5):
          return 2
      if month in (6, 7, 8):
          return 3
      return 4

  def _feature_row(
      self, hour: int, month: int, is_night: int, is_rush: int
  ) -> Dict[str, float]:
      return {
          "OCC_HOUR": hour,
          "MONTH_NUM": month,
          "SEASON_NUM": self._season(month),
          "IS_NIGHT": is_night,
          "IS_RUSHHOUR": is_rush,
          "PEDESTRIAN_BIN": 0,
          "BICYCLE_BIN": 0,
          "AUTOMOBILE_BIN": 1,
      }

  def _tabular_collision_risk(
      self, hour: int, month: int, is_night: int, is_rush: int
  ) -> Optional[float]:
      """RF probability of Injury+Fatal (demo signal), if model loaded."""
      if self.rf is None or self.scaler is None or not self.feature_names:
          return None
      row = self._feature_row(hour, month, is_night, is_rush)
      x = np.array([[row.get(f, 0) for f in self.feature_names]], dtype=float)
      x_sc = self.scaler.transform(x)
      proba = self.rf.predict_proba(x_sc)[0]
      # classes 0=PD, 1=Injury, 2=Fatal — weight injury+fatal
      if len(proba) >= 3:
          return float(proba[1] + proba[2])
      return float(max(proba))

  def _stage_a_fatal_risk(
      self, hour: int, month: int, is_night: int, is_rush: int
  ) -> Optional[Dict[str, Any]]:
      """Stage A Fatal-vs-Not pilot — display signal, not fused into S."""
      if not isinstance(self.stage_a, dict):
          return None
      model = self.stage_a.get("model")
      scaler = self.stage_a.get("scaler")
      if model is None:
          return None
      row = self._feature_row(hour, month, is_night, is_rush)
      names = self.feature_names or list(row.keys())
      x = np.array([[row.get(f, 0) for f in names]], dtype=float)
      try:
          x_in = scaler.transform(x) if scaler is not None else x
          if hasattr(model, "predict_proba"):
              proba = model.predict_proba(x_in)[0]
              # binary: assume positive class is Fatal (index 1)
              p_fatal = float(proba[1] if len(proba) > 1 else proba[0])
          else:
              p_fatal = float(model.predict(x_in)[0])
          thr = float(self.stage_a.get("threshold") or 0.5)
          return {
              "p_fatal": round(p_fatal, 4),
              "flagged": bool(p_fatal >= thr),
              "threshold": thr,
              "model_name": self.stage_a.get("model_name"),
          }
      except Exception:
          return None

  def _resolve_vision(
      self,
      *,
      vision_mode: str,
      preset: str,
      live_weather: Optional[Dict[str, Any]],
      seed: int,
      lat: Optional[float] = None,
      lon: Optional[float] = None,
  ) -> Tuple[float, str, Optional[Dict[str, Any]]]:
      """Return (V, vision_source, vision_detail)."""
      mode = (vision_mode or DEFAULT_VISION_MODE).strip().lower()
      if mode not in {"auto", "real", "proxy"}:
          mode = "auto"

      want_real = mode == "real" or (
          mode == "auto" and self.vision.available()
      )
      if want_real:
          surface = None
          if live_weather is not None:
              surface = float(live_weather.get("surface_risk", 0.0))
          detail = self.vision.score_for_route(
              preset=preset,
              surface_risk=surface,
              seed=seed,
              lat=lat,
              lon=lon,
              prefer_cctv=True,
          )
          if detail is not None:
              src = detail.get("vision_source") or "resnet18_cache"
              return float(detail["V_vision"]), str(src), detail

      # Proxy fallback (explicit proxy mode, or real failed)
      return float(VISION_BY_PRESET.get(preset, 0.15)), "preset_proxy", None

  def score_route(
      self,
      *,
      distance_m: float,
      duration_s: float,
      weather: str = "auto",
      custom_alert: str = "",
      hour: Optional[int] = None,
      month: Optional[int] = None,
      route_index: int = 0,
      lat: Optional[float] = None,
      lon: Optional[float] = None,
      force_preset: bool = False,
      vision_mode: str = DEFAULT_VISION_MODE,
  ) -> Dict[str, Any]:
      """Fuse T+V+E into Safety Score S for one Directions API route leg.

      Dropdown rules (no separate Force checkbox):
        - weather='auto' → live Open-Meteo + nearby 511 when lat/lon exist
        - weather=clear|wet|blizzard|ice_storm → that demo preset only

      vision_mode:
        - real → ResNet18 drives V (live 511 CCTV when possible, else cache photo)
        - proxy → VISION_BY_PRESET
        - auto → real when model loads, else proxy

      Live sources fail independently and fall back to calendar / preset text
      so the demo never breaks offline.
      """
      now = datetime.now()
      hour = hour if hour is not None else now.hour
      month = month if month is not None else now.month
      is_rush = 1 if hour in (7, 8, 9, 16, 17, 18) else 0

      mode = (weather or "auto").strip().lower()
      if mode not in {"auto", "clear", "wet", "blizzard", "ice_storm"}:
          mode = "auto"
      # Selecting a named preset always uses that scenario; Auto uses live.
      use_live = (
          mode == "auto"
          and not force_preset
          and lat is not None
          and lon is not None
      )
      preset = "clear" if mode == "auto" else mode

      # --- Fix 2: prefer a real nearby 511 alert over the fixed preset text.
      live_alert = nearby_alert_text(lat, lon) if use_live else None
      if custom_alert.strip():
          alert = custom_alert.strip()
          alert_source = "custom"
      elif live_alert:
          alert = live_alert
          alert_source = "live_511"
      else:
          alert = WEATHER_PRESETS.get(preset, WEATHER_PRESETS["clear"])
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
          # Align vision proxy with live surface risk when Auto is selected.
          sr = float(live_weather.get("surface_risk", 0.0))
          if sr >= 0.75:
              preset = "blizzard"
          elif sr >= 0.45:
              preset = "wet"
          else:
              preset = "clear"
      else:
          e_index_override = None
          is_night = 1 if hour < 6 or hour >= 20 else 0
          is_winter_storm = preset in ("blizzard", "ice_storm")
          e_source = "calendar_fallback"

      seed = route_index * 1000
      if lat is not None and lon is not None:
          seed += int(abs(lat * 1000) + abs(lon * 1000)) % 10_000
      v_vision, vision_source, vision_detail = self._resolve_vision(
          vision_mode=vision_mode,
          preset=preset,
          live_weather=live_weather,
          seed=seed,
          lat=lat,
          lon=lon,
      )

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
      stage_a = self._stage_a_fatal_risk(hour, month, is_night, is_rush)

      out: Dict[str, Any] = {
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
          "stage_a_fatal": stage_a,
          "weather_preset": preset if mode == "auto" else mode,
          "alert_preview": alert[:120] + ("..." if len(alert) > 120 else ""),
          "alert_source": alert_source,
          "e_index_source": e_source,
          "vision_source": vision_source,
          "vision_mode_requested": (vision_mode or DEFAULT_VISION_MODE).strip().lower(),
          "live_weather_raw": {
              k: v for k, v in live_weather.items() if k.startswith("raw_")
          } if live_weather else None,
      }
      if vision_detail:
          out["vision_pred_class"] = vision_detail.get("pred_class")
          out["vision_target_class"] = vision_detail.get("target_class")
          out["vision_image"] = vision_detail.get("image_name")
          out["vision_class_probs"] = vision_detail.get("class_probs")
          out["vision_note"] = vision_detail.get("vision_note")
          if vision_detail.get("cctv_location"):
              out["cctv_location"] = vision_detail.get("cctv_location")
              out["cctv_roadway"] = vision_detail.get("cctv_roadway")
              out["cctv_distance_km"] = vision_detail.get("cctv_distance_km")
              out["cctv_image_url"] = vision_detail.get("cctv_image_url")
      elif vision_source == "preset_proxy":
          out["vision_note"] = (
              "V from scenario proxy table (VISION_BY_PRESET) — not ResNet."
          )
      return out


def _fmt_duration(minutes: float) -> str:
    m = int(round(minutes))
    if m < 60:
        return f"{m} min"
    h, rem = divmod(m, 60)
    return f"{h} hr {rem} min" if rem else f"{h} hr"


def score_routes_batch(
    routes: List[Dict],
    weather: str = "auto",
    custom_alert: str = "",
    force_preset: bool = False,
    vision_mode: str = DEFAULT_VISION_MODE,
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
            vision_mode=vision_mode,
        )
        scored["route_index"] = i
        scored["summary"] = r.get("summary", f"Route {i + 1}")
        out.append(scored)
    out.sort(key=lambda x: x["safety_score"])
    for rank, item in enumerate(out, start=1):
        item["safety_rank"] = rank
    return out
