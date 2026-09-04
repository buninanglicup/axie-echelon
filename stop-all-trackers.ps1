# ------------------------------------------------------------
# Stop all Axie Tracker instances
# ------------------------------------------------------------
#
# This script stops every Node.js process on the computer. That will stop all
# running tracker instances, but it may also stop unrelated Node.js programs.
# Use it only when that broad cleanup is acceptable.

$ErrorActionPreference = "SilentlyContinue"

Write-Host "Stopping all tracker processes..." -ForegroundColor Red
Stop-Process -Name node -Force
Write-Host "All tracker processes stopped." -ForegroundColor Green
