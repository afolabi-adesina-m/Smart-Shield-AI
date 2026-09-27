"""Public inventory of Enterprise engine files.

This list is not the scoring logic. It tells the protection tool and the
runtime loader which paths are the engine. The academic snapshot on
``capstone-submitted`` does not use this file.
"""

from __future__ import annotations

ENGINE_SOURCES = (
    "src/safety_score.py",
    "src/nlp_brain.py",
    "src/vision_brain.py",
    "demo/inference.py",
    "demo/vision_runtime.py",
    "demo/speed_limit.py",
    "demo/road_rules.py",
    "demo/street_rules.json",
)

# Trained weights and the small vision label file. Most weights are already
# gitignored; vision_meta.json is tracked until you remove it from the index.
MODEL_GLOBS = (
    "models/*.joblib",
    "models/*.pt",
    "models/*.pth",
    "models/*.pkl",
    "models/vision_meta.json",
)

KEY_FILENAMES = (
    ".smart_shield_key",
    "smart_shield.key",
)

LOCKED_MESSAGE = "Engine locked. Set SMART_SHIELD_KEY to unlock scoring."
