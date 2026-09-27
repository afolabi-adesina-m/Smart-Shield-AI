# Smart-Shield AI - INFO53883 Capstone (Team 2B)

Multimodal highway safety scoring: **NLP alerts** + **vision road conditions** + **tabular collision risk** -> fused Smart-Shield score.

> **Full file-by-file guide:** see [`PROJECT_FILES.md`](PROJECT_FILES.md) for an explanation of every folder and file in this repository.

## Repository layout

```
notebooks/capstone.ipynb                # Main notebook (Colab / local / Kaggle)
notebooks/capstone_with_results.ipynb # Annotated copy with saved outputs + explanations
PROJECT_FILES.md                       # File-by-file guide (this repo)
src/                                    # nlp_brain, vision_brain, safety_score, cm_helpers
demo/                                   # Flask maps demo (api_server.py)
Data/                                   # CSV datasets (gitignored) + vision_cache/
models/                                 # Trained artifacts (see models/README.md)
docs/                                   # Proposals, design docs, literature
improvements/                           # Post-capstone audits & enhancement tracking
explanations/                           # Auto-generated glossary, swimlane, split docs
assets/                                 # Diagrams
archive/                                # Old notebooks + notebook build scripts
```

## Quick start (local)

```bash
pip install -r requirements.txt
pip install torch>=2.4 torchvision --index-url https://download.pytorch.org/whl/cpu
```

1. Copy casualty CSV files into `data/` (see `data/README.md`).
2. Open `notebooks/capstone.ipynb` and run the **Environment Setup** cell first.
3. Run all cells top-to-bottom (or use *Run All*).

**Auto-save & doc updates:** The last cell in each notebook runs `post_notebook_run.py` when execution finishes - syncing outputs, refreshing annotations, and rebuilding `explanations/`. Workspace auto-save is enabled (1.5s delay). For a fully headless run: `run_notebook.bat` or `python scripts/run_notebook_pipeline.py`.

**Collapsible sections:** Sections start collapsed (like hiding Excel rows). Click the **>** arrow beside a section heading to expand only that part. See the **Section Navigator** cell near the top of the notebook.

## Google Colab

1. Upload repo or mount Drive.
2. Set `DRIVE_DATA` in the setup cell to your `data/` folder path.
3. Run setup -> restart kernel if PyTorch was installed -> continue.

## Web demo

**Desktop** (sidebar + map):

```bash
cd demo
pip install -r requirements-demo.txt
python api_server.py
# http://127.0.0.1:5050
```

**Mobile** (portrait map + bottom sheet - iPhone & Android):

```bash
cd demo
python mobile_server.py
# http://127.0.0.1:5051
```

On a physical phone (same Wi-Fi as your PC), use the LAN URL printed by `mobile_server.py`, e.g. `http://192.168.x.x:5051`.

**Run both at once:** open two terminals, or double-click `demo/run_both.bat` (Windows).

| Demo | Port | Command |
|------|------|---------|
| Desktop | 5050 | `python api_server.py` |
| Mobile | 5051 | `python mobile_server.py` |

Both can run simultaneously - they use different ports and share the same scoring API logic.

The desktop server also serves the mobile layout at `/mobile` on the same port. That is the URL to use on a public host. `mobile_server.py` is only needed when you want a second local port for a phone on the same Wi-Fi.

Requires trained models in `../models/` for the tabular and ResNet brains. If those files are missing, route scoring still runs: NLP uses the in-repo TF-IDF fallback and vision uses the preset proxy. The speed panel does not need the model files.

## Map interface

The demo is a full-screen driving map. Search sits in a floating bar at the top. Directions and the model safety rating are floating cards on the map, and the speed readout is a driving HUD at the bottom: a round posted-limit sign, a large current-speed number, and a safe-speed chip. Day and night themes follow the device setting and can be toggled; the choice is saved in the browser. Light maps use CARTO Positron tiles and night maps use CARTO Dark Matter, both public styles that do not need an API key.

## Speed limit & safe speed

The HUD shows a round **limit** sign (posted speed), your **current speed**, and a **Safe** chip.

| Sign | Source |
|------|--------|
| Posted limit | OpenStreetMap `maxspeed` via the Overpass API (`GET /api/speed-limit`). The browser never calls Overpass directly. |
| Estimated limit | Used when the nearest road has no `maxspeed`. The sign is badged **EST** and the label says estimated. Defaults: motorway 100, trunk/primary 80, secondary 60, tertiary/unclassified 50, residential 40, living street 20, service 30, unknown 50 km/h. |
| Safe speed | Lower than or equal to the posted limit. The fusion model is not modified. |
| Your speed | Browser geolocation speed (`coords.speed`, m/s → km/h) when the device reports it. Otherwise **Demo speed**. |

**Safe speed rule** (interface only, `demo/speed_limit.py`):

1. If a route is scored, scale that route's existing `recommended_speed_kmh` from the model's 100 km/h highway assumption onto the real posted limit: `posted × recommended / 100`.
2. Otherwise use the same fractions `risk_tier()` already returns: LOW 100%, MEDIUM 80%, HIGH 60% of posted.
3. Before a route exists, the road-conditions preset maps onto those tiers: clear → LOW, wet → MEDIUM, blizzard and ice storm → HIGH. Auto with no score matches the posted limit.
4. The result is never above the posted limit. Motorways posted at 100 km/h or more keep the existing 80 km/h freeway floor.

**Warnings**

- Speed above the **posted** limit: the readout turns red, pulses, and the alert reads “Over the speed limit”.
- Speed above the **safe** speed but still at or under the posted limit: amber, “Above the safe speed”.
- At or under the safe speed: green, “Within the safe speed”.
- Colors ease between those states. Optional beep on the transition into amber or red (inside **Practice drive**).
- If the limit lookup fails, the sign shows an estimate and the note reads “Speed limit unavailable, showing estimate.”

**Demo on a laptop:** leave **Demo speed** checked. **Under safe**, **Above safe**, and **Over limit** set the slider. Above safe switches road conditions to Wet when the safe speed is not already below the posted limit. **Drive selected route** moves along the highlighted route. **Use GPS** needs a secure context (HTTPS, or localhost). A public deploy should be HTTPS; many laptops still report no speed, which is why the slider is there.

Click the map to read the limit at that point. Choosing a route snaps the reading to the route midpoint.

## Address search

The map has a search box, and the **From** and **To** fields use the same suggestions. After 3 characters, and a 300 ms pause, a dropdown lists matching places. Arrow keys move through it, Enter picks the highlighted row, and Escape closes it. On a phone, tap a row.

Picking a place moves the map there and loads the posted limit and safe speed for that point. The map search also has **Set as From** and **Set as To**, which fill the route fields. Picking a suggestion in From or To does that directly. **Find safest routes** then uses those coordinates.

The default provider is the public [Photon](https://photon.komoot.io/) service (Komoot), which is built for this kind of typeahead and does not need an API key. The browser talks only to this app. The server sends an identifying User-Agent, caches repeats for two minutes, and waits so Photon sees at most one request per second. Results are biased toward Ontario (Toronto) and Canadian matches are listed first; other countries can still appear. If Photon is down, one Nominatim search is used as a backup. Nominatim's public usage policy asks apps not to use it for autocomplete, so it is not the default.

To switch providers, set `GEOCODE_PROVIDER` in `demo/.env` to `photon`, `nominatim`, `google`, or `mapbox`. Google needs `GOOGLE_PLACES_API_KEY`. Mapbox needs `MAPBOX_ACCESS_TOKEN`. If that key is missing, suggestions stay on Photon. Google results are limited to Canada; Mapbox uses `country=ca` plus a proximity bias. Neither key is required for the demo.

## Live demo / deployment

**Best host for this stack: [Render](https://render.com) Docker web service.** The demo is one Flask process (Leaflet in the browser, scoring and Overpass on the server). It is not a static site and not a Streamlit app, so Vercel/Netlify static hosting and Streamlit Community Cloud do not fit without a rewrite. Render gives a public HTTPS URL, which is what browser geolocation requires, and `render.yaml` is already in the repo.

Railway (`railway.toml`) and any other Docker host use the same `Dockerfile`. Hugging Face Spaces can run that image too if the Space is Docker and `PORT` is `7860`.

Model files (`models/*.joblib`, `models/*.pt`) are gitignored and also excluded from the Docker build. GitHub blocks files over 100 MB; ResNet weights are usually under that but should move with **Git LFS** if you stop ignoring them. The public demo still scores routes without those files. To bake trained weights into an image, delete the `models/*.pt` and `models/*.joblib` lines from `.dockerignore` and build on a machine that has the files.

### Render (recommended)

1. Push this branch and open a pull request, or push to the default branch.
2. In Render: **New → Blueprint** (uses `render.yaml`) or **New → Web Service**, connect the GitHub repo, and set **Runtime** to **Docker**. Root directory stays the repo root (`Dockerfile` is there).
3. Leave the start command empty so the image `CMD` runs: `gunicorn` on `0.0.0.0:$PORT`.
4. Environment variables (optional; defaults are fine):
   - `SMART_SHIELD_CORS_ORIGINS` = `*`
   - `OVERPASS_URL` = `https://overpass.openstreetmap.fr/api/interpreter`
   - `OSRM_URL` = `https://router.project-osrm.org/route/v1/driving`
   - `NOMINATIM_URL` = `https://nominatim.openstreetmap.org/search`
5. Deploy. Open the `https://…onrender.com` URL for the desktop map, and add `/mobile` for the phone layout.
6. Health check: `GET /api/health`.

The free instance sleeps when idle; the first request after sleep can take a minute. Overpass and OSRM are public services and can rate-limit; the speed panel falls back to an estimated limit if they fail.

### Railway

1. **New project → Deploy from GitHub repo.** Railway reads `railway.toml` and builds the `Dockerfile`.
2. Railway sets `PORT`. Do not pin a port in the dashboard.
3. Open the generated HTTPS URL, and `/mobile` for the phone layout.

### Local check before you deploy

```bash
cd demo
pip install -r requirements-demo.txt
python api_server.py
```

Open the URL printed for that port, path `/` (desktop) or `/mobile`. Copy `demo/.env.example` to `demo/.env` only if you want to override ports or upstream URLs.

## Improvements & audit

Peer-review finding on speed advisories (ice-storm case study): see [`improvements/speed-advisory-audit/`](improvements/speed-advisory-audit/) (audit ID **SS-AUDIT-2026-001**).

## Future work, use cases & ERP integration

Route planning vision for individuals and businesses, plus ERP/TMS integration patterns: [`docs/ROUTE-PLANNING-USE-CASES-AND-ERP.md`](docs/ROUTE-PLANNING-USE-CASES-AND-ERP.md).

Final presentation slide outline (12-15 slides): [`docs/FINAL-PRESENTATION-SLIDE-OUTLINE.md`](docs/FINAL-PRESENTATION-SLIDE-OUTLINE.md).

## Explanation docs (auto-updated)

Glossary, sprint swimlane, and train/test split reference live in [`explanations/`](explanations/). They rebuild from `definitions.json` plus live notebook/data scans.

| Trigger | How |
|---------|-----|
| Edit notebook or `definitions.json` | Cursor hook (`.cursor/hooks.json`) |
| Git commit | Enable once: `git config core.hooksPath .githooks` |
| Manual | `python explanations/build_all.py` or double-click `explanations/update.bat` |
| Background | `python explanations/build_all.py --watch` |

Edit **`explanations/definitions.json`** to change glossary terms, pipeline steps, or split constants.

## Course

Sheridan College - INFO53883 AI & ML Capstone Project, Spring 2026.
