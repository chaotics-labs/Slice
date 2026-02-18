#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Chaotics Slice — local build script (macOS & Linux)
#
# Usage:
#   chmod +x build.sh
#   ./build.sh
#
# Output:
#   dist/ChaoticSlice          (Linux single binary)
#   dist/ChaoticSlice.app      (macOS app bundle)
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

VENV=".venv-build"
DIST="dist"

echo ""
echo "╔══════════════════════════════╗"
echo "║   Chaotics Slice — Build     ║"
echo "╚══════════════════════════════╝"
echo ""

# ── 1. Python version check ───────────────────────────────────────────────────
PYTHON=$(command -v python3.11 || command -v python3.10 || command -v python3 || true)
if [ -z "$PYTHON" ]; then
  echo "❌  Python 3.10+ not found. Install it first."
  exit 1
fi
PY_VER=$("$PYTHON" -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
echo "✔  Python $PY_VER  →  $PYTHON"

# ── 2. FFmpeg check ───────────────────────────────────────────────────────────
if ! command -v ffmpeg &>/dev/null; then
  echo "❌  FFmpeg not found on PATH."
  echo "    macOS:  brew install ffmpeg"
  echo "    Ubuntu: sudo apt install ffmpeg"
  exit 1
fi
echo "✔  FFmpeg $(ffmpeg -version 2>&1 | head -1 | awk '{print $3}')"

# ── 3. Virtual environment ────────────────────────────────────────────────────
echo ""
echo "→  Setting up build venv ($VENV)…"
"$PYTHON" -m venv "$VENV"
source "$VENV/bin/activate"
pip install --upgrade pip --quiet

# ── 4. Install runtime deps ───────────────────────────────────────────────────
echo "→  Installing runtime dependencies…"

# Detect platform for torch index URL
PLATFORM=$(uname -s)
if [ "$PLATFORM" = "Darwin" ]; then
  # macOS — one wheel works for both CPU and MPS
  pip install torch torchvision torchaudio --quiet
else
  # Linux — default to CPU build (GitHub Actions uses CPU runners)
  # For local CUDA builds, replace with:
  #   pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121
  pip install torch torchvision torchaudio \
    --index-url https://download.pytorch.org/whl/cpu --quiet
fi

pip install flask waitress pyinstaller --quiet

# ── 5. Clean previous build ───────────────────────────────────────────────────
echo "→  Cleaning previous build…"
rm -rf build/ dist/ __pycache__/

# ── 6. PyInstaller ────────────────────────────────────────────────────────────
echo "→  Running PyInstaller…"
pyinstaller chaotics_slice.spec --noconfirm

# ── 7. Result ─────────────────────────────────────────────────────────────────
echo ""
if [ "$PLATFORM" = "Darwin" ]; then
  ARTIFACT="$DIST/ChaoticSlice.app"
else
  ARTIFACT="$DIST/ChaoticSlice"
fi

if [ -e "$ARTIFACT" ]; then
  SIZE=$(du -sh "$ARTIFACT" | cut -f1)
  echo "╔══════════════════════════════════════╗"
  echo "║  ✅  Build complete!                 ║"
  echo "╚══════════════════════════════════════╝"
  echo ""
  echo "  Output : $ARTIFACT"
  echo "  Size   : $SIZE"
  echo ""
  if [ "$PLATFORM" = "Darwin" ]; then
    echo "  Run it : open $ARTIFACT"
    echo "  Or     : $DIST/ChaoticSlice.app/Contents/MacOS/ChaoticSlice"
  else
    echo "  Run it : ./$ARTIFACT"
  fi
else
  echo "❌  Build failed — artifact not found at $ARTIFACT"
  exit 1
fi

deactivate
