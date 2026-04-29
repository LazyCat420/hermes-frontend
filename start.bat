@echo off
echo Starting Hermes Frontend Proxy Server...

:: Check if venv exists
if not exist "venv\Scripts\activate.bat" (
    echo Virtual environment not found.
    pause
    exit /b 1
)

:: Run the proxy server
cmd /k "venv\Scripts\activate.bat && python proxy.py"
