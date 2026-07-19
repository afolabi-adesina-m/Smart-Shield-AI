@echo off
REM Execute capstone notebook, save outputs, sync to capstone_with_results, rebuild docs
cd /d "%~dp0"
python scripts\run_notebook_pipeline.py %*
if errorlevel 1 (
  echo Pipeline failed.
  exit /b 1
)
echo Done. Open notebooks\capstone_with_results.ipynb for annotated results.
pause
