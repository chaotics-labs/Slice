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
    print(f"[_get_vad] acquiring lock...", flush=True)
    with _vad_lock:
        print(f"[_get_vad] lock acquired", flush=True)
        if _vad_model is not None:
            print(f"[_get_vad] model already cached, returning", flush=True)
            return _vad_model, _vad_utils

        if getattr(sys, "frozen", False):
            model_dir = os.path.join(sys._MEIPASS, "silero_vad")
        else:
            model_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "silero_vad")

        print(f"[_get_vad] model_dir={model_dir}, exists={os.path.isdir(model_dir)}", flush=True)
        
        if os.path.isdir(model_dir):
            print(f"[_get_vad] loading from local directory...", flush=True)
            _vad_model, _vad_utils = torch.hub.load(
                repo_or_dir=model_dir, model="silero_vad",
                source="local", force_reload=False,
                onnx=False, verbose=False, trust_repo=True,
            )
            print(f"[_get_vad] loaded from local directory", flush=True)
        else:
            print(f"[_get_vad] downloading Silero VAD (first run only)…", flush=True)
            _vad_model, _vad_utils = torch.hub.load(
                repo_or_dir="snakers4/silero-vad", model="silero_vad",
                source="github", force_reload=False,
                onnx=False, verbose=True, trust_repo=True,
            )
            print(f"[_get_vad] downloaded from GitHub", flush=True)

        print(f"[_get_vad] moving model to device {DEVICE}...", flush=True)
        _vad_model.to(DEVICE)
        print(f"[_get_vad] model ready on {DEVICE}", flush=True)
    print(f"[_get_vad] returning model", flush=True)
    return _vad_model, _vad_utils


def _load_wav_tensor(audio_path: str) -> "torch.Tensor":
    """Read a 16 kHz mono WAV into a float32 tensor."""
    print(f"[_load_wav_tensor] opening {audio_path}...", flush=True)
    with wave.open(audio_path, "rb") as wf:
        sampwidth  = wf.getsampwidth()
        n_channels = wf.getnchannels()
        n_frames   = wf.getnframes()
        print(f"[_load_wav_tensor] WAV info: sampwidth={sampwidth}, channels={n_channels}, frames={n_frames}", flush=True)
        raw        = wf.readframes(n_frames)
    
    print(f"[_load_wav_tensor] raw data loaded, size={len(raw)} bytes", flush=True)

    if sampwidth == 2:
        samples = array.array("h", raw)
        wav = torch.tensor(samples, dtype=torch.float32) / 32768.0
    elif sampwidth == 4:
        samples = array.array("i", raw)
        wav = torch.tensor(samples, dtype=torch.float32) / 2147483648.0
    else:
        raise RuntimeError(f"Unsupported WAV sample width: {sampwidth}")

    if n_channels > 1:
        print(f"[_load_wav_tensor] converting {n_channels} channels to mono", flush=True)
        wav = wav[::n_channels]
    
    print(f"[_load_wav_tensor] tensor ready: shape={wav.shape}, dtype={wav.dtype}", flush=True)
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
    print(f"[detect_speech] START — audio_path={audio_path}", flush=True)
    print(f"[detect_speech] params: threshold={threshold}, min_speech_ms={min_speech_ms}, min_silence_ms={min_silence_ms}, padding_ms={padding_ms}", flush=True)
    
    print(f"[detect_speech] loading VAD model...", flush=True)
    model, utils = _get_vad()
    print(f"[detect_speech] model loaded", flush=True)
    
    get_speech_ts = (
        utils.get_speech_timestamps
        if hasattr(utils, "get_speech_timestamps")
        else utils[0]
    )
    print(f"[detect_speech] get_speech_ts resolved", flush=True)

    print(f"[detect_speech] loading WAV tensor from {audio_path}...", flush=True)
    wav = _load_wav_tensor(audio_path)
    print(f"[detect_speech] WAV loaded, shape={wav.shape}, dtype={wav.dtype}", flush=True)
    
    if DEVICE != "cpu":
        print(f"[detect_speech] moving tensor to device={DEVICE}", flush=True)
        wav = wav.to(DEVICE)
        print(f"[detect_speech] tensor moved to {DEVICE}", flush=True)

    try:
        print(f"[detect_speech] running speech detection...", flush=True)
        timestamps = get_speech_ts(
            wav, model,
            sampling_rate=16000,
            threshold=threshold,
            min_speech_duration_ms=min_speech_ms,
            min_silence_duration_ms=min_silence_ms,
            speech_pad_ms=padding_ms,
            return_seconds=True,
        )
        print(f"[detect_speech] detection complete, found {len(timestamps)} segments", flush=True)
        segments = [(t["start"], t["end"]) for t in timestamps]
        print(f"[detect_speech] segments: {segments}", flush=True)
        return segments
    except Exception as e:
        print(f"[detect_speech] ERROR during detection: {e}", flush=True)
        import traceback
        traceback.print_exc()
        raise
    finally:
        print(f"[detect_speech] cleanup...", flush=True)
        del wav
        if DEVICE == "cuda":
            torch.cuda.empty_cache()
        print(f"[detect_speech] complete", flush=True)
