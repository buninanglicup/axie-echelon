# ------------------------------------------------------------
# Start all Axie Tracker instances in one Windows Terminal window
# Simplified version: one script per tracker, then launch them as tabs
# ------------------------------------------------------------

Write-Host "Stopping all tracker processes..." -ForegroundColor Red
Stop-Process -Name node -Force -ErrorAction SilentlyContinue
Write-Host "All tracker processes stopped." -ForegroundColor Green
Write-Host ""

$project = Split-Path -Parent $MyInvocation.MyCommand.Path

if (-not (Get-Command wt.exe -ErrorAction SilentlyContinue)) {
    Write-Host "Windows Terminal (wt) is not installed or not on PATH." -ForegroundColor Yellow
    Write-Host "Falling back to 5 separate PowerShell windows." -ForegroundColor Yellow

    foreach ($script in @(
        "$project\start-tracker1.ps1",
        "$project\start-tracker2.ps1",
        "$project\start-tracker3.ps1",
        "$project\start-tracker4.ps1",
        "$project\start-tracker5.ps1"
    )) {
        Start-Process powershell -NoExit -File $script
    }

    Write-Host "Started tracker instances in separate windows." -ForegroundColor Green
    return
}

& wt.exe `
  new-tab --title "Tracker 1" -d "$project" powershell -NoExit -File "$project\start-tracker1.ps1" `; `
  new-tab --title "Tracker 2" -d "$project" powershell -NoExit -File "$project\start-tracker2.ps1" `; `
  new-tab --title "Tracker 3" -d "$project" powershell -NoExit -File "$project\start-tracker3.ps1" `; `
  new-tab --title "Tracker 4" -d "$project" powershell -NoExit -File "$project\start-tracker4.ps1" `; `
  new-tab --title "Tracker 5" -d "$project" powershell -NoExit -File "$project\start-tracker5.ps1"

Write-Host ""
Write-Host "Started tracker instances in 5 Windows Terminal tabs." -ForegroundColor Green
Write-Host ""