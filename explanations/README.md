# Explanations

Auto-generated documentation for the Smart-Shield capstone.  
**Last built:** 2026-07-02 05:23 UTC  
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

1. **Notebook Run All completes** — last cell runs `scripts/post_notebook_run.py` (sync outputs, annotations, docs)
2. **Cursor hook** — saving `notebooks/*.ipynb` or `explanations/definitions.json` (`.cursor/hooks.json`)
3. **Git pre-commit** — run `git config core.hooksPath .githooks` once, then each commit rebuilds docs
4. **Manual** — double-click `explanations/update.bat` or run `python explanations/build_all.py`
5. **Headless pipeline** — `run_notebook.bat` or `python scripts/run_notebook_pipeline.py`
6. **Watch mode** — `python explanations/build_all.py --watch` (polls every 30s)

## Customize content

Edit `definitions.json` then run `build_all.py`. Add glossary terms, lane steps, or change split constants (`tabular_test_size`, etc.).

## Files built this run

- `Glossary.docx`
- `Sprint-Pipeline-Swimlane.docx`
- `Sprint-Pipeline-Swimlane.mmd`
- `Train-Test-Validation-Splits.docx`
- `README.md`
- `MANIFEST.json`
