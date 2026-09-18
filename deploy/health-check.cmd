@echo off
setlocal
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0health-check.ps1" %*
set "EXIT_CODE=%ERRORLEVEL%"
echo.
echo Health-check exit code: %EXIT_CODE%
exit /b %EXIT_CODE%
