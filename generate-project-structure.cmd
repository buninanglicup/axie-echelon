@echo off
setlocal

cd /d "%~dp0"

echo Generating project structure...
echo.

node "%~dp0scripts\generate-project-structure.mjs"
if errorlevel 1 (
    echo.
    echo Project structure generation failed.
    pause
    exit /b 1
)

echo.
echo Project structure generation completed.
pause
exit /b 0
