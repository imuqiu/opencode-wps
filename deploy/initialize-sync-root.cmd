@echo off
setlocal
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0initialize-sync-root.ps1" %*
exit /b %ERRORLEVEL%
