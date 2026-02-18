@echo off
REM ─────────────────────────────────────────────────────────────────────────────
REM Chaotics Slice — local build script (Windows)
REM
REM Usage: double-click or run from a terminal:
REM   build.bat
REM
REM Output:
REM   dist\ChaoticSlice.exe
REM ─────────────────────────────────────────────────────────────────────────────

setlocal enabledelayedexpansion

echo.
echo  ╔══════════════════════════════╗
echo  ║   Chaotics Slice — Build     ║
echo  ╚══════════════════════════════╝
echo.

REM ── 1. Python check ──────────────────────────────────────────────────────────
where python >nul 2>&1
if errorlevel 1 (
    echo  ❌  Python not found on PATH.
    echo      Download from https://www.python.org/downloads/windows/
    echo      Make sure "Add Python to PATH" is checked during install.
    pause & exit /b 1
)
for /f "tokens=*" %%v in ('python --version 2^>^&1') do set PY_VER=%%v
echo  ✔  %PY_VER%

REM ── 2. FFmpeg check ──────────────────────────────────────────────────────────
where ffmpeg >nul 2>&1
if errorlevel 1 (
    echo  ❌  FFmpeg not found on PATH.
    echo      Download: https://www.gyan.dev/ffmpeg/builds/
    echo      Extract to C:\ffmpeg and add C:\ffmpeg\bin to System PATH.
    pause & exit /b 1
)
echo  ✔  FFmpeg found

REM ── 3. Virtual environment ────────────────────────────────────────────────────
echo.
echo  →  Setting up build venv (.venv-build)…
python -m venv .venv-build
call .venv-build\Scripts\activate.bat
python -m pip install --upgrade pip --quiet

REM ── 4. Install deps ───────────────────────────────────────────────────────────
echo  →  Installing runtime dependencies (CPU build)…
echo     For CUDA, edit this script and change the --index-url below.
echo.

REM CPU-only (safe default for distribution):
pip install torch torchvision torchaudio ^
    --index-url https://download.pytorch.org/whl/cpu --quiet

REM CUDA 12.1 — uncomment the lines below and comment out the CPU block above:
REM pip install torch torchvision torchaudio ^
REM     --index-url https://download.pytorch.org/whl/cu121 --quiet

pip install flask waitress pyinstaller --quiet

REM ── 5. Clean previous build ───────────────────────────────────────────────────
echo  →  Cleaning previous build…
if exist build\ rmdir /s /q build\
if exist dist\ rmdir /s /q dist\

REM ── 6. PyInstaller ────────────────────────────────────────────────────────────
echo  →  Running PyInstaller…
pyinstaller chaotics_slice.spec --noconfirm

REM ── 7. Result ─────────────────────────────────────────────────────────────────
echo.
if exist dist\ChaoticSlice.exe (
    echo  ╔══════════════════════════════════════╗
    echo  ║  ✅  Build complete!                 ║
    echo  ╚══════════════════════════════════════╝
    echo.
    echo   Output : dist\ChaoticSlice.exe
    echo   Run it : dist\ChaoticSlice.exe
) else (
    echo  ❌  Build failed — dist\ChaoticSlice.exe not found
    pause & exit /b 1
)

call .venv-build\Scripts\deactivate.bat
echo.
pause
