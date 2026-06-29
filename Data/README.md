# Data folder

Place road casualty CSV files here before running `notebooks/capstone.ipynb`.

> **After the June 2026 reorg:** CSVs used to live in `Python Notebooks & Scripts/Data/`.
> They now belong in this folder (`Data/` at the project root, next to `vision_cache/`).
> The notebook also searches that legacy path and any subfolder containing the marker files below.
> Override manually: `set SMART_SHIELD_DATA=C:\path\to\your\csv\folder` (Windows) before opening Jupyter.

## Required files (UK DfT + local collision data)

- `dft-road-casualty-statistics-casualty-1979-latest-published-year.csv`
- `dft-road-casualty-statistics-casualty-2024.csv`
- `dft-road-casualty-statistics-collision-1979-latest-published-year.csv`
- `dft-road-casualty-statistics-collision-2024.csv`
- `dft-road-casualty-statistics-vehicle-1979-latest-published-year.csv`
- `dft-road-casualty-statistics-vehicle-2024.csv`
- `SDOT_Collisions_All_Years_1_-4387931914794038510.csv` (optional)
- `traffic collision data.csv` (optional)

Large CSV/XLSX files are **gitignored**. Download from your course data share or [data.gov.uk](https://www.data.gov.uk/).

## Vision cache

`vision_cache/` holds sample road-condition images for the Vision Brain pillar (tracked in git).
