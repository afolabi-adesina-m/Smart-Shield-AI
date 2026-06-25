"""Add importlib.reload for vision_brain in notebook cells."""
import json
from pathlib import Path

NB = Path(__file__).parent / "Captone - Draft.ipynb"
nb = json.load(open(NB, encoding="utf-8"))

RELOAD_BLOCK = """import importlib
import vision_brain
importlib.reload(vision_brain)
"""

for i, c in enumerate(nb["cells"]):
    src = "".join(c.get("source", []))
    if "from vision_brain import load_sample_images" in src and "importlib.reload" not in src:
        c["source"] = src.replace(
            "from vision_brain import load_sample_images, display_condition_samples, DISPLAY_ORDER",
            RELOAD_BLOCK + "from vision_brain import load_sample_images, display_condition_samples, DISPLAY_ORDER",
        )
        print(f"Patched cell {i} (6.1 samples)")
    if "from vision_brain import (" in src and "build_training_dataset" in src and "importlib.reload" not in src:
        c["source"] = src.replace(
            "    import torch\n    from vision_brain import (",
            "    import torch\n    import importlib\n    import vision_brain\n    importlib.reload(vision_brain)\n    from vision_brain import (",
        )
        print(f"Patched cell {i} (6.2 fine-tune)")

json.dump(nb, open(NB, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
print("DONE")
