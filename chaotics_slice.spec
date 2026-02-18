# -*- mode: python ; coding: utf-8 -*-
# ─────────────────────────────────────────────────────────────────────────────
# Chaotics Slice — PyInstaller spec
#
# Build:
#   pyinstaller chaotics_slice.spec
#
# Output:
#   dist/ChaoticSlice          (macOS / Linux binary)
#   dist/ChaoticSlice.exe      (Windows)
#   dist/ChaoticSlice.app      (macOS app bundle — one-dir mode)
# ─────────────────────────────────────────────────────────────────────────────

import sys
import os
from pathlib import Path
from PyInstaller.utils.hooks import collect_data_files, collect_submodules

block_cipher = None

# ── Collect torch hub cache so Silero VAD model is bundled ───────────────────
# We do NOT bundle the model weights — they're tiny and downloaded once to
# ~/.cache/torch/hub on first run.  We DO bundle all torch/torchaudio packages.

# ── Hidden imports ────────────────────────────────────────────────────────────
hidden_imports = [
    'waitress',
    'flask',
    'werkzeug',
    'jinja2',
    'click',
    'torch',
    'torchaudio',
    'wave',
    'array',
    'queue',
    'threading',
    'subprocess',
    'uuid',
    'json',
    'pathlib',
]
hidden_imports += collect_submodules('torch')
hidden_imports += collect_submodules('flask')
hidden_imports += collect_submodules('waitress')

# ── Data files ────────────────────────────────────────────────────────────────
datas = [
    ('static', 'static'),   # HTML / CSS / JS / assets
]
datas += collect_data_files('torch')
datas += collect_data_files('torchaudio')

# ── Analysis ──────────────────────────────────────────────────────────────────
a = Analysis(
    ['app.py'],
    pathex=[],
    binaries=[],
    datas=datas,
    hiddenimports=hidden_imports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        # Trim heavy optional deps that aren't needed
        'matplotlib', 'numpy.distutils', 'IPython', 'notebook',
        'scipy', 'sklearn', 'pandas', 'PIL', 'cv2',
        'tkinter', 'PyQt5', 'PyQt6', 'wx',
    ],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

# ── One-file exe (Windows / Linux) ───────────────────────────────────────────
exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name='ChaoticSlice',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,        # keep console so users can see startup logs / errors
    disable_windowed_traceback=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=None,           # add 'static/res/icon.icns' / 'icon.ico' if you have one
)

# ── macOS .app bundle (one-dir, so assets live inside the bundle) ─────────────
if sys.platform == 'darwin':
    app = BUNDLE(
        exe,
        name='ChaoticSlice.app',
        icon=None,       # add 'static/res/icon.icns' if you have one
        bundle_identifier='org.chaotics.slice',
        info_plist={
            'CFBundleName': 'Chaotics Slice',
            'CFBundleDisplayName': 'Chaotics Slice',
            'CFBundleVersion': '1.2.0',
            'CFBundleShortVersionString': '1.2',
            'NSHighResolutionCapable': True,
            'LSUIElement': False,        # show in Dock
        },
    )
