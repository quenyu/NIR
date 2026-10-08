@echo off
setlocal
title NIR Backend
set "ROOT=%~dp0"
set "PYTHON=%~1"
set "RUNTIME=%~2"
if not defined RUNTIME set "RUNTIME=%ROOT%runtime_packages"
set "PYTHONPATH=%ROOT%backend;%RUNTIME%"
cd /d "%ROOT%backend"
echo Backend is running at http://127.0.0.1:8000
echo Do not close this window while using the project.
echo.
"%PYTHON%" -m uvicorn app.main:app --host 127.0.0.1 --port 8000
echo.
echo Backend stopped.
pause
