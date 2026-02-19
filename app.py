"""
app.py — Flask application: routes only.
All heavy logic lives in config.py, ffmpeg.py, vad.py, and jobs.py.
"""
import json
import platform
import queue
import subprocess
import sys
import threading
import uuid
import webbrowser
from pathlib import Path
from threading import Timer

from flask import Flask, Response, after_this_request, jsonify, render_template, request, send_file

from config import ALLOWED_EXTENSIONS, BUNDLE_DIR, DATA_DIR, MAX_UPLOAD_SIZE, TEMP_FOLDER
from ffmpeg import extract_audio, get_duration
from jobs import (
    compute_stats,
    file_sessions,
    job_logs,
    jobs,
    parse_params,
    process_job,
    purge_output,
)
from vad import detect_speech, DEVICE

# ── App setup ─────────────────────────────────────────────────────────────────
app = Flask(
    __name__,
    template_folder=str(BUNDLE_DIR / "static"),
    static_folder=str(BUNDLE_DIR / "static"),
)
app.config["MAX_CONTENT_LENGTH"] = MAX_UPLOAD_SIZE

# One lock to serialise preview requests (VAD is memory-heavy)
_preview_lock = threading.Lock()


# ── Startup cleanup ───────────────────────────────────────────────────────────
def _cleanup_temp_folder():
    """Clear all files in temp folder on app launch."""
    try:
        if TEMP_FOLDER.exists():
            for item in TEMP_FOLDER.iterdir():
                if item.is_file():
                    try:
                        item.unlink()
                    except OSError:
                        pass
            print(f"[startup] cleaned temp folder", flush=True)
    except Exception as e:
        print(f"[startup] temp cleanup error: {e}", flush=True)

_cleanup_temp_folder()


# ── Routes ────────────────────────────────────────────────────────────────────

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/browse")
def api_browse():
    """Open a native OS file-picker dialog and return the chosen path."""
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
            capture_output=True, text=True, timeout=120,
        )
        path = result.stdout.strip()
        if not path:
            return jsonify({"cancelled": True})
        return jsonify({"path": path})
    except subprocess.TimeoutExpired:
        return jsonify({"cancelled": True})
    except Exception as e:
        print(f"[browse] error: {e}", flush=True)
        return jsonify({"error": str(e)}), 500


@app.route("/api/register", methods=["POST"])
def api_register():
    """Register a local file by path — zero-copy, no upload."""
    body      = request.get_json(force=True)
    file_path = body.get("path", "").strip().strip('"').strip("'")
    print(f"[register] path={file_path}", flush=True)

    if not file_path:
        return jsonify({"error": "No path provided"}), 400

    p = Path(file_path)
    if not p.exists() or not p.is_file():
        return jsonify({"error": f"File not found: {file_path}"}), 404
    if p.suffix.lower() not in ALLOWED_EXTENSIONS:
        return jsonify({"error": f"Unsupported format: {p.suffix}"}), 400

    file_id    = str(uuid.uuid4())[:8]
    audio_path = str(DATA_DIR / "temp" / f"{file_id}.wav")
    print(f"[register] file_id={file_id} audio_path={audio_path}", flush=True)

    try:
        print(f"[register] getting duration...", flush=True)
        duration = get_duration(str(p))
        print(f"[register] duration={duration}, extracting audio...", flush=True)
        extract_audio(str(p), audio_path)
        print(f"[register] audio extracted ok", flush=True)
    except Exception as e:
        import traceback
        print(f"[register] ERROR: {e}", flush=True)
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500

    file_sessions[file_id] = {
        "video_path": str(p),
        "audio_path": audio_path,
        "duration":   duration,
        "filename":   p.name,
    }
    return jsonify({
        "file_id":  file_id,
        "duration": round(duration, 2),
        "filename": p.name,
        "size":     p.stat().st_size,
    })


@app.route("/api/video/<file_id>")
def api_video(file_id: str):
    """Stream the registered video with range-request support for seeking."""
    sess = file_sessions.get(file_id)
    if not sess:
        return jsonify({"error": "Unknown file_id"}), 404

    video_path = Path(sess["video_path"])
    if not video_path.exists():
        return jsonify({"error": "File not found"}), 404

    file_size = video_path.stat().st_size
    mime_map  = {
        ".mp4": "video/mp4", ".mkv": "video/x-matroska",
        ".mov": "video/quicktime", ".avi": "video/x-msvideo",
        ".webm": "video/webm", ".m4v": "video/mp4", ".flv": "video/x-flv",
    }
    mime = mime_map.get(video_path.suffix.lower(), "video/mp4")

    def stream(start: int, end: int):
        with open(video_path, "rb") as f:
            f.seek(start)
            remaining = end - start + 1
            while remaining > 0:
                chunk = f.read(min(65536, remaining))
                if not chunk:
                    break
                remaining -= len(chunk)
                yield chunk

    range_header = request.headers.get("Range")
    if range_header:
        start_str, _, end_str = range_header.strip().split("=")[1].partition("-")
        start = int(start_str) if start_str else 0
        end   = int(end_str)   if end_str   else file_size - 1
        end   = min(end, file_size - 1)
        return Response(
            stream(start, end), status=206,
            headers={
                "Content-Range":  f"bytes {start}-{end}/{file_size}",
                "Accept-Ranges":  "bytes",
                "Content-Length": str(end - start + 1),
                "Content-Type":   mime,
            },
        )

    return Response(
        stream(0, file_size - 1), status=200,
        headers={
            "Content-Length": str(file_size),
            "Accept-Ranges":  "bytes",
            "Content-Type":   mime,
        },
    )


@app.route("/api/preview", methods=["POST"])
def api_preview():
    """Run VAD preview (returns segment stats, no video encoding)."""
    body    = request.get_json(force=True)
    file_id = body.get("file_id")
    print(f"[preview] request file_id={file_id}", flush=True)

    if not file_id or file_id not in file_sessions:
        print(f"[preview] unknown file_id", flush=True)
        return jsonify({"error": "Unknown file_id"}), 404

    if not _preview_lock.acquire(blocking=False):
        print(f"[preview] busy, returning 429", flush=True)
        return jsonify({"error": "busy"}), 429

    sess = file_sessions[file_id]
    print(f"[preview] audio_path={sess['audio_path']}", flush=True)
    try:
        p      = parse_params(body)
        vad_kw = {k: v for k, v in p.items() if k != "label"}
        print(f"[preview] running VAD with params: {vad_kw}", flush=True)
        segments = detect_speech(sess["audio_path"], **vad_kw)
        print(f"[preview] VAD complete — {len(segments)} segments", flush=True)
        stats = compute_stats(segments, sess["duration"])
        return jsonify({"ok": True, "stats": stats})
    except Exception as e:
        import traceback
        print(f"[preview] ERROR: {e}", flush=True)
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500
    finally:
        _preview_lock.release()
        print(f"[preview] lock released", flush=True)


@app.route("/api/process", methods=["POST"])
def api_process():
    """Start a full encode job in a background thread."""
    body    = request.get_json(force=True)
    file_id = body.get("file_id")
    print(f"[process] request file_id={file_id}", flush=True)

    if not file_id or file_id not in file_sessions:
        return jsonify({"error": "Unknown file_id"}), 404

    params = parse_params(body)
    job_id = str(uuid.uuid4())[:8]
    print(f"[process] created job_id={job_id} params={params}", flush=True)
    jobs[job_id]     = {"status": "queued", "progress": 0, "label": params["label"], "file_id": file_id}
    job_logs[job_id] = queue.Queue()

    threading.Thread(target=process_job, args=(job_id, file_id, params), daemon=True).start()
    return jsonify({"job_id": job_id})


@app.route("/api/status/<job_id>")
def api_status(job_id: str):
    job = jobs.get(job_id)
    if not job:
        return jsonify({"error": "Unknown job"}), 404
    return jsonify(job)


@app.route("/api/logs/<job_id>")
def api_logs(job_id: str):
    """Server-Sent Events stream of job log messages."""
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

    return Response(
        generate(),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.route("/api/download/<job_id>")
def api_download(job_id: str):
    job = jobs.get(job_id)
    if not job or job.get("status") != "done":
        return jsonify({"error": "Not ready"}), 404

    output_path = DATA_DIR / "outputs" / job["output_filename"]
    if not output_path.exists():
        return jsonify({"error": "File missing"}), 404

    sess      = file_sessions.get(job.get("file_id", ""), {})
    orig_stem = Path(sess.get("filename", "sliced.mp4")).stem
    label     = job.get("label", "sliced")
    print(f"[download] job_id={job_id} file={output_path}", flush=True)

    @after_this_request
    def cleanup(response):
        purge_output(output_path)
        # Clean up session data from memory
        file_sessions.pop(job.get("file_id", ""), None)
        jobs.pop(job_id, None)
        job_logs.pop(job_id, None)
        return response

    return send_file(str(output_path), as_attachment=True, download_name=f"{orig_stem}_{label}.mp4")


# ── Entry point ───────────────────────────────────────────────────────────────
PORT = 5001

if __name__ == "__main__":
    print(f"\n  Chaotics Slice  ✂   http://127.0.0.1:{PORT}   [{DEVICE.upper()}]\n")

    def _open_browser():
        if platform.system() in ("Windows", "Darwin"):
            webbrowser.open(f"http://127.0.0.1:{PORT}")
        else:
            print(f"  Open http://127.0.0.1:{PORT} in your browser")

    Timer(1.5, _open_browser).start()

    from waitress import serve
    serve(app, host="127.0.0.1", port=PORT, threads=8, channel_timeout=300)