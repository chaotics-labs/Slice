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
from concurrent.futures import ThreadPoolExecutor, as_completed
import queue
import sys
import os
import platform
import webbrowser
import time

# ── FFmpeg path resolution ─────────────────────────────────────────────────────
def _find_bundled(name: str) -> str:
    suffix = '.exe' if sys.platform == 'win32' else ''
    if getattr(sys, 'frozen', False):
        candidate = os.path.join(sys._MEIPASS, name + suffix)
        if os.path.isfile(candidate):
            print(f"[ffmpeg] bundled: {candidate}")
            return candidate
    local = os.path.join(os.path.dirname(os.path.abspath(__file__)), name + suffix)
    if os.path.isfile(local):
        print(f"[ffmpeg] local: {local}")
        return local
    import shutil
    found = shutil.which(name)
    if found:
        print(f"[ffmpeg] PATH: {found}")
        return found
    raise FileNotFoundError(
        f"{name} not found. Place {name}{suffix} next to app.py or add to PATH."
    )

FFMPEG  = _find_bundled('ffmpeg')
FFPROBE = _find_bundled('ffprobe')

from threading import Timer

# ─── Base directory ───────────────────────────────────────────────────────────
if getattr(sys, "frozen", False):
    BUNDLE_DIR = Path(sys._MEIPASS)
    DATA_DIR   = Path(sys.executable).parent
else:
    BUNDLE_DIR = Path(__file__).parent
    DATA_DIR   = Path(__file__).parent

app = Flask(
    __name__,
    template_folder=str(BUNDLE_DIR / "static"),
    static_folder=str(BUNDLE_DIR / "static"),
)
app.config["MAX_CONTENT_LENGTH"] = 8 * 1024 * 1024 * 1024  # 8 GB

OUTPUT_FOLDER = DATA_DIR / "outputs"
TEMP_FOLDER   = DATA_DIR / "temp"
OUTPUT_FOLDER.mkdir(exist_ok=True)
TEMP_FOLDER.mkdir(exist_ok=True)

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

print(f"[Chaotics Slice] torch={torch.__version__}  device={DEVICE}", flush=True)


# ─── Helpers ──────────────────────────────────────────────────────────────────

def log(msg: str):
    ts = time.strftime("%H:%M:%S")
    print(f"[{ts}] {msg}", flush=True)


def get_duration(path: str) -> float:
    log(f"ffprobe: reading duration → {Path(path).name}")
    cmd = [FFPROBE, "-v", "error", "-show_entries", "format=duration", "-of", "json", path]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"ffprobe failed: {result.stderr}")
    dur = float(json.loads(result.stdout)["format"]["duration"])
    log(f"ffprobe: {dur:.2f}s")
    return dur


def extract_audio_to(video_path: str, audio_path: str):
    log(f"ffmpeg: extracting audio → {Path(audio_path).name}")
    t0 = time.time()
    cmd = [
        FFMPEG, "-y", "-i", video_path,
        "-ac", "1", "-ar", "16000", "-vn", "-f", "wav", audio_path,
        "-loglevel", "error",
    ]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"FFmpeg audio extract failed: {r.stderr}")
    elapsed = time.time() - t0
    size_mb = Path(audio_path).stat().st_size / 1e6
    log(f"ffmpeg: audio done in {elapsed:.1f}s  ({size_mb:.1f} MB)")


def load_audio_tensor(audio_path: str) -> "torch.Tensor":
    import wave, array
    log(f"audio: loading {Path(audio_path).name}")
    with wave.open(audio_path, "rb") as wf:
        sampwidth  = wf.getsampwidth()
        n_channels = wf.getnchannels()
        n_frames   = wf.getnframes()
        raw        = wf.readframes(n_frames)
    log(f"audio: {n_frames} frames  ch={n_channels}  sw={sampwidth}")
    if sampwidth == 2:
        samples = array.array("h", raw)
        wav = torch.tensor(samples, dtype=torch.float32) / 32768.0
    elif sampwidth == 4:
        samples = array.array("i", raw)
        wav = torch.tensor(samples, dtype=torch.float32) / 2147483648.0
    else:
        raise RuntimeError(f"Unsupported WAV sample width: {sampwidth}")
    if n_channels > 1:
        wav = wav[::n_channels]
    log(f"audio: tensor {wav.shape}  ≈{len(wav)/16000:.1f}s")
    return wav


_vad_model = None
_vad_utils = None
_vad_lock  = threading.Lock()


def get_vad():
    global _vad_model, _vad_utils
    with _vad_lock:
        if _vad_model is None:
            if getattr(sys, 'frozen', False):
                model_dir = os.path.join(sys._MEIPASS, 'silero_vad')
            else:
                model_dir = os.path.join(
                    os.path.dirname(os.path.abspath(__file__)), 'silero_vad'
                )
            if os.path.isdir(model_dir):
                log(f"VAD: loading from bundle: {model_dir}")
                _vad_model, _vad_utils = torch.hub.load(
                    repo_or_dir=model_dir, model='silero_vad',
                    source='local', force_reload=False,
                    onnx=False, verbose=False, trust_repo=True,
                )
            else:
                log("VAD: downloading Silero VAD (first run only)…")
                _vad_model, _vad_utils = torch.hub.load(
                    repo_or_dir='snakers4/silero-vad', model='silero_vad',
                    source='github', force_reload=False,
                    onnx=False, verbose=True, trust_repo=True,
                )
            _vad_model.to(DEVICE)
            log(f"VAD: ready on {DEVICE}")
    return _vad_model, _vad_utils


def run_vad_on_audio(audio_path, threshold, min_speech_ms, min_silence_ms, padding_ms):
    log(f"VAD: thr={threshold}  min_speech={min_speech_ms}ms  min_silence={min_silence_ms}ms  pad={padding_ms}ms")
    t0 = time.time()
    model, utils = get_vad()
    get_speech_ts = utils.get_speech_timestamps if hasattr(utils, 'get_speech_timestamps') else utils[0]
    wav = load_audio_tensor(audio_path)
    if DEVICE != "cpu":
        wav = wav.to(DEVICE)
    try:
        timestamps = get_speech_ts(
            wav, model, sampling_rate=16000,
            threshold=threshold,
            min_speech_duration_ms=min_speech_ms,
            min_silence_duration_ms=min_silence_ms,
            speech_pad_ms=padding_ms,
            return_seconds=True,
        )
        segments = [(t["start"], t["end"]) for t in timestamps]
    finally:
        del wav
        if DEVICE == "cuda":
            torch.cuda.empty_cache()
    kept = sum(e - s for s, e in segments)
    log(f"VAD: {len(segments)} segs  {kept:.1f}s speech  ({time.time()-t0:.1f}s)")
    return segments


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

    preset_defaults = {
        "chill":  {"threshold": 0.4, "min_speech_ms": 400},
        "normal": {"threshold": 0.5, "min_speech_ms": 250},
        "tight":  {"threshold": 0.6, "min_speech_ms": 150},
        "savage": {"threshold": 0.7, "min_speech_ms": 80},
    }
    defaults = preset_defaults.get(mode, {})
    is_custom = (
        abs(threshold - defaults.get("threshold", -1)) > 0.001
        or min_speech != defaults.get("min_speech_ms", -1)
    )
    label = f"V{threshold:.2f}_M{min_speech}" if is_custom else mode

    return dict(threshold=threshold, min_speech_ms=min_speech,
                min_silence_ms=min_silence, padding_ms=padding,
                frame_pad=int(data.get("frame_pad", 5)),
                label=label)


def compute_stats(segments, duration):
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


def push_log(job_id, msg, level="info"):
    log(f"[job {job_id}] {msg}")
    if job_id in job_logs:
        job_logs[job_id].put({"msg": msg, "level": level})


def update_job(job_id, **kw):
    if job_id in jobs:
        jobs[job_id].update(kw)


def purge_output(output_path: Path):
    try:
        if output_path.exists():
            output_path.unlink()
            log(f"cleanup: {output_path.name}")
    except OSError:
        pass


def purge_session_audio(file_id: str):
    """Delete the extracted WAV for a session."""
    sess = file_sessions.get(file_id, {})
    audio = Path(sess.get("audio_path", ""))
    try:
        if audio.exists():
            audio.unlink()
            log(f"cleanup: {audio.name}")
    except Exception:
        pass


def purge_all_sessions():
    """Wipe all session WAVs and clear the session table."""
    for fid in list(file_sessions.keys()):
        purge_session_audio(fid)
    file_sessions.clear()


# ─── Background render worker ─────────────────────────────────────────────────

def process_job(job_id: str, file_id: str, params: dict):
    try:
        sess       = file_sessions[file_id]
        video_path = sess["video_path"]
        duration   = sess["duration"]

        log(f"job {job_id}: start  {Path(video_path).name}  {duration:.1f}s")
        update_job(job_id, status="running", progress=10)
        push_log(job_id,
            f"VAD — threshold={params['threshold']}  "
            f"padding={params['padding_ms']}ms  "
            f"min-silence={params['min_silence_ms']}ms"
        )

        segments = run_vad_on_audio(
            sess["audio_path"],
            **{k: v for k, v in params.items() if k not in ("label", "frame_pad")}
        )
        if not segments:
            raise RuntimeError("No speech detected. Try lowering threshold or Chill mode.")

        kept = sum(e - s for s, e in segments)
        push_log(job_id, f"{len(segments)} segments · {kept:.1f}s speech detected", "success")
        update_job(job_id, progress=40)

        output_filename = f"{job_id}_sliced.mp4"
        output_path     = OUTPUT_FOLDER / output_filename

        # ── Single-pass select filter ─────────────────────────────────────────
        # Build a select expression that keeps only frames within speech segments.
        # This avoids all segment/concat boundary issues — one decode, one encode.
        #
        # Video:  select + setpts resets timestamps so output is contiguous
        # Audio:  aselect + asetpts does the same for audio samples
        # Result: perfectly aligned A/V, zero drift, no temp files needed.
        #
        # We extend each segment end by 2 frames (0.067s @ 30fps) to compensate
        # for the select filter dropping the last frame(s) at each boundary.
        # ─────────────────────────────────────────────────────────────────────

        frame_pad_frames = params.get("frame_pad", 5)
        FRAME_PAD = frame_pad_frames / 30.0  # frames at 30fps

        select_expr = "+".join(
            f"between(t,{s:.6f},{min(e + FRAME_PAD, duration):.6f})" for s, e in segments
        )

        vf = (
            f"select='{select_expr}',"
            f"setpts=N/FRAME_RATE/TB,"
            f"scale=trunc(iw/2)*2:trunc(ih/2)*2"
        )
        af = f"aselect='{select_expr}',asetpts=N/SR/TB"

        push_log(job_id, f"Encoding {len(segments)} segments (single pass)…")
        log(f"job {job_id}: single-pass select filter  {len(segments)} segs")

        cmd = [
            FFMPEG, "-y",
            "-i", video_path,
            "-vf", vf,
            "-af", af,
            "-c:v", "libx264", "-preset", "ultrafast", "-crf", "18",
            "-profile:v", "high", "-level", "4.1",
            "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
            "-movflags", "+faststart",
            str(output_path),
            "-loglevel", "error",
        ]

        t0  = time.time()
        proc = subprocess.Popen(
            cmd,
            stderr=subprocess.PIPE,
            stdout=subprocess.DEVNULL,
            text=True,
        )

        # Poll stderr for progress — ffmpeg prints frame= lines to stderr
        # We estimate progress by watching elapsed time vs expected duration
        def _progress_watcher():
            expected = kept  # seconds of output we expect
            while proc.poll() is None:
                elapsed = time.time() - t0
                # rough estimate: ffmpeg processes roughly in real-time for x264 ultrafast
                pct = min(95, 40 + int((elapsed / max(expected, 1)) * 55))
                update_job(job_id, progress=pct)
                time.sleep(1)

        watcher = threading.Thread(target=_progress_watcher, daemon=True)
        watcher.start()

        _, stderr_out = proc.communicate()
        watcher.join(timeout=2)

        if proc.returncode != 0:
            raise RuntimeError(f"FFmpeg failed: {stderr_out[:500]}")

        elapsed = time.time() - t0
        log(f"job {job_id}: encode done in {elapsed:.1f}s")

        # Diagnostic: verify output duration
        try:
            probe = subprocess.run(
                [FFPROBE, "-v", "error", "-show_entries",
                 "format=duration", "-of", "json", str(output_path)],
                capture_output=True, text=True
            )
            actual = float(json.loads(probe.stdout)["format"]["duration"])
            log(f"output: expected={kept:.4f}s  got={actual:.4f}s  diff={actual-kept:+.4f}s")
        except Exception:
            pass

        out_mb = output_path.stat().st_size / 1e6 if output_path.exists() else 0
        log(f"job {job_id}: done  {out_mb:.1f} MB")

        stats = compute_stats(segments, duration)
        push_log(job_id, f"{stats['pct_removed']}% removed · {stats['removed']}s cut", "success")
        update_job(job_id, status="done", progress=100,
                   output_filename=output_filename, stats=stats)

    except Exception as e:
        log(f"job {job_id}: ERROR — {e}")
        push_log(job_id, f"Error: {e}", "error")
        update_job(job_id, status="error", error=str(e))
    finally:
        # Delete the extracted WAV — no longer needed
        purge_session_audio(file_id)
        if job_id in job_logs:
            job_logs[job_id].put(None)


# ─── Routes ───────────────────────────────────────────────────────────────────

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/browse")
def api_browse():
    """Open a native OS file-picker dialog and return the chosen path."""
    log("browse: opening file dialog")
    exts_glob = " ".join(f"*{e}" for e in ALLOWED_EXTENSIONS)
    script = (
        "import tkinter as tk; from tkinter import filedialog; "
        "root = tk.Tk(); root.withdraw(); root.wm_attributes('-topmost', 1); "
        f"f = filedialog.askopenfilename(title='Select video', "
        f"filetypes=[('Video files', '{exts_glob}'), ('All files', '*.*')]); "
        "print(f, end='')"
    )
    try:
        result = subprocess.run(
            [sys.executable, "-c", script],
            capture_output=True, text=True, timeout=120
        )
        path = result.stdout.strip()
        if not path:
            log("browse: cancelled")
            return jsonify({"cancelled": True})
        log(f"browse: selected → {path}")
        return jsonify({"path": path})
    except subprocess.TimeoutExpired:
        return jsonify({"cancelled": True})
    except Exception as e:
        log(f"browse: error — {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/api/register", methods=["POST"])
def api_register():
    """Register a local file by path — zero copy, no upload."""
    body      = request.get_json(force=True)
    file_path = body.get("path", "").strip().strip('"').strip("'")
    log(f"register: {file_path!r}")

    if not file_path:
        return jsonify({"error": "No path provided"}), 400

    p = Path(file_path)
    if not p.exists():
        return jsonify({"error": f"File not found: {file_path}"}), 404
    if not p.is_file():
        return jsonify({"error": "Path is not a file"}), 400

    suffix = p.suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS:
        return jsonify({"error": f"Unsupported format: {suffix}  (supported: {', '.join(ALLOWED_EXTENSIONS)})"}), 400

    # Clean up any existing sessions and orphaned WAV files before starting fresh
    purge_all_sessions()

    file_id    = str(uuid.uuid4())[:8]
    audio_path = str(TEMP_FOLDER / f"{file_id}.wav")

    try:
        duration = get_duration(str(p))
        extract_audio_to(str(p), audio_path)
    except Exception as e:
        log(f"register: failed — {e}")
        return jsonify({"error": str(e)}), 500

    file_sessions[file_id] = {
        "video_path": str(p),
        "audio_path": audio_path,
        "duration":   duration,
        "filename":   p.name,
    }
    log(f"register: ok  file_id={file_id}  {duration:.1f}s  {p.stat().st_size/1e6:.1f} MB")
    return jsonify({
        "file_id":  file_id,
        "duration": round(duration, 2),
        "filename": p.name,
        "size":     p.stat().st_size,
    })


@app.route("/api/video/<file_id>")
def api_video(file_id: str):
    """Stream the registered video file with range-request support for seeking."""
    sess = file_sessions.get(file_id)
    if not sess:
        return jsonify({"error": "Unknown file_id"}), 404

    video_path = Path(sess["video_path"])
    if not video_path.exists():
        return jsonify({"error": "File not found"}), 404

    file_size = video_path.stat().st_size
    suffix    = video_path.suffix.lower()
    mime_map  = {
        ".mp4": "video/mp4", ".mkv": "video/x-matroska",
        ".mov": "video/quicktime", ".avi": "video/x-msvideo",
        ".webm": "video/webm", ".m4v": "video/mp4", ".flv": "video/x-flv",
    }
    mime = mime_map.get(suffix, "video/mp4")

    range_header = request.headers.get("Range")
    if range_header:
        byte_range = range_header.strip().split("=")[1]
        start_str, _, end_str = byte_range.partition("-")
        start = int(start_str) if start_str else 0
        end   = int(end_str)   if end_str   else file_size - 1
        end   = min(end, file_size - 1)
        length = end - start + 1

        def generate_range():
            with open(video_path, "rb") as f:
                f.seek(start)
                remaining = length
                chunk = 1 << 16
                while remaining > 0:
                    data = f.read(min(chunk, remaining))
                    if not data:
                        break
                    remaining -= len(data)
                    yield data

        headers = {
            "Content-Range":  f"bytes {start}-{end}/{file_size}",
            "Accept-Ranges":  "bytes",
            "Content-Length": str(length),
            "Content-Type":   mime,
        }
        return Response(generate_range(), status=206, headers=headers)

    def generate_full():
        with open(video_path, "rb") as f:
            while True:
                data = f.read(1 << 16)
                if not data:
                    break
                yield data

    headers = {
        "Content-Length": str(file_size),
        "Accept-Ranges":  "bytes",
        "Content-Type":   mime,
    }
    return Response(generate_full(), status=200, headers=headers)


_preview_lock = threading.Lock()

@app.route("/api/preview", methods=["POST"])
def api_preview():
    body    = request.get_json(force=True)
    file_id = body.get("file_id")
    if not file_id or file_id not in file_sessions:
        return jsonify({"error": "Unknown file_id"}), 404

    if not _preview_lock.acquire(blocking=False):
        log("preview: busy, skipping")
        return jsonify({"error": "busy"}), 429

    sess = file_sessions[file_id]
    log(f"preview: file_id={file_id}")
    try:
        p        = parse_params(body)
        segments = run_vad_on_audio(sess["audio_path"], **{k: v for k, v in p.items() if k not in ("label", "frame_pad")})
        stats    = compute_stats(segments, sess["duration"])
        return jsonify({"ok": True, "stats": stats})
    except Exception as e:
        log(f"preview error: {e}")
        return jsonify({"error": str(e)}), 500
    finally:
        _preview_lock.release()


@app.route("/api/process", methods=["POST"])
def api_process():
    body    = request.get_json(force=True)
    file_id = body.get("file_id")
    if not file_id or file_id not in file_sessions:
        return jsonify({"error": "Unknown file_id"}), 404
    params = parse_params(body)
    job_id = str(uuid.uuid4())[:8]
    jobs[job_id]     = {"status": "queued", "progress": 0, "label": params["label"], "file_id": file_id}
    job_logs[job_id] = queue.Queue()
    log(f"process: job={job_id}  file={file_id}  label={params['label']}")
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

    sess      = file_sessions.get(job.get("file_id", ""), {})
    orig_name = Path(sess.get("filename", "sliced.mp4")).stem
    label     = job.get("label", "sliced")
    download_name = f"{orig_name}_{label}.mp4"

    log(f"download: {output_path.name} → {download_name}")
    @after_this_request
    def cleanup(response):
        purge_output(output_path)
        jobs.pop(job_id, None)
        job_logs.pop(job_id, None)
        return response
    return send_file(str(output_path), as_attachment=True, download_name=download_name)


# ─── Run ──────────────────────────────────────────────────────────────────────

def open_browser(port=5000):
    if platform.system() in ("Windows", "Darwin"):
        webbrowser.open(f"http://127.0.0.1:{port}")
    else:
        print(f"  Open http://127.0.0.1:{port} in your browser")


PORT = 5001

if __name__ == "__main__":
    print()
    print(f"  Chaotics Slice  ✂   http://127.0.0.1:{PORT}   [{DEVICE.upper()}]")
    print()
    Timer(1.5, lambda: open_browser(port=PORT)).start()
    from waitress import serve
    serve(app, host="127.0.0.1", port=PORT, threads=8, channel_timeout=300)