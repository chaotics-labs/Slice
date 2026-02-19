/* state.js — Shared application state and mode constants */
'use strict';

var state = {
  fileId:          null,
  jobId:           null,
  duration:        0,
  segments:        [],
  mode:            'normal',
  filename:        '',
  currentSegIdx:   0,
  previewActive:   false,
  previewTimer:    null,
  previewJumpTimer: null,
};

var jobs_done = {};   // jobId → true once download is available

var MODE_PRESETS = {
  chill:  { threshold: 0.4, min_speech: 400 },
  normal: { threshold: 0.5, min_speech: 250 },
  tight:  { threshold: 0.6, min_speech: 150 },
  savage: { threshold: 0.7, min_speech: 80  },
};

var MODE_HINTS = {
  chill:  'Natural pauses, gentle pacing',
  normal: 'Balanced cuts with natural pacing',
  tight:  'Aggressive — removes short pauses',
  savage: 'Maximum cuts, no mercy',
};

var MODE_ACCENT_VARS = {
  chill:  { color: 'var(--teal)',   rgb: '50,173,230'  },
  normal: { color: 'var(--blue)',   rgb: '0,122,255'   },
  tight:  { color: 'var(--orange)', rgb: '255,149,0'   },
  savage: { color: 'var(--red)',    rgb: '255,59,48'   },
};
