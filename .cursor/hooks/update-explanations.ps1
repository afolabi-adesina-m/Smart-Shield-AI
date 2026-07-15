# Regenerate explanation docs when notebook or definitions.json is saved.
# Triggered by Cursor afterFileEdit hook (see ../hooks.json).

$ErrorActionPreference = "Stop"
$inputRaw = [Console]::In.ReadToEnd()
if (-not $inputRaw) { exit 0 }

try {
    $payload = $inputRaw | ConvertFrom-Json
} catch {
    exit 0
}

# Cursor may send file path under different keys depending on version
$path = $payload.file_path
if (-not $path) { $path = $payload.path }
if (-not $path) { $path = $payload.filePath }
if (-not $path) { exit 0 }

$normalized = ($path -replace '\\', '/').ToLower()
$shouldRebuild = $normalized -match 'notebooks/.*\.ipynb$' -or
                   $normalized -match 'explanations/definitions\.json$' -or
                   $normalized -match 'explanations/build_all\.py$'

if (-not $shouldRebuild) { exit 0 }

# Resolve project root (.cursor/hooks -> project root is two levels up)
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = (Resolve-Path (Join-Path $scriptDir "..\..")).Path

Set-Location $projectRoot
Write-Host "[hook] Rebuilding explanations after edit: $path"
python explanations/build_all.py --quiet
exit $LASTEXITCODE
