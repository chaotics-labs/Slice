"""
config.py — Constants and shared configuration for Chaotics Slice.
"""
import sys
from pathlib import Path

# ── Base directories ──────────────────────────────────────────────────────────
if getattr(sys, "frozen", False):
    BUNDLE_DIR = Path(sys._MEIPASS)
    DATA_DIR   = Path(sys.executable).parent
else:
    BUNDLE_DIR = Path(__file__).parent
    DATA_DIR   = Path(__file__).parent

OUTPUT_FOLDER = DATA_DIR / "outputs"
TEMP_FOLDER   = DATA_DIR / "temp"

OUTPUT_FOLDER.mkdir(exist_ok=True)
TEMP_FOLDER.mkdir(exist_ok=True)

# ── File handling ─────────────────────────────────────────────────────────────
ALLOWED_EXTENSIONS = {".mp4", ".mkv", ".mov", ".avi", ".webm", ".m4v", ".flv"}
MAX_UPLOAD_SIZE    = 8 * 1024 * 1024 * 1024  # 8 GB

# ── VAD mode presets ──────────────────────────────────────────────────────────
# Used by parse_params to map mode → silence/padding defaults
MODE_PRESETS = {
    "chill":  {"padding": 350, "min_silence": 600},
    "normal": {"padding": 200, "min_silence": 300},
    "tight":  {"padding": 80,  "min_silence": 150},
    "savage": {"padding": 30,  "min_silence": 80},
}

# Default threshold + min_speech per mode (used to detect "custom" params)
MODE_DEFAULTS = {
    "chill":  {"threshold": 0.4, "min_speech_ms": 400},
    "normal": {"threshold": 0.5, "min_speech_ms": 250},
    "tight":  {"threshold": 0.6, "min_speech_ms": 150},
    "savage": {"threshold": 0.7, "min_speech_ms": 80},
}
