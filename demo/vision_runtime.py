"""Load the notebook ResNet18 and score a road frame for the Maps demo.

Real mode (credibility):
  V = P(Wet/Slush) + P(Snow/Ice) from models/vision_resnet18.pt

Frame priority:
  1. Live Ontario 511 CCTV still nearest the route midpoint (when lat/lon given)
  2. Weather-matched photo from Data/vision_cache/
  3. Caller falls back to VISION_BY_PRESET proxy
"""

from __future__ import annotations

import json
import random
import sys
from io import BytesIO
from pathlib import Path
from typing import Any, Dict, List, Optional

_ROOT = Path(__file__).resolve().parent.parent
_MODELS = _ROOT / "models"
_CACHE = _ROOT / "Data" / "vision_cache"
_SRC = _ROOT / "src"

if str(_SRC) not in sys.path:
    sys.path.insert(0, str(_SRC))

DISPLAY_ORDER = ["Clear Asphalt", "Wet / Slush", "Snow / Ice"]
HAZARD_CLASSES = ("Wet / Slush", "Snow / Ice")

CACHE_FOLDERS = {
    "Clear Asphalt": [
        "clear",
        "dry_asphalt_smooth",
        "dry_asphalt_slight",
        "dry_concrete_smooth",
        "dry_gravel",
    ],
    "Wet / Slush": [
        "wet_asphalt_smooth",
        "wet_asphalt_slight",
        "water_asphalt_smooth",
        "wet_concrete_smooth",
        "melted_snow",
        "wet",
    ],
    "Snow / Ice": ["fresh_snow", "ice", "snow"],
}

PRESET_TO_CLASS = {
    "clear": "Clear Asphalt",
    "wet": "Wet / Slush",
    "blizzard": "Snow / Ice",
    "ice_storm": "Snow / Ice",
}


class VisionRuntime:
    """Lazy singleton: load ResNet once, score frames on demand."""

    def __init__(self) -> None:
        self.model = None
        self.device = None
        self.class_names: List[str] = list(DISPLAY_ORDER)
        self.ready = False
        self.load_error: Optional[str] = None
        self._tried = False

    def available(self) -> bool:
        self._ensure_loaded()
        return self.ready

    def warmup(self) -> bool:
        """Load weights onto GPU/CPU at server start."""
        return self.available()

    def status(self) -> Dict[str, Any]:
        self._ensure_loaded()
        weights = _MODELS / "vision_resnet18.pt"
        return {
            "ready": self.ready,
            "weights_present": weights.is_file(),
            "cache_present": _CACHE.is_dir(),
            "backend": "ResNet18" if self.ready else None,
            "load_error": self.load_error,
            "note": (
                "Real V prefers live Ontario 511 CCTV near the route, then "
                "falls back to a weather-matched vision_cache photo."
            ),
        }

    def _ensure_loaded(self) -> None:
        if self._tried:
            return
        self._tried = True
        weights = _MODELS / "vision_resnet18.pt"
        if not weights.is_file():
            self.load_error = f"Missing {weights}"
            return
        try:
            import torch
            import torch.nn as nn
            from torchvision import models

            meta_path = _MODELS / "vision_meta.json"
            if meta_path.is_file():
                meta = json.loads(meta_path.read_text(encoding="utf-8"))
                names = meta.get("class_names") or DISPLAY_ORDER
                if isinstance(names, list) and len(names) >= 3:
                    self.class_names = [str(n) for n in names[:3]]

            device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
            model = models.resnet18(weights=None)
            model.fc = nn.Linear(model.fc.in_features, len(self.class_names))
            try:
                state = torch.load(weights, map_location=device, weights_only=True)
            except TypeError:
                state = torch.load(weights, map_location=device)
            model.load_state_dict(state)
            model.to(device)
            model.eval()
            self.model = model
            self.device = device
            self.ready = True
        except Exception as exc:
            self.load_error = str(exc)

    def class_for_conditions(
        self,
        preset: str,
        surface_risk: Optional[float] = None,
    ) -> str:
        if surface_risk is not None:
            if surface_risk >= 0.75:
                return "Snow / Ice"
            if surface_risk >= 0.45:
                return "Wet / Slush"
            return "Clear Asphalt"
        return PRESET_TO_CLASS.get((preset or "clear").lower(), "Clear Asphalt")

    def _list_images(self, class_name: str) -> List[Path]:
        paths: List[Path] = []
        for folder in CACHE_FOLDERS.get(class_name, []):
            d = _CACHE / folder
            if not d.is_dir():
                continue
            for p in sorted(d.glob("*")):
                if p.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"}:
                    paths.append(p)
        return paths

    def pick_image(self, class_name: str, seed: int = 0) -> Optional[Path]:
        paths = self._list_images(class_name)
        if not paths:
            for alt in DISPLAY_ORDER:
                if alt == class_name:
                    continue
                paths = self._list_images(alt)
                if paths:
                    break
        if not paths:
            return None
        rng = random.Random(seed)
        return rng.choice(paths)

    def _score_pil(self, img) -> Optional[Dict[str, Any]]:
        self._ensure_loaded()
        if not self.ready or self.model is None:
            return None
        try:
            import torch
            import torch.nn.functional as F
            from torchvision import transforms

            tf = transforms.Compose(
                [
                    transforms.Resize((224, 224)),
                    transforms.ToTensor(),
                ]
            )
            x = tf(img.convert("RGB"))
            with torch.no_grad():
                logits = self.model(x.unsqueeze(0).to(self.device))
                probs = F.softmax(logits, dim=1).cpu().numpy()[0]

            per_class = {
                self.class_names[i]: round(float(probs[i]), 4)
                for i in range(len(self.class_names))
            }
            hazard = 0.0
            for name in HAZARD_CLASSES:
                if name in self.class_names:
                    hazard += float(probs[self.class_names.index(name)])
            pred_idx = int(probs.argmax())
            return {
                "V_vision": round(float(min(1.0, max(0.0, hazard))), 4),
                "pred_class": self.class_names[pred_idx],
                "class_probs": per_class,
                "backend": "ResNet18",
            }
        except Exception:
            return None

    def score_image(self, image_path: Path) -> Optional[Dict[str, Any]]:
        try:
            from PIL import Image

            img = Image.open(image_path)
            scored = self._score_pil(img)
            if not scored:
                return None
            scored["image_path"] = str(image_path)
            scored["image_name"] = image_path.name
            return scored
        except Exception:
            return None

    def score_bytes(
        self, image_bytes: bytes, name: str = "cctv.jpg"
    ) -> Optional[Dict[str, Any]]:
        try:
            from PIL import Image

            img = Image.open(BytesIO(image_bytes))
            scored = self._score_pil(img)
            if not scored:
                return None
            scored["image_name"] = name
            return scored
        except Exception:
            return None

    def score_live_cctv(
        self,
        lat: float,
        lon: float,
    ) -> Optional[Dict[str, Any]]:
        """Score nearest Ontario 511 CCTV still; None if feed/image unavailable."""
        try:
            from Live_cameras import fetch_nearby_still
        except Exception:
            return None

        still = fetch_nearby_still(lat, lon)
        if not still:
            return None
        label = still.get("roadway") or "cctv"
        name = f"511_{still.get('id')}_{label}.jpg".replace(" ", "_")
        scored = self.score_bytes(still["image_bytes"], name=name)
        if not scored:
            return None
        scored["vision_source"] = "resnet18_live_cctv"
        scored["vision_note"] = (
            "Trained ResNet18 on a live Ontario 511 CCTV still near the route midpoint."
        )
        scored["cctv_roadway"] = still.get("roadway")
        scored["cctv_location"] = still.get("location")
        scored["cctv_distance_km"] = still.get("distance_km")
        scored["cctv_image_url"] = still.get("image_url")
        scored["target_class"] = "live_cctv"
        return scored

    def score_for_route(
        self,
        *,
        preset: str,
        surface_risk: Optional[float] = None,
        seed: int = 0,
        lat: Optional[float] = None,
        lon: Optional[float] = None,
        prefer_cctv: bool = True,
    ) -> Optional[Dict[str, Any]]:
        if prefer_cctv and lat is not None and lon is not None:
            live = self.score_live_cctv(float(lat), float(lon))
            if live is not None:
                return live

        class_name = self.class_for_conditions(preset, surface_risk)
        path = self.pick_image(class_name, seed=seed)
        if path is None:
            return None
        scored = self.score_image(path)
        if not scored:
            return None
        scored["target_class"] = class_name
        scored["vision_source"] = "resnet18_cache"
        scored["vision_note"] = (
            "Trained ResNet18 on weather-matched road photo from vision_cache "
            "(live CCTV unavailable for this route)."
        )
        return scored


_RUNTIME: Optional[VisionRuntime] = None


def get_vision_runtime() -> VisionRuntime:
    global _RUNTIME
    if _RUNTIME is None:
        _RUNTIME = VisionRuntime()
    return _RUNTIME
