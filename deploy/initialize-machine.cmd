@echo off
setlocal
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0initialize-machine.ps1" %*
exit /b %ERRORLEVEL%
