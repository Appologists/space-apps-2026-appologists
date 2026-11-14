# Lunar Site Planner: set up (first time) and start. Run from this folder:
#   powershell -ExecutionPolicy Bypass -File .\start.ps1
$ErrorActionPreference = 'Continue'
Set-Location $PSScriptRoot

function Stop-WithMessage($text) {
    Write-Host $text -ForegroundColor Red
    exit 1
}

if (!(Test-Path '.venv\Scripts\python.exe')) {
    Write-Host 'Creating Python environment (.venv)...'
    if (Get-Command py -ErrorAction SilentlyContinue) {
        py -3 -m venv .venv
    } elseif (Get-Command python -ErrorAction SilentlyContinue) {
        python -m venv .venv
    } else {
        Stop-WithMessage 'Python 3.10 or newer is needed. Install it from https://www.python.org/downloads/ and run this again.'
    }
}
$py = Join-Path $PSScriptRoot '.venv\Scripts\python.exe'
if (!(Test-Path $py)) {
    Stop-WithMessage 'Could not make the Python environment (.venv).'
}

Write-Host 'Installing packages...'
& $py -m pip install --quiet --disable-pip-version-check -r requirements.txt
if ($LASTEXITCODE -ne 0) {
    Stop-WithMessage 'pip install failed. Check the internet connection and run this again.'
}

if (!(Test-Path 'lunar_keys.json')) {
    Copy-Item 'lunar_keys.example.json' 'lunar_keys.json'
    Write-Host 'Made lunar_keys.json. Add your Cesium ion token and Google Maps key there (optional).'
}

if (!(Test-Path 'data\ldem_16.npy')) {
    Write-Host 'Downloading NASA LOLA terrain once (66 MB)...'
    & $py build_terrain.py
    if ($LASTEXITCODE -ne 0) {
        Write-Host 'Terrain download failed. The app still runs, on a smooth Moon.' -ForegroundColor Yellow
    }
}

Write-Host 'Starting at http://127.0.0.1:8002  (press Ctrl+C to stop)'
Start-Process 'http://127.0.0.1:8002'
& $py lunar_server.py
