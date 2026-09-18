@echo off
setlocal
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0bootstrap-dependencies.ps1" %*
exit /b %ERRORLEVEL%
