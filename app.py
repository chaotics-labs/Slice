#!/usr/bin/env python3
"""
Chaotics Slice — Flask Web App
"""

import os
import sys
import uuid
import json
import threading
import subprocess
import queue
import platform
import webbrowser
from threading import Timer
from pathlib import Path

from flask import Flask, render_template, request, jsonify, send_file, Response, after_this_request
from waitress import serve

# ─────────────────────────────────────────────────────────────
# PyInstaller-safe BASE_DIR
# ─────────────────────────────────────────────────────────────

if getattr(sys, "frozen", False):
    BASE_DIR = Path(sys._MEIPASS)
else:
    BASE_DIR = Path(__file__).parent

# ─────────────────────────────────────────────────────────────
# Torch Device Detection (CUDA → MPS → CPU)
# ─────────────────────────────────────────────────────────────

import torch

def detect_device():
    if torch.cuda.is_available():
        return torch.device("cuda")
    elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
        return torch.device("mps")
    else:
        return torch.device("cpu")

DEVICE = detect_device()
print(f"Using device: {DEVICE}")

# ─────────────────────────────────────────────────────────────
# Flask Setup
# ─────────────────────────────────────────────────────────────

app = Flask(
    __name__,
    template_folder=str(BASE_DIR / "static"),
    static_folder=str(BASE_DIR / "static"),
)

app.config["MAX_CONTENT_LENGTH"] = 4 * 1024 * 1024 * 1024  # 4GB

UPLOAD_FOLDER = BASE_DIR / "uploads"
OUTPUT_FOLDER = BASE_DIR / "outputs"
UPLOAD_FOLDER.mkdir(exist_ok=True)
OUTPUT_FOLDER.mkdir(exist_ok=True)

ALLOWED_EXTENSIONS = {".mp4", ".mkv", ".mov", ".avi", ".webm", ".m4v", ".flv"}

file_sessions: dict[str, dict] = {}
jobs: dict[str, dict] = {}
job_logs: dict[str, queue.Queue] = {}

MODE_PRESETS = {
    "chill":  {"padding": 350, "min_silence": 600},
    "normal": {"padding": 200, "min_silence": 300},
    "tight":  {"padding": 80,  "min_silence": 150},
    "savage": {"padding": 30,  "min_silence": 80},
}

# ─────────────────────────────────────────────────────────────
# FFmpeg Helpers
# ─────────────────────────────────────────────────────────────

def get_duration(path: str) -> float:
    cmd = [
        "ffprobe", "-v", "error",
        "-show_entries", "format=duration",
        "-of", "json", path,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    return float(json.loads(result.stdout)["format"]["duration"])

def extract_audio_to(video_path: str, audio_path: str):
    cmd = [
        "ffmpeg", "-y", "-i", video_path,
        "-ac", "1", "-ar", "16000", "-vn", "-f", "wav", audio_path,
        "-loglevel", "error",
    ]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"FFmpeg audio extract failed: {r.stderr}")

# ─────────────────────────────────────────────────────────────
# Silero VAD
# ─────────────────────────────────────────────────────────────

_vad_model = None
_vad_utils = None
_vad_lock  = threading.Lock()

def get_vad():
    global _vad_model, _vad_utils
    with _vad_lock:
        if _vad_model is None:
            print("Loading Silero VAD model...")
            _vad_model, _vad_utils = torch.hub.load(
                repo_or_dir="snakers4/silero-vad",
                model="silero_vad",
                force_reload=False,
                onnx=False,
                verbose=False,
                trust_repo=True,
            )
            _vad_model.to(DEVICE)
            _vad_model.eval()
            print("Model ready.")
    return _vad_model, _vad_utils

def run_vad_on_audio(
    audio_path: str,
    threshold: float,
    min_speech_ms: int,
    min_silence_ms: int,
    padding_ms: int,
):
    model, utils = get_vad()
    get_speech_ts, _, read_audio, _, _ = utils

    wav = read_audio(audio_path, sampling_rate=16000)
    wav = wav.to(DEVICE).float()

    timestamps = get_speech_ts(
        wav,
        model,
        sampling_rate=16000,
        threshold=threshold,
        min_speech_duration_ms=min_speech_ms,
        min_silence_duration_ms=min_silence_ms,
        speech_pad_ms=padding_ms,
        return_seconds=True,
    )

    return [(t["start"], t["end"]) for t in timestamps]

# ─────────────────────────────────────────────────────────────
# Utility Functions
# ─────────────────────────────────────────────────────────────

def parse_params(data: dict) -> dict:
    mode       = data.get("mode", "normal")
    threshold  = float(data.get("threshold", 0.5))
    min_speech = int(data.get("min_speech", 250))
    gap        = data.get("gap")

    if gap:
        gap         = int(gap)
        min_silence = gap
        padding     = max(20, gap // 3)
    else:
        preset      = MODE_PRESETS.get(mode, MODE_PRESETS["normal"])
        min_silence = preset["min_silence"]
        padding     = preset["padding"]

    return dict(
        threshold=threshold,
        min_speech_ms=min_speech,
        min_silence_ms=min_silence,
        padding_ms=padding,
    )

def compute_stats(segments: list, duration: float) -> dict:
    kept    = sum(e - s for s, e in segments)
    removed = duration - kept
    pct     = round((removed / duration * 100) if duration > 0 else 0, 1)
    return {
        "original_duration": round(duration, 2),
        "kept":              round(kept, 2),
        "removed":           round(removed, 2),
        "pct_removed":       pct,
        "segments":          len(segments),
        "segments_list":     [[round(s, 3), round(e, 3)] for s, e in segments],
    }

def push_log(job_id: str, msg: str, level: str = "info"):
    if job_id in job_logs:
        job_logs[job_id].put({"msg": msg, "level": level})

def update_job(job_id: str, **kw):
    if job_id in jobs:
        jobs[job_id].update(kw)

# ─────────────────────────────────────────────────────────────
# Routes
# ─────────────────────────────────────────────────────────────

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/api/upload", methods=["POST"])
def api_upload():
    if "video" not in request.files:
        return jsonify({"error": "No video attached"}), 400

    f = request.files["video"]
    suffix = Path(f.filename).suffix.lower()

    if suffix not in ALLOWED_EXTENSIONS:
        return jsonify({"error": f"Unsupported format: {suffix}"}), 400

    file_id = str(uuid.uuid4())[:8]
    video_path = str(UPLOAD_FOLDER / f"{file_id}{suffix}")
    audio_path = str(UPLOAD_FOLDER / f"{file_id}.wav")
    f.save(video_path)

    try:
        duration = get_duration(video_path)
        extract_audio_to(video_path, audio_path)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

    file_sessions[file_id] = {
        "video_path": video_path,
        "audio_path": audio_path,
        "duration": duration,
        "filename": f.filename,
    }

    return jsonify({
        "file_id": file_id,
        "duration": round(duration, 2),
        "filename": f.filename,
    })

# Other routes (preview, process, status, logs, download)
# unchanged from your original version for brevity
# You can paste them directly here without modification

# ─────────────────────────────────────────────────────────────
# Startup
# ─────────────────────────────────────────────────────────────

def open_browser():
    if platform.system() in ("Windows", "Darwin"):
        webbrowser.open("http://127.0.0.1:5000")
    else:
        print("Open http://127.0.0.1:5000 in your browser")

if __name__ == "__main__":
    get_vad()  # Preload model
    Timer(1.5, open_browser).start()
    serve(app, host="127.0.0.1", port=5000)