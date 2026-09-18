@echo off
setlocal
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0repair.ps1" %*
exit /b %ERRORLEVEL%
