# Keeps this computer up to date with GitHub: every minute it pulls the team's newest main.
# Open pages (/, /classic, /learn) see the new commit and reload themselves (public/live-sync.js).
# start.ps1 runs this for you. To run it alone:  powershell -ExecutionPolicy Bypass -File .\sync.ps1
# It never merges or overwrites your own changes: if a pull cannot fast-forward, it says so and waits.
param([int]$Seconds = 60)
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo
Write-Host "Sync: pulling origin/main into $repo every $Seconds s. Close this window to stop."
while ($true) {
    $before = (git rev-parse HEAD 2>$null)
    git pull --ff-only --quiet origin main 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "$(Get-Date -Format HH:mm) Sync: could not fast-forward (you may have local changes). Nothing was changed." -ForegroundColor Yellow
    } else {
        $after = (git rev-parse HEAD 2>$null)
        if ($after -ne $before) {
            Write-Host "$(Get-Date -Format HH:mm) Sync: updated to $($after.Substring(0, 7)). Open pages reload by themselves." -ForegroundColor Green
        }
    }
    Start-Sleep -Seconds $Seconds
}
