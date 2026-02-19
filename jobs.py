"""
jobs.py — Job registry, render worker, and stats helpers.
"""
import json
import os
import queue
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import subprocess

from config import OUTPUT_FOLDER, TEMP_FOLDER, MODE_PRESETS, MODE_DEFAULTS
from ffmpeg import FFMPEG, FFPROBE, probe_streams
from vad import detect_speech

# ── In-memory stores ──────────────────────────────────────────────────────────
file_sessions: dict[str, dict] = {}   # file_id → {video_path, audio_path, duration, filename}
jobs:          dict[str, dict] = {}   # job_id  → {status, progress, label, file_id, …}
job_logs:      dict[str, queue.Queue] = {}


# ── Helpers ───────────────────────────────────────────────────────────────────
def _ts() -> str:
    return time.strftime("%H:%M:%S")


def log(msg: str):
    print(f"[{_ts()}] {msg}", flush=True)


def push_log(job_id: str, msg: str, level: str = "info"):
    log(f"[job {job_id}] {msg}")
    if job_id in job_logs:
        job_logs[job_id].put({"msg": msg, "level": level})


def update_job(job_id: str, **kw):
    if job_id in jobs:
        jobs[job_id].update(kw)


def compute_stats(segments: list, duration: float) -> dict:
    kept    = sum(e - s for s, e in segments)
    removed = duration - kept
    return {
        "original_duration": round(duration, 2),
        "kept":              round(kept, 2),
        "removed":           round(removed, 2),
        "pct_removed":       round((removed / duration * 100) if duration > 0 else 0, 1),
        "segments":          len(segments),
        "segments_list":     [[round(s, 3), round(e, 3)] for s, e in segments],
    }


def parse_params(data: dict) -> dict:
    """
    Extract and normalise VAD parameters from a request body.
    Returns threshold, min_speech_ms, min_silence_ms, padding_ms, label.
    """
    mode       = data.get("mode", "normal")
    threshold  = float(data.get("threshold", 0.5))
    min_speech = int(data.get("min_speech", 250))

    gap = data.get("gap")
    if gap:
        gap         = int(gap)
        min_silence = gap
        padding     = max(20, gap // 3)
    else:
        preset      = MODE_PRESETS.get(mode, MODE_PRESETS["normal"])
        min_silence = preset["min_silence"]
        padding     = preset["padding"]

    defaults  = MODE_DEFAULTS.get(mode, {})
    is_custom = (
        abs(threshold - defaults.get("threshold", -1)) > 0.001
        or min_speech != defaults.get("min_speech_ms", -1)
    )
    label = f"V{threshold:.2f}_M{min_speech}" if is_custom else mode

    return dict(
        threshold=threshold,
        min_speech_ms=min_speech,
        min_silence_ms=min_silence,
        padding_ms=padding,
        label=label,
    )


def purge_output(output_path: Path):
    try:
        if output_path.exists():
            output_path.unlink()
            log(f"cleanup: {output_path.name}")
    except OSError:
        pass



# ── Segment encoder ───────────────────────────────────────────────────────────
def _encode_segment(job_id: str, i: int, s: float, e: float, video_path: str, n_total: int) -> tuple[int, Path]:
    """Encode a single clip segment; returns (index, output_path)."""
    tmp_path = TEMP_FOLDER / f"{job_id}_seg{i:04d}.mp4"
    dur = e - s

    cmd = [
        FFMPEG, "-y",
        "-ss", f"{s:.6f}",
        "-i", video_path,
        "-t:a", f"{dur:.6f}",
        "-t:v", f"{dur + 0.05:.6f}",
        "-c:v", "libx264", "-preset", "ultrafast", "-crf", "18",
        "-profile:v", "high", "-level", "4.1",
        "-pix_fmt", "yuv420p",
        "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
        "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
        "-avoid_negative_ts", "make_zero",
        "-movflags", "+faststart",
        str(tmp_path),
        "-loglevel", "error",
    ]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"Segment {i} failed: {r.stderr[:300]}")

    # Diagnostic duration log
    data = probe_streams(str(tmp_path))
    for st in data.get("streams", []):
        actual = float(st.get("duration", 0))
        log(f"  seg {i+1:03d}/{n_total} [{st['codec_type']}]  want={dur:.4f}s  got={actual:.4f}s  diff={actual-dur:+.4f}s")

    return i, tmp_path


# ── Main render worker ────────────────────────────────────────────────────────
def process_job(job_id: str, file_id: str, params: dict):
    try:
        sess       = file_sessions[file_id]
        video_path = sess["video_path"]
        audio_path = sess["audio_path"]
        duration   = sess["duration"]

        log(f"job {job_id}: start  {Path(video_path).name}  {duration:.1f}s")
        update_job(job_id, status="running", progress=10)
        push_log(job_id,
            f"VAD — threshold={params['threshold']}  "
            f"padding={params['padding_ms']}ms  "
            f"min-silence={params['min_silence_ms']}ms"
        )

        vad_params = {k: v for k, v in params.items() if k != "label"}
        segments = detect_speech(audio_path, **vad_params)
        if not segments:
            raise RuntimeError("No speech detected. Try lowering threshold or Chill mode.")

        kept = sum(e - s for s, e in segments)
        push_log(job_id, f"{len(segments)} segments · {kept:.1f}s speech detected", "success")
        update_job(job_id, progress=40)

        output_filename = f"{job_id}_sliced.mp4"
        output_path     = OUTPUT_FOLDER / output_filename
        concat_list     = TEMP_FOLDER / f"{job_id}_concat.txt"
        tmp_files       = [None] * len(segments)
        completed_count = [0]
        count_lock      = threading.Lock()

        MAX_WORKERS = min(4, max(1, (os.cpu_count() or 4) - 1))
        push_log(job_id, f"Encoding {len(segments)} segments ({MAX_WORKERS} workers)…")

        try:
            with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
                futures = {
                    executor.submit(_encode_segment, job_id, i, s, e, video_path, len(segments)): i
                    for i, (s, e) in enumerate(segments)
                }
                for future in as_completed(futures):
                    i, tmp_path = future.result()
                    tmp_files[i] = tmp_path
                    with count_lock:
                        completed_count[0] += 1
                        done = completed_count[0]
                    update_job(job_id, progress=40 + int(done / len(segments) * 50))
                    if done % 10 == 0 or done == len(segments):
                        push_log(job_id, f"Encoded {done}/{len(segments)} segments")

            # Write concat list and merge
            with open(concat_list, "w", encoding="utf-8") as f:
                for p in tmp_files:
                    f.write(f"file '{p.as_posix()}'\n")

            push_log(job_id, "Joining segments…")
            cmd = [
                FFMPEG, "-y",
                "-f", "concat", "-safe", "0",
                "-i", str(concat_list),
                "-c", "copy",
                "-movflags", "+faststart",
                str(output_path),
                "-loglevel", "error",
            ]
            r = subprocess.run(cmd, capture_output=True, text=True)
            if r.returncode != 0:
                raise RuntimeError(f"Concat failed: {r.stderr[:300]}")

            # Diagnostic: final duration check
            import json as _json
            probe = subprocess.run(
                [FFPROBE, "-v", "error", "-show_entries", "format=duration", "-of", "json", str(output_path)],
                capture_output=True, text=True,
            )
            if probe.returncode == 0:
                actual = float(_json.loads(probe.stdout)["format"]["duration"])
                expected = sum(e - s for s, e in segments)
                log(f"concat: expected={expected:.4f}s  got={actual:.4f}s  diff={actual-expected:+.4f}s")

        finally:
            for p in tmp_files:
                if p and Path(p).exists():
                    try: Path(p).unlink()
                    except: pass
            if concat_list.exists():
                try: concat_list.unlink()
                except: pass

        stats = compute_stats(segments, duration)
        push_log(job_id, f"{stats['pct_removed']}% removed · {stats['removed']}s cut", "success")
        update_job(job_id, status="done", progress=100,
                   output_filename=output_filename, stats=stats)
        log(f"job {job_id}: done  {output_path.stat().st_size / 1e6:.1f} MB")

    except Exception as e:
        log(f"job {job_id}: ERROR — {e}")
        push_log(job_id, f"Error: {e}", "error")
        update_job(job_id, status="error", error=str(e))
    finally:
        if job_id in job_logs:
            job_logs[job_id].put(None)
