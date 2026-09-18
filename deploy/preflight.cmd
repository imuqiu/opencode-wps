@echo off
setlocal
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0preflight.ps1" %*
set "EXIT_CODE=%ERRORLEVEL%"
echo.
echo Preflight exit code: %EXIT_CODE%
exit /b %EXIT_CODE%
