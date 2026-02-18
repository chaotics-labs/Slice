# ✂ Chaotics Slice — Web App

Web interface for Chaotics Slice, powered by Flask + Silero VAD + FFmpeg.

## Setup

```bash
# 1. Install dependencies
pip install -r requirements.txt

# 2. Make sure ffmpeg is on your PATH
#    https://ffmpeg.org/download.html

# 3. Run
python app.py
```

Then open **http://localhost:5000** in your browser.

---

## Features

- 🎬 Drag & drop video upload (mp4, mkv, mov, avi, webm...)
- 😌⚡🔪 Mode presets: **CHILL / NORMAL / TIGHT / SAVAGE**
- 🔧 Pro settings: custom `--gap`, VAD threshold, min speech duration
- 📟 Real-time log terminal (Server-Sent Events)
- 📊 Stats after processing: % silence removed, segments, durations
- ⬇ Direct download of the sliced video

---

## File Structure

```
chaotic_slice_app/
├── app.py              ← Flask backend
├── requirements.txt
├── templates/
│   └── index.html      ← Frontend UI
├── uploads/            ← Temp upload storage (auto-cleaned)
└── outputs/            ← Processed videos
```

---

## Notes

- Processing happens in a background thread per job
- Upload files are deleted after processing
- Output files stay in `/outputs` until the server restarts
- For production use, add a job cleanup cron and put behind nginx