# GitHub Pages — Smart-Shield site

This folder powers the project site when Pages is enabled on
[`Smart-Shield-AI`](https://github.com/afolabi-adesina-m/Smart-Shield-AI).

## Enable (one-time)

1. Open the repo on GitHub → **Settings** → **Pages**
2. **Source:** Deploy from a branch
3. **Branch:** `main` (or your default) → folder **`/docs`**
4. Save. Site URL will be:

   `https://afolabi-adesina-m.github.io/Smart-Shield-AI/`

5. Optional: set that URL as the repository **Homepage** (About → gear icon).

## Files

| Path | Role |
|------|------|
| `index.html` | Landing page + interactive Safety Score |
| `css/site.css` | Styles |
| `js/site.js` | Score calculator |

Static only — the Flask map demo still runs locally from `demo/`.

## Local preview

Open `docs/index.html` in a browser, or from the repo root:

```bash
python -m http.server 8080 --directory docs
# http://127.0.0.1:8080/
```
