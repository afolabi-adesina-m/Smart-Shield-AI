# Protecting the Enterprise engine

Smart-Shield AI Enterprise can keep the scoring engine encrypted **at rest in git**. The submitted academic capstone is a different snapshot and stays readable:

- branch `capstone-submitted`
- tag `v1.0-capstone-submitted`
- commit `754ef29a315a1a5c984632311fe6f7abe33a33a4` (27 August 2026, "Brighten Pages site v2")

Do not encrypt that branch, do not move that tag, and do not rewrite history on it. Teammates use that snapshot.

This repository's current `master` still contains the plaintext engine, on purpose, so the demo and the tests keep working. You generate the key and run encryption on your own computer. This change does not include a key and does not include ciphertext of the real engine.

## What encryption does, and what it does not do

The scheme is AES-256-GCM from the `cryptography` library. Each file is bound to its path. The key is 32 random bytes, encoded as url-safe base64.

Encryption protects those files **in future commits**, as long as the key is not in the repo. It does not hide them from someone who can run the server. The process decrypts the files into a temporary directory so Python can import them. Anyone with `SMART_SHIELD_KEY`, or with access to the running machine, can read the engine.

Old commits on `master` still contain the plaintext engine. This change does not rewrite history. Removing that history is a separate decision. If you choose it later, a tool such as `git filter-repo` can drop the engine paths from every commit, and then every teammate and every deploy must re-clone. Do that only if you intend to. Leave `capstone-submitted` and `v1.0-capstone-submitted` untouched either way.

The notebooks under `notebooks/` still describe training and fusion in plaintext. So do the unit tests, which check specific scores. Encrypting the runtime engine does not make those documents secret.

## What is encrypted

The tool encrypts the engine sources when they are on disk, plus any model artifacts that match the patterns below.

| Path | Why it is part of the engine |
| --- | --- |
| `src/safety_score.py` | Fusion weights, risk tiers, recommended speed |
| `src/nlp_brain.py` | Alert text scoring |
| `src/vision_brain.py` | Vision model definition and training helpers |
| `demo/inference.py` | Model loading and route scoring |
| `demo/vision_runtime.py` | ResNet loading and frame scoring |
| `demo/speed_limit.py` | Posted-limit defaults and safe-speed rule |
| `demo/road_rules.py` | Street and exit rules |
| `demo/street_rules.json` | Street, exit, and trip-score thresholds |
| `models/*.joblib`, `models/*.pt`, `models/*.pth`, `models/*.pkl` | Trained weights |
| `models/vision_meta.json` | Vision label config |

These stay readable: the Flask routes, the map UI, address search, and the live 511 / weather fetchers (`src/Live_*.py`). They are the public shell. They call the engine. They do not contain the fusion weights.

## Commands you run

Install the demo dependencies (this adds the `cryptography` package):

```bash
pip install -r demo/requirements-demo.txt
```

Generate a key. The command only prints it. Copy it into a password manager. Do not commit it.

```bash
python tools/protect.py keygen
```

Put the key in the environment for the rest of these commands:

```bash
export SMART_SHIELD_KEY='paste-the-key-here'
```

You can instead store it in a gitignored file (the tool will read it when the env var is unset):

```bash
python tools/protect.py keygen --out .smart_shield_key
```

Encrypt. This writes `protected/**/*.enc` and `protected/manifest.json`. It leaves the plaintext files on disk.

```bash
python tools/protect.py encrypt
```

Stop git from tracking the plaintext. The files can remain on your machine for local work. `.gitignore` already ignores them, so they will not be added again by a normal `git add`.

```bash
git rm --cached \
  src/safety_score.py \
  src/nlp_brain.py \
  src/vision_brain.py \
  demo/inference.py \
  demo/vision_runtime.py \
  demo/speed_limit.py \
  demo/road_rules.py \
  demo/street_rules.json \
  models/vision_meta.json
```

`models/*.joblib` and `models/*.pt` are already gitignored. `encrypt` still wraps any copies that are on your disk, and those `.enc` files are what you commit.

Commit the ciphertext and the manifest. Do not commit `.smart_shield_key`.

```bash
git add protected PROTECTING_IP.md .gitignore
git status
git commit -m "Encrypt the Enterprise engine at rest"
```

`git status` must not list the key. If it lists plaintext engine files as new, do not add them.

Optional pre-commit check. After the manifest exists, the hook refuses a commit that stages the key or the plaintext engine.

```bash
git config core.hooksPath .githooks
```

Back up the key outside the repo and outside the Render service. If you lose it, the ciphertext in git cannot be decrypted. There is no recovery path in this tool.

## Render

The live demo is the Docker web service in `render.yaml`.

1. Push the commit that contains `protected/` and no longer tracks the plaintext engine.
2. In the Render dashboard, set `SMART_SHIELD_KEY` to the same key. `render.yaml` marks that variable as a secret (`sync: false`). Do not paste the key into the yaml file.
3. Redeploy.

If the key is missing, the process still starts. The log line says the engine is locked, `/api/health` reports `"engine": {"mode": "locked", ...}`, and scoring returns a clear locked message instead of a model score. Speed limits fall back to an estimate. That is not a safety score.

To confirm a deploy that still has the plaintext engine, `/api/health` reports `"mode": "plaintext"`. You do not need the key until the plaintext files are gone from the image.

Decrypt a working copy locally with:

```bash
export SMART_SHIELD_KEY='paste-the-key-here'
python tools/protect.py decrypt
```

Run the tests with the key set after the plaintext has been removed from disk. While the plaintext files are still present, the tests import them directly and the key is unused:

```bash
python3 -m unittest demo.test_speed_limit demo.test_road_rules demo.test_address_search demo.test_engine_lock
```
