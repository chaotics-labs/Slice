# Chaotics Slice ✂

> AI-powered silence remover for video editors.  
> Detects speech with Silero VAD and cuts silences — locally, no cloud, no subscription.

---

## What it does

Upload a video, pick an aggression level (Chill → Savage), and Chaotics Slice automatically detects every moment of speech and cuts everything else out. Preview the cuts on the timeline before rendering, then export the sliced video or a cut list (EDL / FCPXML / Premiere XML) straight into your NLE.

---

## Requirements (all platforms)

| Dependency | Version | Notes |
|---|---|---|
| Python | 3.10 – 3.12 | 3.13 not yet tested |
| FFmpeg + FFprobe | 6+ | Must be on `PATH` |
| PyTorch | 2.x | CPU build works; GPU optional |
| torchaudio | any | Only used for version detection |

GPU acceleration is **optional** — the app auto-detects CUDA (NVIDIA) and MPS (Apple Silicon) at startup and falls back to CPU silently.

---

## macOS

### 1. Install system dependencies

```bash
# Install Homebrew if you don't have it
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

brew install python@3.11 ffmpeg
```

### 2. Clone and set up a virtual environment

```bash
git clone https://github.com/yourname/chaotics-slice.git
cd chaotics-slice

python3.11 -m venv .venv
source .venv/bin/activate
```

### 3. Install Python dependencies

**Apple Silicon (M1/M2/M3) — MPS GPU acceleration:**
```bash
pip install --upgrade pip
pip install torch torchvision torchaudio
pip install flask waitress
```

**Intel Mac — CPU only:**
```bash
pip install --upgrade pip
pip install torch torchvision torchaudio
pip install flask waitress
```

> Both use the same PyTorch package on macOS. MPS is auto-detected at runtime on Apple Silicon.

### 4. Run

```bash
source .venv/bin/activate   # if not already active
python app.py
```

The app opens automatically in your default browser at `http://127.0.0.1:5000`.

---

## Windows

### 1. Install Python

Download Python 3.11 from [python.org](https://www.python.org/downloads/windows/).  
✅ Check **"Add Python to PATH"** during install.

### 2. Install FFmpeg

1. Download a build from [ffmpeg.org/download.html](https://ffmpeg.org/download.html) (e.g. the gyan.dev full build)
2. Extract to `C:\ffmpeg`
3. Add `C:\ffmpeg\bin` to your **System PATH**:  
   *Control Panel → System → Advanced → Environment Variables → Path → Edit → New*
4. Verify: open a new terminal and run `ffmpeg -version`

### 3. Clone and set up a virtual environment

```powershell
git clone https://github.com/yourname/chaotics-slice.git
cd chaotics-slice

python -m venv .venv
.venv\Scripts\activate
```

### 4. Install Python dependencies

**NVIDIA GPU (CUDA 12.1):**
```powershell
pip install --upgrade pip
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121
pip install flask waitress
```

**CPU only:**
```powershell
pip install --upgrade pip
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cpu
pip install flask waitress
```

> Find the correct `--index-url` for your CUDA version at [pytorch.org/get-started/locally](https://pytorch.org/get-started/locally/).

### 5. Run

```powershell
.venv\Scripts\activate   # if not already active
python app.py
```

The browser opens automatically at `http://127.0.0.1:5000`.

---

## Ubuntu / Debian

### 1. Install system dependencies

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

### 2. Clone and set up a virtual environment

```bash
git clone https://github.com/yourname/chaotics-slice.git
cd chaotics-slice

python3.11 -m venv .venv
source .venv/bin/activate
```

### 3. Install Python dependencies

**NVIDIA GPU (CUDA 12.1):**
```bash
pip install --upgrade pip
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121
pip install flask waitress
```

**CPU only:**
```bash
pip install --upgrade pip
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cpu
pip install flask waitress
```

> The app won't open a browser automatically on Linux. After starting, visit `http://127.0.0.1:5000` manually or Ctrl+Click the URL printed in the terminal.

### 4. Run

```bash
source .venv/bin/activate   # if not already active
python app.py
```

---

## Verifying GPU is detected

When the app starts you'll see a line like:

```
[Chaotics Slice] torch=2.3.0  device=cuda
[Chaotics Slice] torch=2.3.0  device=mps
[Chaotics Slice] torch=2.3.0  device=cpu
```

If you expected GPU but see `cpu`, check that:
- Your CUDA version matches the `--index-url` you used to install PyTorch (`nvidia-smi` shows your driver's max CUDA version)
- On Apple Silicon, you're running native Python (not Rosetta): `python3 -c "import platform; print(platform.machine())"` should print `arm64`

---

## First-run note

On the very first video you process, Silero VAD downloads its model weights (~2 MB) from PyTorch Hub. This requires an internet connection once. After that, the model is cached locally and the app works fully offline.

---

## Supported video formats

`.mp4` `.mkv` `.mov` `.avi` `.webm` `.m4v` `.flv`

Maximum upload size: **4 GB**

---

## Project structure

```
chaotics-slice/
├── app.py              # Flask backend + VAD logic
├── static/
│   ├── index.html      # Single-page UI
│   ├── css/
│   │   └── style.css
│   ├── js/
│   │   └── app.js
│   └── res/            # Logo, icons
├── uploads/            # Temp — auto-cleared on each new upload
└── outputs/            # Temp — auto-deleted after download
```

---

## Troubleshooting

**`ffmpeg: command not found`**  
FFmpeg is not on your PATH. Re-check the install step for your platform and open a fresh terminal.

**`No speech detected`**  
Try switching to **Chill** mode or lowering the VAD Threshold slider. Very noisy audio or non-speech content (music, B-roll) can cause this.

**`FFmpeg render failed`**  
The full error is printed in the Activity log. Common causes: corrupted source file, unsupported codec, or disk full.

**`torchaudio … requires torchcodec`**  
You have torchaudio ≥ 2.9. This is handled automatically — the app uses stdlib `wave` for audio loading and does not call torchaudio's file I/O. If you still see this error it means an old `app.py` is running; pull the latest version.

**Port 5000 already in use**  
Another process is on 5000. Either stop it, or edit the last line of `app.py` to use a different port:
```python
serve(app, host="127.0.0.1", port=5001)
```

---
