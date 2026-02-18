#!/usr/bin/env python3
"""
Chaotics Slice — Flask Web App
"""

import uuid
import json
import threading
import subprocess
from pathlib import Path
from flask import Flask, render_template, request, jsonify, send_file, Response, after_this_request
import queue
import sys
import platform
import webbrowser
from threading import Timer

# ─── Base directory for PyInstaller or normal run ─────────────────────────────
if getattr(sys, "frozen", False):
    BASE_DIR = Path(sys._MEIPASS)
else:
    BASE_DIR = Path(__file__).parent

app = Flask(
    __name__,
    template_folder=str(BASE_DIR / "static"),
    static_folder=str(BASE_DIR / "static"),
)
app.config["MAX_CONTENT_LENGTH"] = 4 * 1024 * 1024 * 1024  # 4 GB

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

# ─── Device detection ─────────────────────────────────────────────────────────
import torch

if torch.cuda.is_available():
    DEVICE = "cuda"
elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
    DEVICE = "mps"
else:
    DEVICE = "cpu"

print(f"[Chaotics Slice] torch={torch.__version__}  device={DEVICE}")


# ─── Helpers ──────────────────────────────────────────────────────────────────

def get_duration(path: str) -> float:
    cmd = ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "json", path]
    result = subprocess.run(cmd, capture_output=True, text=True)
    return float(json.loads(result.stdout)["format"]["duration"])


def extract_audio_to(video_path: str, audio_path: str):
    """Extract mono 16 kHz WAV via FFmpeg. No torchaudio I/O used."""
    cmd = [
        "ffmpeg", "-y", "-i", video_path,
        "-ac", "1", "-ar", "16000", "-vn", "-f", "wav", audio_path,
        "-loglevel", "error",
    ]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"FFmpeg audio extract failed: {r.stderr}")


def load_audio_tensor(audio_path: str) -> "torch.Tensor":
    """
    Load the FFmpeg-produced 16 kHz mono WAV using stdlib `wave`.

    torchaudio >= 2.9 dropped its old file-I/O backends and now requires
    torchcodec, which most users don't have.  We side-step this entirely:
    FFmpeg already wrote a plain 16-bit PCM WAV for us, so we read it with
    the stdlib `wave` module — zero extra dependencies.
    """
    import wave, array
    with wave.open(audio_path, "rb") as wf:
        sampwidth = wf.getsampwidth()
        n_channels = wf.getnchannels()
        raw = wf.readframes(wf.getnframes())

    if sampwidth == 2:
        samples = array.array("h", raw)
        wav = torch.tensor(samples, dtype=torch.float32) / 32768.0
    elif sampwidth == 4:
        samples = array.array("i", raw)
        wav = torch.tensor(samples, dtype=torch.float32) / 2147483648.0
    else:
        raise RuntimeError(f"Unsupported WAV sample width: {sampwidth} bytes")

    if n_channels > 1:
        wav = wav[::n_channels]  # safety: keep first channel

    return wav


_vad_model = None
_vad_utils = None
_vad_lock  = threading.Lock()


def get_vad():
    global _vad_model, _vad_utils
    with _vad_lock:
        if _vad_model is None:
            print("[Chaotics Slice] Loading Silero VAD model…")
            _vad_model, _vad_utils = torch.hub.load(
                repo_or_dir="snakers4/silero-vad",
                model="silero_vad",
                force_reload=False,
                onnx=False,
                verbose=False,
                trust_repo=True,
            )
            _vad_model.to(DEVICE)
            print(f"[Chaotics Slice] VAD model ready on {DEVICE}.")
    return _vad_model, _vad_utils


def run_vad_on_audio(
    audio_path: str,
    threshold: float,
    min_speech_ms: int,
    min_silence_ms: int,
    padding_ms: int,
):
    model, utils = get_vad()
    get_speech_ts = utils[0]   # avoid unpacking read_audio — it's broken in torchaudio>=2.9

    wav = load_audio_tensor(audio_path)
    if DEVICE != "cpu":
        wav = wav.to(DEVICE)

    timestamps = get_speech_ts(
        wav, model,
        sampling_rate=16000,
        threshold=threshold,
        min_speech_duration_ms=min_speech_ms,
        min_silence_duration_ms=min_silence_ms,
        speech_pad_ms=padding_ms,
        return_seconds=True,
    )
    return [(t["start"], t["end"]) for t in timestamps]


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


def purge_uploads():
    for sess in file_sessions.values():
        for key in ("video_path", "audio_path"):
            p = Path(sess.get(key, ""))
            if p.exists():
                try: p.unlink()
                except OSError: pass
    file_sessions.clear()
    for f in UPLOAD_FOLDER.iterdir():
        if f.is_file():
            try: f.unlink()
            except OSError: pass


def purge_output(output_path: Path):
    try:
        if output_path.exists():
            output_path.unlink()
    except OSError:
        pass


# ─── Background render worker ─────────────────────────────────────────────────

def process_job(job_id: str, file_id: str, params: dict):
    try:
        sess       = file_sessions[file_id]
        video_path = sess["video_path"]
        audio_path = sess["audio_path"]
        duration   = sess["duration"]

        update_job(job_id, status="running", progress=10)
        push_log(job_id,
            f"VAD — threshold={params['threshold']}  "
            f"padding={params['padding_ms']}ms  "
            f"min-silence={params['min_silence_ms']}ms"
        )

        segments = run_vad_on_audio(audio_path, **params)
        if not segments:
            raise RuntimeError("No speech detected. Try lowering threshold or switching to Chill mode.")

        kept = sum(e - s for s, e in segments)
        push_log(job_id, f"{len(segments)} segments · {kept:.1f}s speech detected", "success")
        update_job(job_id, progress=45)

        suffix          = Path(video_path).suffix
        output_filename = f"{job_id}_sliced{suffix}"
        output_path     = OUTPUT_FOLDER / output_filename
        push_log(job_id, f"Rendering {len(segments)} segment(s)…")

        filter_parts = []
        for i, (s, e) in enumerate(segments):
            filter_parts.append(
                f"[0:v]trim=start={s:.4f}:end={e:.4f},setpts=PTS-STARTPTS[v{i}];"
                f"[0:a]atrim=start={s:.4f}:end={e:.4f},asetpts=PTS-STARTPTS[a{i}]"
            )
        n              = len(segments)
        interleaved    = "".join(f"[v{i}][a{i}]" for i in range(n))
        filter_complex = ";".join(filter_parts) + f";{interleaved}concat=n={n}:v=1:a=1[outv][outa]"

        cmd = [
            "ffmpeg", "-y", "-i", video_path,
            "-filter_complex", filter_complex,
            "-map", "[outv]", "-map", "[outa]",
            "-c:v", "libx264", "-preset", "fast", "-crf", "18",
            "-c:a", "aac", "-b:a", "192k",
            str(output_path), "-loglevel", "error",
        ]

        update_job(job_id, progress=50)
        r = subprocess.run(cmd, capture_output=True, text=True)
        if r.returncode != 0:
            raise RuntimeError(f"FFmpeg render failed: {r.stderr[:400]}")

        stats = compute_stats(segments, duration)
        push_log(job_id, f"{stats['pct_removed']}% removed · {stats['removed']}s cut", "success")
        update_job(job_id, status="done", progress=100, output_filename=output_filename, stats=stats)

    except Exception as e:
        push_log(job_id, f"Error: {e}", "error")
        update_job(job_id, status="error", error=str(e))
    finally:
        if job_id in job_logs:
            job_logs[job_id].put(None)


# ─── Routes ───────────────────────────────────────────────────────────────────

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/upload", methods=["POST"])
def api_upload():
    if "video" not in request.files:
        return jsonify({"error": "No video attached"}), 400
    f      = request.files["video"]
    suffix = Path(f.filename).suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS:
        return jsonify({"error": f"Unsupported format: {suffix}"}), 400
    purge_uploads()
    file_id    = str(uuid.uuid4())[:8]
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
        "duration":   duration,
        "filename":   f.filename,
    }
    return jsonify({"file_id": file_id, "duration": round(duration, 2), "filename": f.filename})


@app.route("/api/preview", methods=["POST"])
def api_preview():
    body    = request.get_json(force=True)
    file_id = body.get("file_id")
    if not file_id or file_id not in file_sessions:
        return jsonify({"error": "Unknown file_id"}), 404
    sess = file_sessions[file_id]
    try:
        p        = parse_params(body)
        segments = run_vad_on_audio(sess["audio_path"], **p)
        stats    = compute_stats(segments, sess["duration"])
        return jsonify({"ok": True, "stats": stats})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/process", methods=["POST"])
def api_process():
    body    = request.get_json(force=True)
    file_id = body.get("file_id")
    if not file_id or file_id not in file_sessions:
        return jsonify({"error": "Unknown file_id"}), 404
    params = parse_params(body)
    job_id = str(uuid.uuid4())[:8]
    jobs[job_id]     = {"status": "queued", "progress": 0}
    job_logs[job_id] = queue.Queue()
    t = threading.Thread(target=process_job, args=(job_id, file_id, params), daemon=True)
    t.start()
    return jsonify({"job_id": job_id})


@app.route("/api/status/<job_id>")
def api_status(job_id: str):
    job = jobs.get(job_id)
    if not job:
        return jsonify({"error": "Unknown job"}), 404
    return jsonify(job)


@app.route("/api/logs/<job_id>")
def api_logs(job_id: str):
    if job_id not in job_logs:
        return jsonify({"error": "Unknown job"}), 404
    def generate():
        q = job_logs[job_id]
        while True:
            try:
                item = q.get(timeout=30)
                if item is None:
                    yield 'data: {"done":true}\n\n'
                    break
                yield f"data: {json.dumps(item)}\n\n"
            except queue.Empty:
                yield ": heartbeat\n\n"
    return Response(generate(), mimetype="text/event-stream",
                    headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.route("/api/download/<job_id>")
def api_download(job_id: str):
    job = jobs.get(job_id)
    if not job or job.get("status") != "done":
        return jsonify({"error": "Not ready"}), 404
    output_path = OUTPUT_FOLDER / job["output_filename"]
    if not output_path.exists():
        return jsonify({"error": "File missing"}), 404
    download_name = job["output_filename"].replace(job_id + "_", "")
    @after_this_request
    def cleanup(response):
        purge_output(output_path)
        jobs.pop(job_id, None)
        job_logs.pop(job_id, None)
        return response
    return send_file(str(output_path), as_attachment=True, download_name=download_name)


# ─── Run ──────────────────────────────────────────────────────────────────────

def open_browser():
    if platform.system() in ("Windows", "Darwin"):
        webbrowser.open("http://127.0.0.1:5000")
    else:
        print("  Open http://127.0.0.1:5000 in your browser")


if __name__ == "__main__":
    print()
    print(f"  Chaotics Slice  ✂   http://127.0.0.1:5000   [{DEVICE.upper()}]")
    print()
    Timer(1.5, open_browser).start()
    from waitress import serve
    serve(app, host="127.0.0.1", port=5000)