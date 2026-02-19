/* main.js — Top-level wiring: file loading, sliders, mode selector, job lifecycle */
'use strict';

// ── Slider init ───────────────────────────────────────────────────────────────
function initSlider(sliderId, fillId, valId, min, max, fmt) {
  var sl = document.getElementById(sliderId);
  var fi = document.getElementById(fillId);
  var va = document.getElementById(valId);

  function update() {
    fi.style.width  = ((parseFloat(sl.value) - min) / (max - min) * 100) + '%';
    va.textContent  = fmt(sl.value);
  }
  sl.addEventListener('input', function () { update(); fetchPreview(); });
  return update;
}

var syncThr    = initSlider('thrSlider',    'thrFill',    'thrVal',    0.1, 0.9, function (v) { return parseFloat(v).toFixed(2); });
var syncSpeech = initSlider('speechSlider', 'speechFill', 'speechVal', 50,  800, function (v) { return v + ' ms'; });
syncThr(); syncSpeech();

// ── Mode selector ─────────────────────────────────────────────────────────────
document.getElementById('modeSelector').addEventListener('click', function (e) {
  var btn = e.target.closest('.seg-btn');
  if (!btn || btn.classList.contains('active')) return;

  // If download is showing, confirm before discarding
  var area = document.getElementById('actionArea');
  if (area.querySelector('.btn-download')) {
    if (!confirm('Switching modes will discard the current processed video. Continue?')) return;
    renderActions('idle');
    document.getElementById('statsCard').style.display = 'none';
    setProgress(0);
  }

  document.querySelectorAll('.seg-btn').forEach(function (b) { b.classList.remove('active'); });
  btn.classList.add('active');
  state.mode = btn.dataset.mode;

  var p = MODE_PRESETS[state.mode];
  document.getElementById('thrSlider').value    = p.threshold;
  document.getElementById('speechSlider').value = p.min_speech;
  syncThr(); syncSpeech();
  document.getElementById('modeHint').textContent = MODE_HINTS[state.mode];

  applyAccent();
  buildTracks(state.segments, state.duration);
  fetchPreview();
});

// ── Advanced panel toggle ─────────────────────────────────────────────────────
document.getElementById('proToggle').addEventListener('click', function () {
  var panel    = document.getElementById('proPanel');
  var expanded = this.getAttribute('aria-expanded') === 'true';
  this.setAttribute('aria-expanded', String(!expanded));
  if (expanded) panel.setAttribute('hidden', ''); else panel.removeAttribute('hidden');
});

// ── File handling ─────────────────────────────────────────────────────────────
var dropZone = document.getElementById('dropZone');
var fileChip = document.getElementById('fileChip');
var _browsing = false;

dropZone.addEventListener('click',    function ()  { if (!state.fileId) openNativeFilePicker(); });
dropZone.addEventListener('dragover', function (e) { e.preventDefault(); dropZone.classList.add('drag'); });
dropZone.addEventListener('dragleave',function ()  { dropZone.classList.remove('drag'); });
dropZone.addEventListener('drop',     function (e) {
  e.preventDefault(); dropZone.classList.remove('drag');
  var file = e.dataTransfer.files[0];
  if (!file) return;
  setDropZoneLoading(file.name);
  openNativeFilePicker(file.name);
});

document.getElementById('chipClear').addEventListener('click', resetState);

async function openNativeFilePicker(hintName) {
  if (_browsing) return;
  _browsing = true;
  if (!hintName) setDropZoneLoading(null);

  try {
    console.log('[browse] opening file picker');
    var res  = await fetch('/api/browse');
    var data = await res.json();
    console.log('[browse] result:', JSON.stringify(data));

    if (data.cancelled || !data.path) { restoreDropZone(); return; }
    if (data.error) {
      console.error('[browse] error:', data.error);
      pushLog('Browse error: ' + data.error, 'error');
      restoreDropZone();
      return;
    }

    await registerPath(data.path);
  } catch (e) {
    console.error('[browse] fetch failed:', e.name, e.message, e);
    pushLog('Error: ' + e.message, 'error');
    restoreDropZone();
  }
  _browsing = false;
}

async function registerPath(filePath) {
  var filename = filePath.split(/[\\/]/).pop();
  state.filename = filename.replace(/\.[^.]+$/, '');

  dropZone.style.display = 'none';
  fileChip.classList.add('show');
  document.getElementById('chipName').textContent = filename;
  document.getElementById('chipSize').textContent = '…';
  document.getElementById('logBox').innerHTML = '';
  setChipLoading();
  pushLog('Loading ' + filename + '…');
  console.log('[register] path:', filePath);

  try {
    var res  = await fetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: filePath }),
    });
    var data = await res.json();
    console.log('[register] response', res.status, JSON.stringify(data).slice(0, 200));

    if (!res.ok) {
      console.error('[register] failed:', data.error);
      pushLog('Error: ' + (data.error || 'Registration failed'), 'error');
      setChipError();
      dropZone.style.display = ''; fileChip.classList.remove('show');
      return;
    }
    onFileReady(data);
  } catch (e) {
    console.error('[register] fetch failed:', e.name, e.message, e);
    pushLog('Error: ' + e.message, 'error');
    setChipError();
    dropZone.style.display = ''; fileChip.classList.remove('show');
  }
}

function setDropZoneLoading(name) {
  var titleEl = dropZone.querySelector('.dz-title');
  var subEl   = dropZone.querySelector('.dz-sub');
  if (titleEl) titleEl.textContent = name ? name : 'Opening…';
  if (subEl)   subEl.textContent   = name ? 'Opening file dialog…' : 'Choose a video file';
  dropZone.style.pointerEvents = 'none'; dropZone.style.opacity = '0.6';
}

function restoreDropZone() {
  var titleEl = dropZone.querySelector('.dz-title');
  var subEl   = dropZone.querySelector('.dz-sub');
  if (titleEl) titleEl.textContent = 'Drop video here';
  if (subEl)   subEl.textContent   = 'or click to browse · MP4 · MKV · MOV · AVI · WebM';
  dropZone.style.pointerEvents = ''; dropZone.style.opacity = '';
}

function onFileReady(data) {
  console.log('[file] ready, file_id=' + data.file_id + ' duration=' + data.duration);
  state.fileId   = data.file_id;
  state.duration = data.duration;
  document.getElementById('chipSize').textContent = fmtBytes(data.size);
  setChipReady();
  setupVideoPreview('/api/video/' + data.file_id);
  pushLog('Ready — ' + fmtTime(data.duration) + ' · ' + fmtBytes(data.size), 'success');
  document.getElementById('sliceBtn').disabled = true;
  applyAccent();
  fetchPreview();
}

function resetState() {
  console.log('[reset] clearing state');
  state.fileId = null; state.jobId = null; state.duration = 0;
  state.segments = []; state.filename = '';
  _browsing = false;

  db.stop();
  fileChip.classList.remove('show');
  dropZone.style.display = ''; restoreDropZone();
  document.getElementById('sliceBtn').disabled = true;
  document.getElementById('tlEmpty').style.display = '';
  document.getElementById('tlBody').style.display = 'none';

  var vs = document.getElementById('tlVadState');
  if (vs) { vs.classList.remove('active', 'visible'); }

  document.getElementById('tlChipPct').style.display  = 'none';
  document.getElementById('tlChipSegs').style.display = 'none';
  document.getElementById('tlDurLabel').textContent   = '';
  document.getElementById('statsCard').style.display  = 'none';
  document.getElementById('logBox').innerHTML = '<span class="log-placeholder">Waiting for input…</span>';

  var vp = document.getElementById('videoPreviewCard'); if (vp) vp.style.display = 'none';
  var ec = document.getElementById('exportCard');       if (ec) ec.style.display = 'none';

  setProgress(0);
  renderActions('idle');
}

// ── Slice job ─────────────────────────────────────────────────────────────────
document.getElementById('actionArea').addEventListener('click', function (e) {
  if (e.target.closest('#sliceBtn')) doSlice();
});

async function doSlice() {
  if (!state.fileId) return;
  console.log('[slice] starting job, file_id=' + state.fileId + ' mode=' + state.mode);
  document.getElementById('sliceBtn').disabled = true;
  document.getElementById('statsCard').style.display = 'none';
  document.getElementById('logBox').innerHTML = '';
  setProgress(0); pushLog('Starting job…');

  try {
    var payload = {
      file_id:    state.fileId,
      mode:       state.mode,
      threshold:  parseFloat(document.getElementById('thrSlider').value),
      min_speech: parseInt(document.getElementById('speechSlider').value),
    };
    console.log('[slice] payload:', JSON.stringify(payload));

    var res = await fetch('/api/process', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    var data = await res.json();
    console.log('[slice] process response:', res.status, JSON.stringify(data));

    if (!res.ok) throw new Error(data.error || 'Process failed');

    state.jobId = data.job_id;
    console.log('[slice] job_id=' + state.jobId);
    var _totalSegs = 0;

    // SSE log stream
    var sse = new EventSource('/api/logs/' + state.jobId);
    sse.onerror = function (e) {
      console.error('[slice] SSE error:', e);
    };
    sse.onmessage = function (e) {
      try {
        var item = JSON.parse(e.data);
        if (item.done) { sse.close(); return; }
        pushLog(item.msg, item.level);

        var mTotal = item.msg.match(/Encoding (\d+) segments/);
        if (mTotal) { _totalSegs = parseInt(mTotal[1]); setProgress(1); }

        var mDone = item.msg.match(/Encoded (\d+)\/(\d+) segments/);
        if (mDone) {
          var done  = parseInt(mDone[1]);
          var total = parseInt(mDone[2]) || _totalSegs || 1;
          setProgress(Math.round(done / total * 100));
        }
      } catch (parseErr) {
        console.error('[slice] SSE parse error:', parseErr, 'raw:', e.data);
      }
    };

    // Status poll
    var poll = setInterval(async function () {
      try {
        var sr = await fetch('/api/status/' + state.jobId);
        if (sr.status === 404) { clearInterval(poll); return; }
        var sd = await sr.json();
        console.log('[slice] poll status:', sd.status);

        if (sd.status === 'done') {
          clearInterval(poll);
          onJobDone(sd.stats);
        } else if (sd.status === 'error') {
          clearInterval(poll);
          console.error('[slice] job error:', sd.error);
          pushLog(sd.error || 'Unknown job error', 'error');
          document.getElementById('sliceBtn').disabled = false;
        }
      } catch (pollErr) {
        console.error('[slice] poll fetch error:', pollErr.message);
      }
    }, 600);

  } catch (e) {
    console.error('[slice] doSlice error:', e.name, e.message, e);
    pushLog('Error: ' + e.message, 'error');
    document.getElementById('sliceBtn').disabled = false;
  }
}

function onJobDone(stats) {
  console.log('[slice] job done, stats:', JSON.stringify(stats).slice(0, 200));
  setProgress(100);

  if (stats) {
    showTimeline(stats.segments_list, stats.original_duration);
    updateTimelineMeta(stats);

    var colorize = function (id, val) {
      var el = document.getElementById(id);
      el.textContent = val; el.style.color = 'var(--accent)';
    };
    colorize('statPct',  stats.pct_removed + '%');
    colorize('statCut',  fmtTime(stats.removed));
    colorize('statSegs', String(stats.segments));
    document.getElementById('statsCard').style.display = '';
    showExportCard();
  }

  var area = document.getElementById('actionArea');
  area.innerHTML =
    '<a href="/api/download/' + state.jobId + '" class="btn-primary btn-download">' +
      '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>' +
      'Download' +
    '</a>';
}

// ── Action area rendering ─────────────────────────────────────────────────────
function renderActions(phase) {
  var area = document.getElementById('actionArea');
  area.innerHTML =
    '<button class="btn-primary" id="sliceBtn"' + (state.fileId ? '' : ' disabled') + '>' +
      '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4 8.12 15.88M14.47 14.48 20 20M8.12 8.12 12 12"/></svg>' +
      'Slice' +
    '</button>';
}

// ── Wire remaining controls ───────────────────────────────────────────────────
(function () {
  function wire(id, fn) { var el = document.getElementById(id); if (el) el.addEventListener('click', fn); }
  wire('pvPlayBtn',    function () { if (state.segments.length) startPreview(); });
  wire('pvPauseBtn',   pausePreview);
  wire('pvPrevBtn',    function () { jumpToSegment(state.currentSegIdx - 1); });
  wire('pvNextBtn',    function () { jumpToSegment(state.currentSegIdx + 1); });
  wire('exportEdlBtn', exportEDL);
  wire('exportFcpBtn', exportFCPXML);
  wire('exportPpBtn',  exportPremierePro);
})();