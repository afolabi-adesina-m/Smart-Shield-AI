"""
Insert a Colab-compatible environment detection cell at position 0
(before everything else). It:
  - Detects whether running on Colab, Kaggle, or local machine
  - Mounts Google Drive on Colab automatically
  - Installs missing packages (lightgbm, imbalanced-learn, torch)
  - Sets DATA path correctly for each environment
  - Prints a clear environment summary so the user knows what's running
"""
import json, os

NB_PATH = os.path.join(os.path.dirname(__file__), "Captone - Draft.ipynb")
with open(NB_PATH, encoding="utf-8") as f:
    nb = json.load(f)

COLAB_MD = """\
---

## Environment Setup Cell
> **Run this cell FIRST** on any platform — local, Google Colab, or Kaggle.
> It auto-detects the environment, mounts storage, installs packages, and sets the `DATA` path.
> All other cells work unchanged after this runs.
"""

COLAB_CODE = '''\
# ── ENVIRONMENT SETUP  (run first on any platform) ───────────────────────────
# Detects: Local PC | Google Colab | Kaggle
# Handles: package installs, Google Drive mount, DATA path

import os, sys
from pathlib import Path

# ── 1. Detect environment ─────────────────────────────────────────────────────
IN_COLAB  = "google.colab" in sys.modules or os.path.exists("/content")
IN_KAGGLE = os.environ.get("KAGGLE_KERNEL_RUN_TYPE") is not None
IN_LOCAL  = not IN_COLAB and not IN_KAGGLE

env_name = "Google Colab" if IN_COLAB else ("Kaggle" if IN_KAGGLE else "Local Machine")
print(f"Environment detected : {env_name}")

# ── 2. GPU check ──────────────────────────────────────────────────────────────
try:
    import torch
    gpu = torch.cuda.get_device_name(0) if torch.cuda.is_available() else "None (CPU only)"
    print(f"GPU available        : {gpu}")
except Exception:
    print("GPU check            : torch not yet installed")

# ── 3. Install missing packages ───────────────────────────────────────────────
pkgs_needed = []
try:
    import lightgbm
except ImportError:
    pkgs_needed.append("lightgbm")
try:
    import imblearn
except ImportError:
    pkgs_needed.append("imbalanced-learn")
try:
    import torch
    _ = torch.__version__
    _ = torch.zeros(1)
except Exception:
    if IN_COLAB or IN_KAGGLE:
        pkgs_needed.append("torch --index-url https://download.pytorch.org/whl/cu121")
    else:
        pkgs_needed.append("torch --index-url https://download.pytorch.org/whl/cpu")

if pkgs_needed:
    print(f"Installing           : {pkgs_needed}")
    for pkg in pkgs_needed:
        os.system(f"pip install -q {pkg}")
    print("Packages installed. If torch was installed, restart the kernel once.")
else:
    print("Packages             : all present")

# ── 4. Mount storage & set DATA path ─────────────────────────────────────────
if IN_COLAB:
    from google.colab import drive
    if not os.path.exists("/content/drive/MyDrive"):
        print("Mounting Google Drive...")
        drive.mount("/content/drive")
    # ------------------------------------------------------------------ #
    # EDIT THIS PATH to match where your Data/ folder is in Google Drive  #
    DRIVE_DATA = Path("/content/drive/MyDrive/SmartShield/Data")          #
    # ------------------------------------------------------------------ #
    if DRIVE_DATA.exists():
        DATA = DRIVE_DATA
    else:
        # Fallback: look for uploaded Data/ in /content
        DATA = Path("/content/Data") if Path("/content/Data").exists() else DRIVE_DATA
        if not DATA.exists():
            print(f"WARNING: Data folder not found at {DATA}")
            print("  Upload your Data/ folder to Colab or update DRIVE_DATA path above.")

elif IN_KAGGLE:
    # Kaggle: add your dataset as input, it appears at /kaggle/input/<dataset-name>/
    _kag_candidates = list(Path("/kaggle/input").glob("*/Data"))
    DATA = _kag_candidates[0] if _kag_candidates else Path("/kaggle/input")
    print(f"Kaggle input path    : {DATA}")

else:  # Local
    _nb_dir     = Path(os.path.abspath(""))
    _candidates = [_nb_dir / "Data", _nb_dir.parent / "Data"]
    DATA        = next((p for p in _candidates if p.is_dir()), _nb_dir / "Data")

DATA_DIR = str(DATA)

# ── 5. Summary ────────────────────────────────────────────────────────────────
print(f"DATA path            : {DATA}")
print(f"Data folder exists   : {DATA.is_dir()}")
if DATA.is_dir():
    csvs = [f.name for f in DATA.glob("*.csv")][:6]
    print(f"CSVs found           : {csvs}")

# Re-import torch after potential install so rest of notebook picks it up
try:
    import torch, torch.nn as nn, torch.optim as optim
    from torch.utils.data import DataLoader, TensorDataset
    _ver  = torch.__version__
    _t    = torch.zeros(2)
    _lin  = nn.Linear(2,2)
    _opt  = optim.Adam(_lin.parameters(), lr=1e-3, weight_decay=1e-4)
    del _t, _lin, _opt
    TORCH_OK = True
    device   = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"PyTorch              : {_ver}  |  device={device}")
except Exception as _e:
    TORCH_OK = False
    torch = nn = optim = DataLoader = TensorDataset = None
    device = None
    print(f"PyTorch              : unavailable ({_e})")

print("\\nSetup complete. You can now run all remaining cells.")
'''

# Build the two new cells
md_cell = {
    "cell_type": "markdown",
    "id": "colab_env_md",
    "metadata": {},
    "source": COLAB_MD
}
code_cell = {
    "cell_type": "code",
    "execution_count": None,
    "id": "colab_env_code",
    "metadata": {},
    "outputs": [],
    "source": COLAB_CODE
}

# Insert at position 0 (very top of notebook)
nb["cells"].insert(0, code_cell)
nb["cells"].insert(0, md_cell)

# Also patch Cell 3 (now Cell 5 after insertion) to SKIP re-defining DATA/TORCH_OK
# if they were already set by the setup cell above.
# We find the main imports cell and add a guard at the top.
for i, cell in enumerate(nb["cells"]):
    src = "".join(cell.get("source", ""))
    if cell["cell_type"] == "code" and "CELL 3" in src and "import pandas" in src:
        guard = (
            "# Skip DATA/TORCH redefinition if already set by the environment setup cell above\n"
            "_already_setup = 'DATA' in dir() and 'TORCH_OK' in dir()\n\n"
        )
        cell["source"] = guard + src
        print(f"Cell {i}: Added setup-guard to main imports cell")
        break

with open(NB_PATH, "w", encoding="utf-8") as f:
    json.dump(nb, f, indent=1, ensure_ascii=False)

print(f"DONE — notebook now has {len(nb['cells'])} cells")
print("Colab/Kaggle/Local environment cell inserted at position 0")
'''
EDIT the DRIVE_DATA path in the code cell to match your Google Drive folder structure
before running on Colab.
'''
print("\nNEXT STEP: Edit DRIVE_DATA path in the setup cell to your Google Drive location.")
