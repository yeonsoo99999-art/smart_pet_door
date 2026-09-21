@echo off
rem Scratch-to-Open web view launcher.
rem Usage: run.bat [COM port]   (default COM3)
setlocal
cd /d "%~dp0"

set "PORT=%~1"
if "%PORT%"=="" set "PORT=COM3"

python -c "import flask, serial" 2>nul || python -m pip install -q -r webview\requirements.txt

start "" /b cmd /c "ping -n 4 127.0.0.1 >nul & start "" http://127.0.0.1:5000"
python webview\app.py --port %PORT% --host 0.0.0.0
