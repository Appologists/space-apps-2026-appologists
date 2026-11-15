# Lunar Site Planner: set up (first time) and start. Run from this folder:
#   powershell -ExecutionPolicy Bypass -File .\start.ps1
$ErrorActionPreference = 'Continue'
Set-Location $PSScriptRoot
$port = 8002

function Stop-WithMessage($text) {
    Write-Host $text -ForegroundColor Red
    exit 1
}

# 1. Stop any older copy of the server still holding the port (it would keep showing the old pages).
#    One that Windows cannot see (inside WSL or Docker) is left alone; the server then picks another port.
$old = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
foreach ($c in $old) {
    $p = Get-CimInstance Win32_Process -Filter "ProcessId=$($c.OwningProcess)" -ErrorAction SilentlyContinue
    Write-Host "Stopping an older server on port ${port}: $($p.CommandLine)" -ForegroundColor Yellow
    Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue
}
if ($old) {
    Start-Sleep -Seconds 1
}

# 2. Python environment and packages.
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

# 3. Keys file and data (first time only).
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
if (!(Test-Path '..\data\raw\lola-south-80s-80m\ldem_80s_80m.img')) {
    Write-Host 'Downloading the NASA LOLA 80 m south-pole grid once (115 MB), for the landing-site finder...'
    & $py fetch_data.py lola-south-80s-80m
    if ($LASTEXITCODE -ne 0) {
        Write-Host 'That download failed. The app still runs on the 1.9 km whole-Moon data.' -ForegroundColor Yellow
    }
}

# 4. Start, then check that THIS copy is the one answering. The server picks a free port itself
#    (8002, or 8765 and up if an older server still answers on 8002) and writes it to .port.
Remove-Item '.port' -ErrorAction SilentlyContinue
$server = Start-Process -FilePath $py -ArgumentList 'lunar_server.py' -NoNewWindow -PassThru
$health = $null
for ($i = 0; $i -lt 40 -and -not $health; $i++) {
    Start-Sleep -Milliseconds 500
    if ($server.HasExited) {
        Stop-WithMessage 'The server stopped while starting. Read the messages above.'
    }
    if (Test-Path '.port') {
        $port = [int](Get-Content '.port')
        try {
            $health = Invoke-RestMethod "http://127.0.0.1:$port/api/health" -TimeoutSec 2
        } catch {
            $health = $null
        }
        if ($health -and $health.folder -ne $PSScriptRoot) {
            $health = $null
        }
    }
}
if (-not $health) {
    Stop-WithMessage 'The server did not answer. Read the messages above.'
}
Write-Host ''
Write-Host "Running version $($health.version)" -ForegroundColor Green
Write-Host "  http://127.0.0.1:$port/classic   our planner (street view, south pole, compare...)"
Write-Host "  http://127.0.0.1:$port/learn     education section"
Write-Host "  http://127.0.0.1:$port/          the team app (needs the team's src/ from main)"
Write-Host 'Keep this window open while you use the app. Press Ctrl+C to stop.'
Start-Process "http://127.0.0.1:$port/classic"
Wait-Process -Id $server.Id
