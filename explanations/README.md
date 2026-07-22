# Explanations

Auto-generated documentation for the Smart-Shield capstone.  
**Last built:** 2026-07-22 15:31 UTC  
**Regenerate:** `python explanations/build_all.py`

## Outputs

| File | Description |
|------|-------------|
| `Glossary.docx` | Terms and definitions (from `definitions.json`) |
| `Sprint-Pipeline-Swimlane.docx` | Step-by-step sprint pipeline tables |
| `Sprint-Pipeline-Swimlane.mmd` | Mermaid swimlane (render at [mermaid.live](https://mermaid.live)) |
| `Train-Test-Validation-Splits.docx` | Train/test/CV split reference |
| `MANIFEST.json` | Build metadata and source timestamps |
| `definitions.json` | **Edit this** to change glossary, lanes, split constants |

## Automatic updates

Explanations rebuild automatically when:

1. **Cursor hook** — saving `notebooks/*.ipynb` or `explanations/definitions.json` (`.cursor/hooks.json`)
2. **Git pre-commit** — run `git config core.hooksPath .githooks` once, then each commit rebuilds docs
3. **Manual** — double-click `explanations/update.bat` or run `python explanations/build_all.py`
4. **Watch mode** — `python explanations/build_all.py --watch` (polls every 30s)

## Customize content

Edit `definitions.json` then run `build_all.py`. Add glossary terms, lane steps, or change split constants (`tabular_test_size`, etc.).

## Files built this run

- `Glossary.docx`
- `Sprint-Pipeline-Swimlane.docx`
- `Sprint-Pipeline-Swimlane.mmd`
- `Train-Test-Validation-Splits.docx`
- `README.md`
- `MANIFEST.json`
