@echo off
setlocal
title NIR Frontend
set "ROOT=%~dp0"
set "PYTHON=%~1"
cd /d "%ROOT%"
echo Frontend is running at http://127.0.0.1:5173
echo Do not close this window while using the project.
echo.
"%PYTHON%" "%ROOT%tools\serve_frontend.py" --directory "%ROOT%frontend\dist" --port 5173
echo.
echo Frontend stopped.
pause
