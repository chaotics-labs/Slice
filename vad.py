"""
vad.py — Silero VAD model loading and speech-segment detection.
"""
import os
import sys
import array
import wave
import threading

import torch


# ── Device selection ──────────────────────────────────────────────────────────
if torch.cuda.is_available():
    DEVICE = "cuda"
elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
    DEVICE = "mps"
else:
    DEVICE = "cpu"

print(f"[Chaotics Slice] torch={torch.__version__}  device={DEVICE}", flush=True)

_vad_model = None
_vad_utils = None
_vad_lock  = threading.Lock()


def _get_vad():
    """Load (or return cached) Silero VAD model."""
    global _vad_model, _vad_utils
    with _vad_lock:
        if _vad_model is not None:
            return _vad_model, _vad_utils

        if getattr(sys, "frozen", False):
            model_dir = os.path.join(sys._MEIPASS, "silero_vad")
        else:
            model_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "silero_vad")

        if os.path.isdir(model_dir):
            _vad_model, _vad_utils = torch.hub.load(
                repo_or_dir=model_dir, model="silero_vad",
                source="local", force_reload=False,
                onnx=False, verbose=False, trust_repo=True,
            )
        else:
            print("[VAD] Downloading Silero VAD (first run only)…", flush=True)
            _vad_model, _vad_utils = torch.hub.load(
                repo_or_dir="snakers4/silero-vad", model="silero_vad",
                source="github", force_reload=False,
                onnx=False, verbose=True, trust_repo=True,
            )

        _vad_model.to(DEVICE)
        print(f"[VAD] Ready on {DEVICE}", flush=True)
    return _vad_model, _vad_utils


def _load_wav_tensor(audio_path: str) -> "torch.Tensor":
    """Read a 16 kHz mono WAV into a float32 tensor."""
    with wave.open(audio_path, "rb") as wf:
        sampwidth  = wf.getsampwidth()
        n_channels = wf.getnchannels()
        raw        = wf.readframes(wf.getnframes())

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
    return wav


def detect_speech(
    audio_path: str,
    threshold: float,
    min_speech_ms: int,
    min_silence_ms: int,
    padding_ms: int,
) -> list[tuple[float, float]]:
    """
    Run VAD on audio_path and return list of (start, end) speech segments in seconds.
    """
    model, utils = _get_vad()
    get_speech_ts = (
        utils.get_speech_timestamps
        if hasattr(utils, "get_speech_timestamps")
        else utils[0]
    )

    wav = _load_wav_tensor(audio_path)
    if DEVICE != "cpu":
        wav = wav.to(DEVICE)

    try:
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
    finally:
        del wav
        if DEVICE == "cuda":
            torch.cuda.empty_cache()
