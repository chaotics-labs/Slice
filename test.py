import sys, os
sys.path.insert(0, '.')
print('Python:', sys.version)

print('Testing flask...')
from flask import Flask
print('  OK')

print('Testing torch...')
import torch
print('  OK:', torch.__version__)

print('Testing waitress...')
from waitress import serve
print('  OK')

print('Testing ffmpeg detection...')
import shutil
print('  ffmpeg:', shutil.which('ffmpeg') or 'NOT FOUND in PATH')
import pathlib
local = pathlib.Path('ffmpeg.exe')
print('  ffmpeg.exe next to app.py:', local.exists())