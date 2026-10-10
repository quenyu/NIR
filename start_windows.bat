@echo off
setlocal EnableExtensions
cd /d "%~dp0"
set "ROOT=%CD%"
set "PYTHON="
set "FOUND_PYTHON313_INCOMPATIBLE="

call :find_python
if defined PYTHON goto :python_ready

if defined FOUND_PYTHON313_INCOMPATIBLE (
    echo Python 3.13 was found, but its architecture is incompatible.
    echo This project requires x64 Python because NumPy and SciPy use x64 DLL files.
) else (
    echo 64-bit Python 3.13 is not installed.
)
echo The launcher can install the correct x64 version for the current user.
echo.
where winget >nul 2>nul
if errorlevel 1 goto :no_winget

choice /C YN /N /M "Install 64-bit Python 3.13 now? [Y/N]: "
if errorlevel 2 goto :cancelled

echo.
echo Installing 64-bit Python 3.13 with winget...
winget install --id Python.Python.3.13 -e --scope user --architecture x64 --force --accept-package-agreements --accept-source-agreements
if errorlevel 1 goto :install_failed

set "PYTHON="
call :find_python
if not defined PYTHON (
    echo.
    echo The x64 installation finished, but the launcher cannot find it yet.
    echo Close this window, then run start_windows.bat again.
    pause
    exit /b 1
)

:python_ready
set "RUNTIME_CACHE=%LocalAppData%\ControlLab\NIR\runtime-cp313-win-amd64-v3"
echo [1/4] Preparing a clean local runtime cache...
"%PYTHON%" "%ROOT%\tools\prepare_runtime.py" --source "%ROOT%\runtime_packages" --target "%RUNTIME_CACHE%"
if errorlevel 1 goto :runtime_prepare_failed

echo [2/4] Checking Python and bundled dependencies...
set "PYTHONPATH=%ROOT%\backend;%RUNTIME_CACHE%"
call :check_dependencies
if not errorlevel 1 goto :dependencies_ready

echo.
echo The cached runtime could not be loaded. Rebuilding it once...
"%PYTHON%" "%ROOT%\tools\prepare_runtime.py" --source "%ROOT%\runtime_packages" --target "%RUNTIME_CACHE%" --force
if errorlevel 1 goto :runtime_prepare_failed
call :check_dependencies
if errorlevel 1 goto :deps_failed

:dependencies_ready

echo [3/4] Starting backend...
start "NIR Backend" cmd /k call "%ROOT%\run_backend.bat" "%PYTHON%" "%RUNTIME_CACHE%"
timeout /t 3 /nobreak >nul

echo [4/4] Starting frontend...
start "NIR Frontend" cmd /k call "%ROOT%\run_frontend.bat" "%PYTHON%"
timeout /t 3 /nobreak >nul

start "" "http://127.0.0.1:5173"
echo.
echo Project started: http://127.0.0.1:5173
echo Keep the Backend and Frontend windows open while using the project.
exit /b 0

:find_python
if exist "%LocalAppData%\Programs\Python\Python313\python.exe" (
    call :try_python "%LocalAppData%\Programs\Python\Python313\python.exe"
    if defined PYTHON exit /b 0
)
if exist "%ProgramFiles%\Python313\python.exe" (
    call :try_python "%ProgramFiles%\Python313\python.exe"
    if defined PYTHON exit /b 0
)

for /f "usebackq delims=" %%P in (`py -3.13-64 -c "import sys; print(sys.executable)" 2^>nul`) do (
    call :try_python "%%P"
    if defined PYTHON exit /b 0
)
for /f "usebackq delims=" %%P in (`py -3.13 -c "import sys; print(sys.executable)" 2^>nul`) do (
    call :try_python "%%P"
    if defined PYTHON exit /b 0
)
for /f "usebackq delims=" %%P in (`where python 2^>nul`) do (
    call :try_python "%%P"
    if defined PYTHON exit /b 0
)
exit /b 0

:try_python
if not exist "%~1" exit /b 0
"%~1" -c "import sys; raise SystemExit(0 if sys.version_info[:2] == (3, 13) else 1)" >nul 2>nul
if errorlevel 1 exit /b 0
"%~1" -c "import platform, struct; raise SystemExit(0 if struct.calcsize('P') == 8 and platform.machine().lower() in ('amd64', 'x86_64') else 1)" >nul 2>nul
if errorlevel 1 (
    set "FOUND_PYTHON313_INCOMPATIBLE=1"
    exit /b 0
)
set "PYTHON=%~1"
exit /b 0

:check_dependencies
"%PYTHON%" -c "import platform, struct, sys; assert sys.version_info[:2] == (3, 13); assert struct.calcsize('P') == 8; assert platform.machine().lower() in ('amd64', 'x86_64'); import fastapi, uvicorn, numpy, scipy, pydantic; from scipy.signal import tf2ss; from scipy.spatial.transform import Rotation; from scipy.special import erf; a, b, c, d = tf2ss([1.0], [1.0, 1.0]); assert a.shape == (1, 1); assert Rotation.identity().as_quat().shape == (4,); print('Python', sys.version.split()[0], 'x64 - dependencies OK'); print('Runtime:', numpy.__file__)"
exit /b %errorlevel%

:no_winget
echo.
echo winget was not found. Install 64-bit Python 3.13 from python.org,
echo then run start_windows.bat again.
start "" "https://www.python.org/downloads/windows/"
pause
exit /b 1

:install_failed
echo.
echo Automatic Python installation failed.
echo Install 64-bit Python 3.13 manually and run this file again.
start "" "https://www.python.org/downloads/windows/"
pause
exit /b 1

:deps_failed
echo.
echo Bundled dependencies could not be loaded even from the clean local cache.
echo The launcher selected: %PYTHON%
echo Runtime cache: %RUNTIME_CACHE%
echo.
echo Collecting DLL diagnostics...
"%PYTHON%" "%ROOT%\tools\runtime_diagnostics.py" --runtime "%RUNTIME_CACHE%" --source "%ROOT%\runtime_packages"
echo.
echo Install or repair Microsoft Visual C++ Redistributable x64 from:
echo https://aka.ms/vc14/vc_redist.x64.exe
echo If this message persists, send the complete text from this window.
pause
exit /b 1

:runtime_prepare_failed
echo.
echo The local runtime cache could not be prepared.
echo Check that there is at least 250 MB of free space in: %LocalAppData%
echo If this message persists, send the complete text from this window.
pause
exit /b 1

:cancelled
echo Installation cancelled. Python 3.13 is required to run this package.
pause
exit /b 1
