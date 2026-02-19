"""
ffmpeg.py — FFmpeg/FFprobe binary resolution and media helpers.
"""
import os
import sys
import json
import time
import subprocess
from pathlib import Path


def find_binary(name: str) -> str:
    """Locate an ffmpeg/ffprobe binary: bundled → local → PATH."""
    suffix = ".exe" if sys.platform == "win32" else ""
    if getattr(sys, "frozen", False):
        candidate = os.path.join(sys._MEIPASS, name + suffix)
        if os.path.isfile(candidate):
            return candidate
    local = os.path.join(os.path.dirname(os.path.abspath(__file__)), name + suffix)
    if os.path.isfile(local):
        return local
    import shutil
    found = shutil.which(name)
    if found:
        return found
    raise FileNotFoundError(
        f"{name} not found. Place {name}{suffix} next to app.py or add to PATH."
    )


FFMPEG  = find_binary("ffmpeg")
FFPROBE = find_binary("ffprobe")


def get_duration(path: str) -> float:
    """Return video duration in seconds via ffprobe."""
    cmd = [FFPROBE, "-v", "error", "-show_entries", "format=duration", "-of", "json", path]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"ffprobe failed: {result.stderr}")
    return float(json.loads(result.stdout)["format"]["duration"])


def extract_audio(video_path: str, audio_path: str) -> None:
    """Extract mono 16 kHz WAV from a video file."""
    cmd = [
        FFMPEG, "-y", "-i", video_path,
        "-ac", "1", "-ar", "16000", "-vn", "-f", "wav", audio_path,
        "-loglevel", "error",
    ]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"FFmpeg audio extract failed: {r.stderr}")


def probe_streams(path: str) -> dict:
    """Return raw ffprobe stream/format JSON for diagnostics."""
    cmd = [FFPROBE, "-v", "error", "-show_entries", "stream=codec_type,duration",
           "-of", "json", path]
    r = subprocess.run(cmd, capture_output=True, text=True)
    return json.loads(r.stdout) if r.returncode == 0 else {}
