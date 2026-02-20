<p align="center">
  <img src="static/res/Chaotics Banner.png" alt="Chaotics Slice Banner" width="600">
</p>

# Chaotics Slice ✂

> **AI-powered silence remover for video editors**  
> Detects speech with Silero VAD and cuts silences. Runs locally, free forever, always open source.

[![Python 3.10+](https://img.shields.io/badge/python-3.10%2B-blue)](https://python.org)
[![License: GPL](https://img.shields.io/badge/license-GPL-green.svg)](LICENSE)
[![Active Development](https://img.shields.io/badge/status-active-brightgreen)](#)

---

## ✨ What It Does

**Upload a video → Pick an aggression level → Slice removes all the silence.**

Give it a video file, select how aggressive you want the silence removal (Chill → Savage), and Chaotics Slice automatically detects every moment of speech and cuts everything else. Preview your cuts on an interactive timeline, then either:
- **Export the sliced video** as a new file, or  
- **Export a cut list** (EDL / FCPXML / Premiere XML) to edit in your NLE

All processing happens locally on your machine. Download once, work offline forever.

---

## 🎯 Features

- **Local processing** — Everything runs on your machine. No uploads, no cloud, no tracking.
- **AI-powered detection** — Uses Silero VAD (Voice Activity Detection) to find speech, not just audio levels.
- **Flexible aggression levels** — Chill, Normal, Tight, or Savage presets, plus full manual control over thresholds.
- **NLE-ready exports** — Cut lists compatible with Final Cut Pro, Premiere Pro, and DaVinci Resolve.
- **Optional GPU acceleration** — Auto-detects CUDA (NVIDIA) and MPS (Apple Silicon); falls back to CPU seamlessly.
- **Works offline** — After the model downloads once, the app is fully offline-capable.
- **Free and open source** — GPL licensed. No paywalls, no ads, no feature gates.

---

## 📋 Requirements (All Platforms)

| Dependency | Version | Notes |
|---|---|---|
| **Python** | 3.10 – 3.12 | 3.13 not yet tested |
| **FFmpeg + FFprobe** | 6+ | Must be on `PATH` |
| **PyTorch** | 2.x | CPU works; GPU optional |
| **torchaudio** | any | Auto-detected at startup |

GPU acceleration is **optional**. The app auto-detects CUDA and MPS at startup and falls back to CPU silently.

---

## 🚀 Quick Start (Pick Your Platform)

| **Python** | 3.10 – 3.12 | 3.13 not yet tested |
| **FFmpeg + FFprobe** | 6+ | Must be on `PATH` |
| **PyTorch** | 2.x | CPU works; GPU optional |
| **torchaudio** | any | Auto-detected at startup |

GPU acceleration is **optional**. The app auto-detects CUDA and MPS at startup and falls back to CPU silently.

---

## 🚀 Quick Start (Pick Your Platform)

### macOS

**1. Install system dependencies**

```bash
# Install Homebrew if you don't have it
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

brew install python@3.11 ffmpeg
```

**2. Clone, create virtual environment, and install**

```bash
git clone https://github.com/yourname/chaotics-slice.git
cd chaotics-slice

python3.11 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install torch torchvision torchaudio flask waitress
```

**3. Run**

```bash
python app.py
```

Browser opens automatically at `http://127.0.0.1:5000`. Done!

---

### Windows

**1. Install Python**

Download Python 3.11 from [python.org](https://www.python.org/downloads/windows/).  
✅ **Check "Add Python to PATH"** during install.

**2. Install FFmpeg**

1. Download a build from [ffmpeg.org/download.html](https://ffmpeg.org/download.html) (e.g. gyan.dev full build)
2. Extract to `C:\ffmpeg`
3. Add `C:\ffmpeg\bin` to your **System PATH**:  
   *Control Panel → System → Advanced → Environment Variables → Path → Edit → New*
4. Verify: open a fresh terminal and run `ffmpeg -version`

**3. Clone, create virtual environment, and install**

```powershell
git clone https://github.com/yourname/chaotics-slice.git
cd chaotics-slice

python -m venv .venv
.venv\Scripts\activate
pip install --upgrade pip
```

**Choose one based on your GPU:**

```powershell
# NVIDIA (CUDA 12.1):
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121

# CPU only:
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cpu

# Then all:
pip install flask waitress
```

**4. Run**

```powershell
python app.py
```

Browser opens automatically at `http://127.0.0.1:5000`. Done!

---

### Linux (Ubuntu / Debian)

**1. Install system dependencies**

```bash
sudo apt update
sudo apt install -y python3.11 python3.11-venv python3-pip ffmpeg git
```

> On Ubuntu 22.04, Python 3.11 may need the deadsnakes PPA:
> ```bash
> sudo add-apt-repository ppa:deadsnakes/ppa
> sudo apt update
> sudo apt install -y python3.11 python3.11-venv
> ```

**2. Clone, create virtual environment, and install**

```bash
git clone https://github.com/yourname/chaotics-slice.git
cd chaotics-slice

python3.11 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
```

**Choose one based on your GPU:**

```bash
# NVIDIA (CUDA 12.1):
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121

# CPU only:
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cpu

# Then all:
pip install flask waitress
```

**3. Run**

```bash
python app.py
```

⚠️ The app won't auto-open a browser on Linux. Visit `http://127.0.0.1:5000` manually or Ctrl+Click the URL in the terminal.

---

### Verify GPU Detection

After the app starts, check the terminal for a line like:

```
[Chaotics Slice] torch=2.10.0  device=cuda
[Chaotics Slice] torch=2.10.0  device=mps
[Chaotics Slice] torch=2.10.0  device=cpu
```

If you expected GPU but see `cpu`:
- **CUDA**: Verify `nvidia-smi` shows your driver's max CUDA version, and you used the matching `--index-url`
- **Apple Silicon**: Ensure you're running native Python: `python3 -c "import platform; print(platform.machine())"` should output `arm64`

---

## 📹 Using Chaotics Slice

### Workflow

1. **Upload** — Choose a video file (.mp4, .mkv, .mov, .avi, .webm, .m4v, .flv; up to 8 GB)
2. **Configure** — Pick an aggression level or adjust thresholds manually:
   - **Chill** — Keeps more breathing room; fewer cuts
   - **Normal** — Balanced; good for most content
   - **Tight** — Aggressive; minimal silence
   - **Savage** — Maximum cuts; speech-only edit
3. **Preview** — See cuts on the interactive timeline before rendering
4. **Export** — Either:
   - **Video** — Download the sliced video file
   - **Cut List** — Export EDL, FCPXML, or Premiere XML to edit in your NLE

### Supported Formats

**Video:** `.mp4`, `.mkv`, `.mov`, `.avi`, `.webm`, `.m4v`, `.flv`  
**Maximum upload:** 8 GB  
**Export:** Native sliced video or NLE-compatible cut lists

### First Run

On your first upload, Silero VAD downloads its model weights (~2 MB) from PyTorch Hub. This requires an internet connection *once*. After that, the model is cached locally and the app works fully offline.

---

## 🏗️ Architecture (For Developers)

### Project Structure

```
chaotics-slice/
├── app.py                    # Flask app + HTTP routes
├── config.py                 # Constants & VAD mode presets
├── ffmpeg.py                 # FFmpeg wrappers (encode, extract audio)
├── vad.py                    # Silero VAD inference + speech detection
├── jobs.py                   # Job queue, cut computation, EDL/XML export
├── test.py                   # Unit tests
├── requirements.txt          # Python dependencies
├── build.bat / build.sh      # PyInstaller bundling scripts
├── chaotics_slice.spec       # PyInstaller spec file
├── static/
│   ├── index.html            # Single-page UI
│   ├── css/ style.css        # Styling
│   ├── js/                   # Frontend logic (app.js, player.js, etc.)
│   └── res/                  # Logo, icons, assets
├── uploads/                  # Temporary upload directory (auto-cleared)
├── outputs/                  # Temporary output directory (auto-deleted)
└── silero_vad/               # Silero VAD submodule & tuning tools
    ├── src/                  # VAD model loading & inference
    └── tuning/               # Threshold optimization utilities
```

### How It Works

1. **Audio Extraction** — FFmpeg extracts PCM audio (16 kHz, mono) from the video
2. **VAD Inference** — Silero model identifies speech chunks with configurable thresholds
3. **Cut Computation** — Combines speech chunks with padding & silence minimums to generate cuts
4. **Rendering** — FFmpeg re-encodes the video with only the cut segments
5. **Export** — Generate EDL/FCPXML/Premiere XML for NLE import, or output the final video

### Key Parameters (in `config.py`)

```python
MODE_PRESETS = {
    "chill":  {"padding": 350, "min_silence": 600},    # More breathing room
    "normal": {"padding": 200, "min_silence": 300},    # Balanced
    "tight":  {"padding": 80,  "min_silence": 150},    # Aggressive
    "savage": {"padding": 30,  "min_silence": 80},     # Minimal silence
}
```

- **Padding** — Milliseconds of audio to keep around each speech chunk
- **Min Silence** — Minimum silence duration (ms) before cutting

---

## 🔧 Development & Contributing

### Setting up for development

```bash
# Clone and navigate
git clone https://github.com/yourname/chaotics-slice.git
cd chaotics-slice

# Create virtual environment
python3.11 -m venv .venv
source .venv/bin/activate

# Install dev dependencies
pip install -r requirements.txt

# Run tests
python test.py
```

### Building a standalone executable

Uses PyInstaller to bundle the app:

```bash
# macOS / Linux:
bash build.sh

# Windows:
build.bat
```

Output: `dist/Chaotics-Slice.app` (macOS) or `dist/Chaotics-Slice.exe` (Windows)

### Contributing

We welcome bug reports, feature requests, and pull requests! If you're interested in contributing:

1. **Fork** the repository
2. **Create a feature branch** — `git checkout -b feature/your-feature`
3. **Make your changes** and write/update tests
4. **Submit a pull request** with a clear description

**Areas we're looking for help with:**
- [ ] Performance optimizations (VAD inference, FFmpeg encoding)
- [ ] Additional NLE export formats (Avid AAF, Media Composer, etc.)
- [ ] Batch processing mode
- [ ] GUI improvements and accessibility
- [ ] Language/localization support
- [ ] Platform-specific installers (DMG, MSI, deb/rpm packages)

For major features or architectural changes, please open an issue for discussion first.

---

## 🐛 Troubleshooting

| Error | Solution |
|-------|----------|
| `ffmpeg: command not found` | FFmpeg is not on your PATH. Re-check the install step for your platform and open a fresh terminal. |
| `No speech detected` | Try **Chill** mode or lower the **VAD Threshold** slider. Noisy audio or non-speech content (music, B-roll) may cause misdetection. |
| `FFmpeg render failed` | Check the Activity log for details. Common causes: corrupted file, unsupported codec, or disk full. |
| `torchaudio requires torchcodec` | You have torchaudio ≥ 2.9. The app uses stdlib `wave` for audio; this is handled automatically. If you still see it, update to the latest `app.py`. |
| `Port 5000 already in use` | Edit the last line of `app.py` to use a different port: `serve(app, host="127.0.0.1", port=5001)` |
| GPU not detected when expected | Verify CUDA version matches your PyTorch `--index-url`. On Apple Silicon, confirm native Python: `python -c "import platform; print(platform.machine())"` → `arm64` |

---

## 📄 Notes & Caveats

- **Supported audio codecs** — AAC, MP3, FLAC, PCM, Opus, Vorbis. Unusual codecs may cause FFmpeg errors.
- **Silero VAD language** — Trained on multilingual data; works best with clear speech (English, Ukrainian, Russian, and other languages with similar phonetics).
- **GPU memory** — VAD inference is memory-intensive; GPU acceleration is most beneficial on audio files with long, continuous segments.
- **Output file size** — Sliced output is typically 60–80% of the original on podcasts; less on videos with substantial B-roll.

---

## 📜 License

GPL License. See [LICENSE](LICENSE) for details.

---

## 🙏 Credits & Attribution

- **Silero VAD** — VAD model and framework ([github.com/snakers4/silero-vad](https://github.com/snakers4/silero-vad))
- **Flask** — Web framework
- **FFmpeg** — Audio/video processing
- **PyTorch** — ML inference backend

---

## 💬 Questions or Feedback?

- 💡 **Feature request?** Open a GitHub issue.
- 🐛 **Bug?** Describe steps to reproduce; include terminal output and OS/GPU details.
- 💭 **General question?** Start a discussion or check existing issues.
