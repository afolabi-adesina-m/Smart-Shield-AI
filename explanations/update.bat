@echo off
REM Regenerate all explanation Word docs, Mermaid, and README
cd /d "%~dp0.."
python explanations\build_all.py
if errorlevel 1 (
  echo Build failed.
  exit /b 1
)
echo Done. See explanations\ folder.
pause
