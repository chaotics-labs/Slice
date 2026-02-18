/* ════════════════════════════════════════════
   Chaotics Slice — App Logic
   ════════════════════════════════════════════ */

'use strict';

// ── State ─────────────────────────────────────────────────────────────────────
var state = {
  fileId:   null,
  jobId:    null,
  duration: 0,
  segments: [],
  mode:     'normal',
  previewTimer: null,
  filename: '',
  currentSegIdx: 0,
  previewActive: false,
  previewJumpTimer: null,
};

var MODE_PRESETS = {
  chill:  { threshold: 0.4, min_speech: 400 },
  normal: { threshold: 0.5, min_speech: 250 },
  tight:  { threshold: 0.6, min_speech: 150 },
  savage: { threshold: 0.7, min_speech: 80  }
};

var MODE_HINTS = {
  chill:  'Natural pauses, gentle pacing',
  normal: 'Balanced cuts with natural pacing',
  tight:  'Aggressive — removes short pauses',
  savage: 'Maximum cuts, no mercy'
};

var MODE_ACCENT = {
  chill:  '--teal',
  normal: '--blue',
  tight:  '--orange',
  savage: '--red'
};

// ── Utils ─────────────────────────────────────────────────────────────────────
function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
function accentCssVar() { return MODE_ACCENT[state.mode]; }
function accentColor()  { return cssVar(accentCssVar()); }
function accentRgb() {
  var hex = accentColor().replace('#', '');
  if (hex.length === 3) hex = hex.split('').map(function(c){ return c+c; }).join('');
  var n = parseInt(hex, 16);
  return [(n>>16)&255, (n>>8)&255, n&255].join(',');
}
function fmtBytes(b) {
  if (b < 1e6) return (b/1024).toFixed(1)+' KB';
  if (b < 1e9) return (b/1e6).toFixed(1)+' MB';
  return (b/1e9).toFixed(2)+' GB';
}
function fmtTime(s) {
  if (s < 0) s = 0;
  var m = Math.floor(s/60), sec = Math.floor(s%60);
  if (m > 0) return m+':'+String(sec).padStart(2,'0');
  return s < 10 ? s.toFixed(1)+'s' : sec+'s';
}

function toTimecode(secs, fps) {
  fps = fps || 25;
  var tf = Math.round(secs * fps);
  var fr = tf % fps;
  var ts = Math.floor(tf / fps);
  var ss = ts % 60, mm = Math.floor(ts/60) % 60, hh = Math.floor(ts/3600);
  return String(hh).padStart(2,'0')+':'+String(mm).padStart(2,'0')+':'+String(ss).padStart(2,'0')+':'+String(fr).padStart(2,'0');
}

function setAccentVars(accentStr) {
  ['thrFill','speechFill','progressFill'].forEach(function(id){
    var el = document.getElementById(id);
    if (el) el.style.background = 'var('+accentStr+')';
  });
  ['thrVal','speechVal'].forEach(function(id){
    var el = document.getElementById(id);
    if (el) el.style.color = 'var('+accentStr+')';
  });
  var btn = document.getElementById('sliceBtn');
  if (btn && !btn.disabled) {
    btn.style.background = 'var('+accentStr+')';
    btn.style.boxShadow  = '0 2px 16px rgba('+accentRgb()+',.38)';
  }
}

// ── Theme ─────────────────────────────────────────────────────────────────────
(function initTheme() {
  function getTheme() {
    try { var s = localStorage.getItem('cs-theme'); if (s==='light'||s==='dark') return s; } catch(_){}
    return window.matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light';
  }
  function applyTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    document.getElementById('iconSun').style.display  = t==='dark'  ? '' : 'none';
    document.getElementById('iconMoon').style.display = t==='light' ? '' : 'none';
  }
  var cur = getTheme();
  applyTheme(cur);
  document.getElementById('themeBtn').addEventListener('click', function() {
    cur = cur==='dark' ? 'light' : 'dark';
    try { localStorage.setItem('cs-theme', cur); } catch(_){}
    applyTheme(cur);
    buildTracks(state.segments, state.duration);
  });
})();

// ── Log ───────────────────────────────────────────────────────────────────────
function pushLog(msg, level) {
  var box = document.getElementById('logBox');
  var ph  = box.querySelector('.log-placeholder');
  if (ph) ph.remove();
  var d = document.createElement('div');
  d.className  = 'log-'+(level||'info');
  d.textContent = msg;
  box.appendChild(d);
  box.scrollTop = box.scrollHeight;
}

function setProgress(pct) {
  var pill = document.getElementById('progressPill');
  var fill = document.getElementById('progressFill');
  if (pct > 0 && pct < 100) {
    pill.style.display = '';
    fill.style.width = pct+'%';
    fill.style.background = 'var('+accentCssVar()+')';
  } else if (pct >= 100) {
    fill.style.width = '100%';
    fill.style.background = 'var(--green)';
    setTimeout(function(){ pill.style.display = 'none'; }, 800);
  } else {
    pill.style.display = 'none';
    fill.style.width = '0%';
  }
}

// ── Sliders ───────────────────────────────────────────────────────────────────
function initSlider(sliderId, fillId, valId, min, max, fmt) {
  var slider = document.getElementById(sliderId);
  var fill   = document.getElementById(fillId);
  var valEl  = document.getElementById(valId);
  function update() {
    var pct = (parseFloat(slider.value)-min)/(max-min)*100;
    fill.style.width  = pct+'%';
    // fill et val en label (noir/blanc) — plus d'accent ici
    valEl.textContent = fmt(slider.value);
  }
  slider.addEventListener('input', function(){ update(); fetchPreview(); });
  return update;
}

var syncThr    = initSlider('thrSlider','thrFill','thrVal',0.1,0.9,function(v){ return parseFloat(v).toFixed(2); });
var syncSpeech = initSlider('speechSlider','speechFill','speechVal',50,800,function(v){ return v+' ms'; });
syncThr(); syncSpeech();

// ── Timeline ──────────────────────────────────────────────────────────────────
function buildRuler(dur) {
  var ruler = document.getElementById('tlRuler');
  ruler.innerHTML = '';
  if (!dur) return;
  var steps = [0.5,1,2,5,10,15,30,60,120,300];
  var step  = steps.find(function(i){ return dur/i <= 10; }) || 300;
  for (var t = 0; t <= dur+0.001; t += step) {
    var pct  = Math.min(t,dur)/dur*100;
    var wrap = document.createElement('div');
    wrap.style.cssText = 'position:absolute;left:'+pct+'%;top:0;bottom:0;';
    var tick = document.createElement('div');
    tick.style.cssText = 'position:absolute;bottom:0;left:0;width:1px;height:6px;background:var(--sep-strong);';
    var lbl = document.createElement('span');
    lbl.style.cssText = 'position:absolute;bottom:1px;left:3px;font-size:9px;color:var(--label-3);white-space:nowrap;font-variant-numeric:tabular-nums;font-family:-apple-system,sans-serif;';
    lbl.textContent = fmtTime(t);
    wrap.appendChild(tick); wrap.appendChild(lbl);
    ruler.appendChild(wrap);
  }
}

function buildTracks(segs, dur) {
  var trackKept = document.getElementById('trackKept');
  var trackCut  = document.getElementById('trackCut');
  [trackKept, trackCut].forEach(function(tr){
    Array.from(tr.children).forEach(function(c){
      if (!c.classList.contains('tl-playhead')) c.remove();
    });
  });
  if (!dur) return;
  var color = accentColor();

  segs.forEach(function(seg, idx) {
    var s = seg[0], e = seg[1];
    var lp = s/dur*100, wp = (e-s)/dur*100;
    if (wp < 0.1) return;
    var clip = document.createElement('div');
    clip.className   = 'tl-clip';
    clip.style.left  = lp+'%';
    clip.style.width = wp+'%';
    clip.style.background = color;
    clip.style.cursor = 'pointer';
    clip.style.pointerEvents = 'auto';
    clip.title = 'Click to preview from this segment';
    clip.dataset.segIdx = idx;
    clip.addEventListener('click', function(ev){
      ev.stopPropagation();
      jumpToSegment(idx);
      if (!state.previewActive) startPreview();
    });
    var lh = document.createElement('div'); lh.className = 'tl-clip-handle left';
    var rh = document.createElement('div'); rh.className = 'tl-clip-handle right';
    clip.appendChild(lh); clip.appendChild(rh);
    trackKept.appendChild(clip);
  });

  // Gaps
  var gaps = [];
  if (segs.length === 0) {
    gaps.push([0, dur]);
  } else {
    if (segs[0][0] > 0.1) gaps.push([0, segs[0][0]]);
    for (var i = 0; i < segs.length-1; i++) gaps.push([segs[i][1], segs[i+1][0]]);
    if (segs[segs.length-1][1] < dur-0.1) gaps.push([segs[segs.length-1][1], dur]);
  }
  gaps.forEach(function(gap){
    var s = gap[0], e = gap[1];
    var lp = s/dur*100, wp = (e-s)/dur*100;
    if (wp < 0.1) return;
    var g = document.createElement('div');
    g.className = 'tl-gap';
    g.style.left  = lp+'%';
    g.style.width = wp+'%';
    if (wp > 3) {
      var lbl = document.createElement('span');
      lbl.className  = 'tl-gap-label';
      lbl.textContent = fmtTime(e-s);
      g.appendChild(lbl);
    }
    trackCut.appendChild(g);
  });
}

function showTimeline(segs, dur) {
  state.segments = segs || [];
  state.duration = dur  || 0;
  document.getElementById('tlEmpty').style.display = 'none';
  document.getElementById('tlBody').style.display  = '';
  document.getElementById('tlAxisEnd').textContent = fmtTime(dur);
  document.getElementById('tlAxisMid').textContent = fmtTime(dur/2);
  buildRuler(dur);
  buildTracks(segs, dur);
}

function updateTimelineMeta(stats) {
  var pctChip  = document.getElementById('tlChipPct');
  var segsChip = document.getElementById('tlChipSegs');
  pctChip.textContent  = '-'+stats.pct_removed+'%';
  pctChip.style.display = '';
  pctChip.style.background = 'rgba('+accentRgb()+',.12)';
  pctChip.style.color = 'var('+accentCssVar()+')';
  segsChip.textContent  = stats.segments+' segs';
  segsChip.style.display = '';
  document.getElementById('tlDurLabel').textContent = fmtTime(stats.original_duration);
}

// ── Timeline hover ────────────────────────────────────────────────────────────
(function initTimelineHover(){
  var tooltip = document.getElementById('tlTooltip');
  function onMove(e){
    var track = e.currentTarget;
    var rect  = track.getBoundingClientRect();
    var pct   = Math.max(0, Math.min(1, (e.clientX-rect.left)/rect.width));
    var t     = pct * state.duration;
    ['phKept','phCut'].forEach(function(id){
      var ph = document.getElementById(id);
      ph.style.display = '';
      ph.style.left = (pct*100)+'%';
    });
    var inSeg = state.segments.find(function(s){ return t>=s[0]&&t<=s[1]; });
    var color = accentColor();
    tooltip.innerHTML =
      '<span class="tl-tt-dot" style="background:'+(inSeg?color:'var(--label-3)')+'"></span>'+
      fmtTime(t)+' &middot; '+
      (inSeg ? '<b style="color:'+color+'">kept</b>' : '<span style="color:var(--label-3)">cut</span>');
    tooltip.classList.add('show');
    var tx = e.clientX - tooltip.offsetWidth/2;
    var ty = e.clientY - 40;
    tx = Math.max(8, Math.min(tx, window.innerWidth-tooltip.offsetWidth-8));
    tooltip.style.left = tx+'px';
    tooltip.style.top  = ty+'px';
  }
  function onLeave(){
    tooltip.classList.remove('show');
    document.querySelectorAll('.tl-playhead').forEach(function(p){ p.style.display='none'; });
  }
  ['trackKept','trackCut'].forEach(function(id){
    var el = document.getElementById(id);
    el.addEventListener('mousemove', onMove);
    el.addEventListener('mouseleave', onLeave);
  });
})();

// ── Upload ────────────────────────────────────────────────────────────────────
var dropZone  = document.getElementById('dropZone');
var fileInput = document.getElementById('fileInput');
var fileChip  = document.getElementById('fileChip');

fileInput.addEventListener('change', function(){ if (fileInput.files[0]) uploadFile(fileInput.files[0]); });
dropZone.addEventListener('dragover', function(e){ e.preventDefault(); dropZone.classList.add('drag'); });
dropZone.addEventListener('dragleave', function(){ dropZone.classList.remove('drag'); });
dropZone.addEventListener('drop', function(e){
  e.preventDefault(); dropZone.classList.remove('drag');
  if (e.dataTransfer.files[0]) uploadFile(e.dataTransfer.files[0]);
});
document.getElementById('chipClear').addEventListener('click', resetState);

function resetState() {
  state.fileId = null; state.jobId = null;
  state.duration = 0; state.segments = []; state.filename = '';
  db.stop();
  fileChip.classList.remove('show');
  dropZone.style.display = '';
  document.getElementById('sliceBtn').disabled = true;
  document.getElementById('tlEmpty').style.display = '';
  document.getElementById('tlBody').style.display  = 'none';
  document.getElementById('tlChipPct').style.display  = 'none';
  document.getElementById('tlChipSegs').style.display = 'none';
  document.getElementById('tlDurLabel').textContent   = '';
  document.getElementById('statsCard').style.display  = 'none';
  document.getElementById('logBox').innerHTML = '<span class="log-placeholder">Waiting for input…</span>';
  setProgress(0);
  renderActions('idle');
  var vp = document.getElementById('videoPreviewCard');
  if (vp) vp.style.display = 'none';
  var ec = document.getElementById('exportCard');
  if (ec) ec.style.display = 'none';
}

var _videoObjectUrl = null;

async function uploadFile(f) {
  dropZone.style.display = 'none';
  fileChip.classList.add('show');
  document.getElementById('chipName').textContent = f.name;
  document.getElementById('chipSize').textContent = fmtBytes(f.size);
  document.getElementById('chipIcon').innerHTML   = '<div class="spin" style="color:var(--accent)"></div>';
  document.getElementById('logBox').innerHTML = '';
  state.filename = f.name.replace(/\.[^.]+$/, '');
  pushLog('Uploading '+f.name+'…');

  if (_videoObjectUrl) URL.revokeObjectURL(_videoObjectUrl);
  _videoObjectUrl = URL.createObjectURL(f);

  var fd = new FormData();
  fd.append('video', f);
  try {
    var res  = await fetch('/api/upload', { method: 'POST', body: fd });
    var data = await res.json();
    if (!res.ok) throw new Error(data.error);
    state.fileId   = data.file_id;
    state.duration = data.duration;
    document.getElementById('chipIcon').innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="15" rx="2"/><polyline points="17 2 12 7 7 2"/></svg>';
    document.getElementById('chipIcon').style.color = 'var(--accent)';
    setupVideoPreview(_videoObjectUrl);
    pushLog('Ready — '+fmtTime(data.duration)+' detected', 'success');
    document.getElementById('sliceBtn').disabled = false;
    setAccentVars(accentCssVar());
    fetchPreview();
  } catch(e) {
    pushLog('Upload failed: '+e.message, 'error');
    document.getElementById('chipIcon').innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--red)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// ── Double-Buffer Video Engine ────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════
//
// Two <video> elements stacked absolutely inside the same container.
// Both share the same object URL. We use opacity (not display:none) so the
// browser keeps the hidden buffer alive and decoded.
//
// While buffer A plays, buffer B silently seeks to the next segment start.
// On cut: swap opacity in one frame — no black flash, no reflow, no zoom.
//
var db = (function () {
  var _els      = [null, null];
  var _active   = 0;            // index of the currently visible buffer
  var _ready    = [false, false]; // has each idle buffer finished its preseek?

  function _idle() { return 1 - _active; }

  // ── Init: grab existing <video> as slot 0, create slot 1 ─────────────────
  function _init() {
    var ref = document.getElementById('previewVideo');
    var container = ref.parentNode;

    // Make container a stacking context
    container.style.position = 'relative';
    container.style.overflow = 'hidden';
    // Give the container an explicit height if it has none (prevents collapse)
    if (!container.style.height && container.offsetHeight === 0) {
      container.style.height = ref.style.height || '100%';
    }

    _els[0] = ref;
    _els[1] = document.createElement('video');

    // Apply identical base styles to both elements
    [0, 1].forEach(function (i) {
      var el = _els[i];
      el.style.position   = 'absolute';
      el.style.top        = '0';
      el.style.left       = '0';
      el.style.width      = '100%';
      el.style.height     = '100%';
      el.style.objectFit  = 'contain';   // ← no zoom / crop
      el.style.background = 'transparent'; // ← no black rectangle
      el.preload          = 'auto';
      el.style.transition = 'opacity 0.05s linear';
    });

    _els[0].style.opacity = '1';
    _els[1].style.opacity = '0';
    container.appendChild(_els[1]);

    // Shared event listeners
    [0, 1].forEach(function (i) {
      _els[i].addEventListener('timeupdate', function () {
        if (i !== _active) return;
        if (!state.duration) return;
        var pct = _els[i].currentTime / state.duration * 100;
        var ph  = document.getElementById('pvPlayheadBar');
        if (ph) ph.style.left = pct + '%';
      });
      _els[i].addEventListener('ended', function () {
        if (i !== _active) return;
        state.previewActive = false;
        updatePreviewUI();
      });
    });
  }

  // ── Load: set the same src on both buffers ────────────────────────────────
  function load(src) {
    _ready  = [false, false];
    _active = 0;
    [0, 1].forEach(function (i) {
      _els[i].src = src;
      _els[i].load();
    });
    _els[0].style.opacity = '1';
    _els[1].style.opacity = '0';
  }

  // ── Preseek: silently move idle buffer to segment start ───────────────────
  function preseek(idx) {
    if (!state.segments[idx]) return;
    var i  = _idle();
    var t  = state.segments[idx][0];
    _ready[i] = false;

    function doSeek() {
      _els[i].currentTime = t;
    }

    if (_els[i].readyState >= 1) {
      doSeek();
    } else {
      _els[i].addEventListener('loadedmetadata', function onMeta() {
        _els[i].removeEventListener('loadedmetadata', onMeta);
        doSeek();
      });
    }

    _els[i].addEventListener('seeked', function onSeeked() {
      _els[i].removeEventListener('seeked', onSeeked);
      _ready[i] = true;
    });
  }

  // ── Seek: move active buffer directly (for manual scrub without swap) ─────
  function seek(t) {
    _els[_active].currentTime = t;
  }

  // ── Cut: swap to idle buffer at segment idx, call cb when playing ─────────
  function cut(idx, cb) {
    if (!state.segments[idx]) return;
    var i      = _idle();
    var target = state.segments[idx][0];

    function doSwap() {
      // Atomic visual swap
      _els[_active].style.opacity = '0';
      _els[i].style.opacity       = '1';
      _els[_active].pause();
      _active = i;

      state.currentSegIdx = idx;
      updateSegCounter();
      highlightActiveClip(idx);

      _els[_active].play().then(function () {
        if (cb) cb();
        preseek(idx + 1);   // start preseek for the segment after this one
      }).catch(function (e) {
        pushLog('Preview error: ' + e.message, 'error');
        state.previewActive = false;
        updatePreviewUI();
      });
    }

    if (_ready[i]) {
      // Best case: idle buffer already seeked — instant swap
      doSwap();
    } else {
      // Fallback: seek idle now, swap on seeked event (or timeout)
      var done = false;

      function onSeeked() {
        if (done) return;
        done = true;
        _els[i].removeEventListener('seeked', onSeeked);
        _ready[i] = true;
        doSwap();
      }

      _els[i].addEventListener('seeked', onSeeked);

      if (_els[i].readyState >= 1) {
        _els[i].currentTime = target;
      } else {
        _els[i].addEventListener('loadedmetadata', function onMeta() {
          _els[i].removeEventListener('loadedmetadata', onMeta);
          _els[i].currentTime = target;
        });
      }

      // Safety net: if seeking takes > 400ms, seek active buffer instead
      setTimeout(function () {
        if (done) return;
        done = true;
        _els[i].removeEventListener('seeked', onSeeked);
        // Give up on swap, just seek the active buffer
        _els[_active].currentTime = target;
        state.currentSegIdx = idx;
        updateSegCounter();
        highlightActiveClip(idx);
        if (cb) cb();
        preseek(idx + 1);
      }, 400);
    }
  }

  function play()        { return _els[_active].play(); }
  function pause()       { _els[_active].pause(); }
  function currentTime() { return _els[_active].currentTime; }

  function stop() {
    [0, 1].forEach(function (i) {
      if (_els[i]) { _els[i].pause(); _els[i].removeAttribute('src'); _els[i].load(); }
    });
    _ready = [false, false];
  }

  _init();

  return { load: load, preseek: preseek, seek: seek, cut: cut, play: play, pause: pause, currentTime: currentTime, stop: stop };
})();

// ── Video Preview Player ───────────────────────────────────────────────────────
function setupVideoPreview(objectUrl) {
  var card = document.getElementById('videoPreviewCard');
  card.style.display = '';
  state.currentSegIdx = 0;
  state.previewActive = false;
  db.load(objectUrl);
  updatePreviewUI();
}

function jumpToSegment(idx) {
  if (!state.segments.length) return;
  idx = Math.max(0, Math.min(idx, state.segments.length - 1));

  if (state.previewActive) {
    clearTimeout(state.previewJumpTimer);
    db.cut(idx, function () { scheduleNextJump(idx); });
  } else {
    state.currentSegIdx = idx;
    db.seek(state.segments[idx][0]);
    updateSegCounter();
    highlightActiveClip(idx);
    db.preseek(idx + 1);
  }
}

function scheduleNextJump(idx) {
  clearTimeout(state.previewJumpTimer);
  if (!state.previewActive) return;

  var endTime = state.segments[idx][1];

  function checkEnd() {
    if (!state.previewActive) return;
    if (db.currentTime() >= endTime - 0.05) {
      var next = idx + 1;
      if (next < state.segments.length) {
        db.cut(next, function () { scheduleNextJump(next); });
      } else {
        state.previewActive = false;
        updatePreviewUI();
        highlightActiveClip(-1);
      }
      return;
    }
    state.previewJumpTimer = setTimeout(checkEnd, 40);
  }

  state.previewJumpTimer = setTimeout(checkEnd, 40);
}

function startPreview() {
  if (!state.segments.length) return;
  state.previewActive = true;
  updatePreviewUI();

  var idx = state.currentSegIdx;
  db.seek(state.segments[idx][0]);
  db.preseek(idx + 1);

  db.play().then(function () {
    scheduleNextJump(idx);
  }).catch(function (e) {
    pushLog('Preview error: ' + e.message, 'error');
    state.previewActive = false;
    updatePreviewUI();
  });
}

function pausePreview() {
  state.previewActive = false;
  clearTimeout(state.previewJumpTimer);
  db.pause();
  updatePreviewUI();
}

function stopVideoPreview() {
  state.previewActive = false;
  clearTimeout(state.previewJumpTimer);
  db.stop();
  updatePreviewUI();
}

function updatePreviewUI() {
  var playBtn  = document.getElementById('pvPlayBtn');
  var pauseBtn = document.getElementById('pvPauseBtn');
  if (!playBtn) return;
  playBtn.style.display  = state.previewActive ? 'none' : '';
  pauseBtn.style.display = state.previewActive ? '' : 'none';
  updateSegCounter();
}

function updateSegCounter() {
  var counter = document.getElementById('pvSegCounter');
  if (!counter) return;
  if (!state.segments.length) { counter.textContent = 'No cuts yet'; return; }
  counter.textContent = 'Seg ' + (state.currentSegIdx + 1) + ' / ' + state.segments.length;
}

function highlightActiveClip(idx) {
  document.querySelectorAll('.tl-clip').forEach(function (clip, i) {
    clip.style.outline       = (i === idx) ? '2px solid rgba(255,255,255,.85)' : '';
    clip.style.outlineOffset = (i === idx) ? '2px' : '';
  });
}

// ── Preview ───────────────────────────────────────────────────────────────────
function fetchPreview() {
  if (!state.fileId) return;
  clearTimeout(state.previewTimer);
  state.previewTimer = setTimeout(async function () {
    try {
      var res  = await fetch('/api/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          file_id:    state.fileId,
          mode:       state.mode,
          threshold:  parseFloat(document.getElementById('thrSlider').value),
          min_speech: parseInt(document.getElementById('speechSlider').value)
        })
      });
      var data = await res.json();
      if (data.ok && data.stats) {
        showTimeline(data.stats.segments_list, data.stats.original_duration);
        updateTimelineMeta(data.stats);
        showExportCard();
      }
    } catch (_) {}
  }, 360);
}

function showExportCard() {
  if (!state.segments.length) return;
  var ec = document.getElementById('exportCard');
  if (ec) ec.style.display = '';
}

// ── Mode selector ─────────────────────────────────────────────────────────────
document.getElementById('modeSelector').addEventListener('click', function (e) {
  var btn = e.target.closest('.seg-btn');
  if (!btn) return;
  document.querySelectorAll('.seg-btn').forEach(function (b) { b.classList.remove('active'); });
  btn.classList.add('active');
  state.mode = btn.dataset.mode;
  var preset = MODE_PRESETS[state.mode];
  document.getElementById('thrSlider').value    = preset.threshold;
  document.getElementById('speechSlider').value = preset.min_speech;
  syncThr(); syncSpeech();
  document.getElementById('modeHint').textContent = MODE_HINTS[state.mode];
  setAccentVars(accentCssVar());
  buildTracks(state.segments, state.duration);
  fetchPreview();
});

// ── Pro toggle ────────────────────────────────────────────────────────────────
document.getElementById('proToggle').addEventListener('click', function () {
  var panel    = document.getElementById('proPanel');
  var expanded = this.getAttribute('aria-expanded') === 'true';
  this.setAttribute('aria-expanded', String(!expanded));
  if (expanded) panel.setAttribute('hidden', ''); else panel.removeAttribute('hidden');
});

// ── Slice ──────────────────────────────────────────────────────────────────────
document.getElementById('actionArea').addEventListener('click', function (e) {
  if (e.target.closest('#sliceBtn')) doSlice();
});

async function doSlice() {
  if (!state.fileId) return;
  var sb = document.getElementById('sliceBtn');
  sb.disabled = true;
  document.getElementById('statsCard').style.display = 'none';
  document.getElementById('logBox').innerHTML = '';
  setProgress(5);
  pushLog('Starting job…');
  try {
    var res  = await fetch('/api/process', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        file_id:    state.fileId,
        mode:       state.mode,
        threshold:  parseFloat(document.getElementById('thrSlider').value),
        min_speech: parseInt(document.getElementById('speechSlider').value)
      })
    });
    var data = await res.json();
    if (!res.ok) throw new Error(data.error);
    state.jobId = data.job_id;
    var sse = new EventSource('/api/logs/' + state.jobId);
    sse.onmessage = function (e) {
      var item = JSON.parse(e.data);
      if (item.done) { sse.close(); return; }
      pushLog(item.msg, item.level);
    };
    var poll = setInterval(async function () {
      try {
        var sr = await fetch('/api/status/' + state.jobId);
        var sd = await sr.json();
        setProgress(sd.progress || 0);
        if (sd.status === 'done') {
          clearInterval(poll);
          onJobDone(sd.stats);
        } else if (sd.status === 'error') {
          clearInterval(poll);
          pushLog(sd.error || 'An error occurred', 'error');
          sb.disabled = false;
        }
      } catch (_) {}
    }, 600);
  } catch (e) {
    pushLog('Error: ' + e.message, 'error');
    document.getElementById('sliceBtn').disabled = false;
  }
}

function onJobDone(stats) {
  setProgress(100);
  if (stats) {
    showTimeline(stats.segments_list, stats.original_duration);
    updateTimelineMeta(stats);
    var accent = 'var(' + accentCssVar() + ')';
    document.getElementById('statPct').textContent  = stats.pct_removed + '%';
    document.getElementById('statPct').style.color  = accent;
    document.getElementById('statCut').textContent  = fmtTime(stats.removed);
    document.getElementById('statCut').style.color  = accent;
    document.getElementById('statSegs').textContent = stats.segments;
    document.getElementById('statSegs').style.color = accent;
    document.getElementById('statsCard').style.display = '';
    showExportCard();
  }
  renderActions('done');
}

// ── Actions ───────────────────────────────────────────────────────────────────
function renderActions(phase) {
  var area = document.getElementById('actionArea');
  if (phase === 'done') {
    area.innerHTML =
      '<a href="/api/download/' + state.jobId + '" class="btn-primary btn-download">' +
        '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>' +
        'Download' +
      '</a>' +
      '<button class="btn-secondary" id="againBtn">Process Another File</button>';
    document.getElementById('againBtn').addEventListener('click', function () {
      document.getElementById('statsCard').style.display = 'none';
      setProgress(0);
      document.getElementById('logBox').innerHTML = '<span class="log-placeholder">Ready.</span>';
      renderActions('idle');
    });
  } else {
    var av = 'var(' + accentCssVar() + ')';
    area.innerHTML =
      '<button class="btn-primary" id="sliceBtn"' + (state.fileId ? '' : ' disabled') + ' style="background:' + av + ';box-shadow:0 2px 16px rgba(' + accentRgb() + ',.38)">' +
        '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4 8.12 15.88M14.47 14.48 20 20M8.12 8.12 12 12"/></svg>' +
        'Slice' +
      '</button>';
  }
}

// ── Export: EDL ───────────────────────────────────────────────────────────────
function exportEDL() {
  if (!state.segments.length) return;
  var fps = 25, name = state.filename || 'ChaoticSlice';
  var lines = ['TITLE: ' + name + '_cuts', 'FCM: NON-DROP FRAME', ''];
  var recStart = 0;
  state.segments.forEach(function (seg, i) {
    var sIn = seg[0], sOut = seg[1], dur = sOut - sIn;
    var num = String(i + 1).padStart(3, '0');
    lines.push(num + '  AX       AA/V  C        ' + toTimecode(sIn, fps) + ' ' + toTimecode(sOut, fps) + ' ' + toTimecode(recStart, fps) + ' ' + toTimecode(recStart + dur, fps));
    lines.push('* FROM CLIP NAME: ' + name + '.mp4');
    lines.push('');
    recStart += dur;
  });
  downloadText(lines.join('\n'), name + '_cuts.edl', 'text/plain');
  pushLog('EDL exported — DaVinci Resolve / Avid compatible (25fps)', 'success');
}

// ── Export: FCPXML ────────────────────────────────────────────────────────────
function exportFCPXML() {
  if (!state.segments.length) return;
  var fps = 25, name = state.filename || 'ChaoticSlice';
  var totalDur = state.segments.reduce(function (a, s) { return a + (s[1] - s[0]); }, 0);
  function rat(s) { return Math.round(s * fps) + '/' + fps + 's'; }
  var clips = '', off = 0;
  state.segments.forEach(function (seg, i) {
    var sIn = seg[0], sOut = seg[1], dur = sOut - sIn;
    clips +=
      '      <clip name="' + name + '_clip' + (i + 1) + '" offset="' + rat(off) + '" duration="' + rat(dur) + '" start="' + rat(sIn) + '">\n' +
      '        <video ref="r1" offset="' + rat(sIn) + '" duration="' + rat(dur) + '" start="' + rat(sIn) + '"/>\n' +
      '        <audio ref="r1" offset="' + rat(sIn) + '" duration="' + rat(dur) + '" start="' + rat(sIn) + '" role="dialogue"/>\n' +
      '      </clip>\n';
    off += dur;
  });
  var xml =
    '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE fcpxml>\n<fcpxml version="1.10">\n' +
    '  <resources>\n' +
    '    <format id="r0" name="FFVideoFormat1080p25" frameDuration="1/' + fps + 's" width="1920" height="1080"/>\n' +
    '    <asset id="r1" name="' + name + '" src="file:///' + name + '.mp4" duration="' + rat(state.duration) + '" hasVideo="1" hasAudio="1" audioSources="1" audioChannels="2" audioRate="48000"/>\n' +
    '  </resources>\n' +
    '  <library>\n    <event name="' + name + '_cuts">\n' +
    '      <project name="' + name + '_cuts">\n' +
    '        <sequence duration="' + rat(totalDur) + '" format="r0" tcStart="0s" tcFormat="NDF" audioLayout="stereo" audioRate="48k">\n' +
    '          <spine>\n' + clips +
    '          </spine>\n        </sequence>\n      </project>\n    </event>\n  </library>\n</fcpxml>\n';
  downloadText(xml, name + '_cuts.fcpxml', 'application/xml');
  pushLog('FCPXML exported — Final Cut Pro / DaVinci Resolve XML', 'success');
}

// ── Export: Premiere Pro XML ──────────────────────────────────────────────────
function exportPremierePro() {
  if (!state.segments.length) return;
  var fps = 25, name = state.filename || 'ChaoticSlice';
  function fr(s) { return Math.round(s * fps); }
  var items = '', aItems = '', trackStart = 0;
  state.segments.forEach(function (seg, i) {
    var sIn = seg[0], sOut = seg[1], dur = sOut - sIn;
    var v =
      '      <clipitem id="clipitem-' + (i + 1) + '">\n' +
      '        <name>' + name + '_' + (i + 1) + '</name>\n' +
      '        <in>' + fr(sIn) + '</in><out>' + fr(sOut) + '</out>\n' +
      '        <start>' + fr(trackStart) + '</start><end>' + fr(trackStart + dur) + '</end>\n' +
      '        <file id="file-1"/>\n' +
      '      </clipitem>\n';
    items  += v;
    aItems += v.replace(/clipitem-/g, 'audioclip-');
    trackStart += dur;
  });
  var xml =
    '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE xmeml>\n<xmeml version="4">\n' +
    '  <sequence>\n    <name>' + name + '_cuts</name>\n' +
    '    <rate><timebase>' + fps + '</timebase><ntsc>FALSE</ntsc></rate>\n' +
    '    <media>\n' +
    '      <video><track>\n' + items + '      </track></video>\n' +
    '      <audio><track>\n' + aItems + '      </track></audio>\n' +
    '    </media>\n' +
    '    <file id="file-1">\n' +
    '      <name>' + name + '</name>\n' +
    '      <pathurl>file:///' + name + '.mp4</pathurl>\n' +
    '      <rate><timebase>' + fps + '</timebase><ntsc>FALSE</ntsc></rate>\n' +
    '      <duration>' + fr(state.duration) + '</duration>\n' +
    '      <media><video/><audio/></media>\n' +
    '    </file>\n  </sequence>\n</xmeml>\n';
  downloadText(xml, name + '_cuts.xml', 'application/xml');
  pushLog('Premiere Pro XML exported (XMEML v4)', 'success');
}

function downloadText(content, filename, mimeType) {
  var blob = new Blob([content], { type: mimeType });
  var url  = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
}

// ── Wire up controls ──────────────────────────────────────────────────────────
(function wireControls() {
  function wire(id, fn) { var el = document.getElementById(id); if (el) el.addEventListener('click', fn); }
  wire('pvPlayBtn',    function () { if (state.segments.length) startPreview(); });
  wire('pvPauseBtn',   pausePreview);
  wire('pvPrevBtn',    function () { jumpToSegment(state.currentSegIdx - 1); });
  wire('pvNextBtn',    function () { jumpToSegment(state.currentSegIdx + 1); });
  wire('exportEdlBtn', exportEDL);
  wire('exportFcpBtn', exportFCPXML);
  wire('exportPpBtn',  exportPremierePro);
})();