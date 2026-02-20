/* timeline.js — Ruler, segment track, waveform visualizer, tooltips, info panel */
'use strict';

// ═══════════════════════════════════════════════════════════════════════════════
// RULER
// ═══════════════════════════════════════════════════════════════════════════════

function buildRuler(dur) {
  var ruler = document.getElementById('tlRuler');
  ruler.innerHTML = '';
  if (!dur) return;
  var steps = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
  var step  = steps.find(function (i) { return dur / i <= 10; }) || 300;
  for (var t = 0; t <= dur + 0.001; t += step) {
    var pct  = Math.min(t, dur) / dur * 100;
    var wrap = document.createElement('div');
    wrap.style.cssText = 'position:absolute;left:' + pct + '%;top:0;bottom:0;';
    var tick = document.createElement('div');
    tick.style.cssText = 'position:absolute;bottom:0;left:0;width:1px;height:6px;background:var(--sep-strong);';
    var lbl = document.createElement('span');
    lbl.style.cssText = 'position:absolute;bottom:1px;left:3px;font-size:9px;color:var(--label-3);white-space:nowrap;font-variant-numeric:tabular-nums;font-family:-apple-system,sans-serif;';
    lbl.textContent = fmtTime(t);
    wrap.appendChild(tick); wrap.appendChild(lbl);
    ruler.appendChild(wrap);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TRACK — single row: dim base + bright speech clips
// ═══════════════════════════════════════════════════════════════════════════════

function buildTracks(segs, dur) {
  var tkK = document.getElementById('trackKept');
  if (!tkK) return;

  // Clear existing clips/cut-regions (keep playhead)
  Array.from(tkK.children).forEach(function (c) {
    if (!c.classList.contains('tl-playhead')) c.remove();
  });
  if (!dur) return;

  // Compute cut gaps so we can dim them
  var gaps = [];
  if (!segs || segs.length === 0) {
    gaps.push([0, dur]);
  } else {
    if (segs[0][0] > 0.1) gaps.push([0, segs[0][0]]);
    for (var i = 0; i < segs.length - 1; i++) gaps.push([segs[i][1], segs[i + 1][0]]);
    if (segs[segs.length - 1][1] < dur - 0.1) gaps.push([segs[segs.length - 1][1], dur]);
  }

  // Dim overlay on cut regions
  gaps.forEach(function (gap) {
    var s = gap[0], e = gap[1];
    var lp = s / dur * 100, wp = (e - s) / dur * 100;
    if (wp < 0.05) return;
    var g = document.createElement('div');
    g.className = 'tl-cut-region';
    g.style.left = lp + '%';
    g.style.width = wp + '%';
    tkK.appendChild(g);
  });

  // Bright speech clips on top
  (segs || []).forEach(function (seg, idx) {
    var s = seg[0], e = seg[1];
    var lp = s / dur * 100, wp = (e - s) / dur * 100;
    if (wp < 0.1) return;
    var clip = document.createElement('div');
    clip.className  = 'tl-clip';
    clip.style.left = lp + '%';
    clip.style.width = wp + '%';
    clip.style.background = 'var(--accent)';
    clip.style.cursor = 'pointer';
    clip.style.pointerEvents = 'auto';
    clip.dataset.segIdx   = idx;
    clip.dataset.segStart = s;
    clip.dataset.segEnd   = e;
    clip.addEventListener('click', function (ev) {
      ev.stopPropagation();
      jumpToSegment(idx);
      if (!state.previewActive) startPreview();
    });
    clip.addEventListener('mouseenter', function (ev) { ev.stopPropagation(); showSegmentTooltip(ev, s, e); });
    clip.addEventListener('mousemove',  function (ev) { ev.stopPropagation(); showSegmentTooltip(ev, s, e); });
    clip.addEventListener('mouseleave', function (ev) { ev.stopPropagation(); hideSegmentTooltip(); });
    var lh = document.createElement('div'); lh.className = 'tl-clip-handle left';
    var rh = document.createElement('div'); rh.className = 'tl-clip-handle right';
    clip.appendChild(lh); clip.appendChild(rh);
    tkK.appendChild(clip);
  });

  // Re-colour waveform if already loaded
  overlayWaveformSegments(segs, dur);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SHOW / META
// ═══════════════════════════════════════════════════════════════════════════════

function showTimeline(segs, dur) {
  state.segments = segs || [];
  state.duration = dur  || 0;
  document.getElementById('tlEmpty').style.display = 'none';
  document.getElementById('tlBody').style.display  = '';
  document.getElementById('tlAxisEnd').textContent = fmtTime(dur);
  document.getElementById('tlAxisMid').textContent = fmtTime(dur / 2);
  buildRuler(dur);
  buildTracks(segs, dur);
  // After tlBody is visible, try redrawing waveform (canvas may now have real dimensions)
  if (_waveformData) {
    setTimeout(function () { _drawWaveform(segs, dur); }, 50);
  }
}

function updateTimelineMeta(stats) {
  var pc = document.getElementById('tlChipPct');
  var sc = document.getElementById('tlChipSegs');
  pc.textContent = '-' + stats.pct_removed + '%'; pc.style.display = '';
  pc.style.background = 'rgba(var(--accent-rgb),.12)'; pc.style.color = 'var(--accent)';
  sc.textContent = stats.segments + ' segs'; sc.style.display = '';
  document.getElementById('tlDurLabel').textContent = fmtTime(stats.original_duration);
  updateInfoPanel(stats);
}

function updateInfoPanel(stats) {
  var els = {
    orig: document.getElementById('pvInfoOriginal'),
    kept: document.getElementById('pvInfoKept'),
    remv: document.getElementById('pvInfoRemoved'),
    segs: document.getElementById('pvInfoSegs'),
    pct:  document.getElementById('pvInfoPct'),
  };
  if (!els.orig) return;
  els.orig.textContent = fmtTime(stats.original_duration);
  els.kept.textContent = fmtTime(stats.kept);
  els.remv.textContent = '-' + fmtTime(stats.removed);
  els.segs.textContent = stats.segments;
  els.pct.textContent  = '-' + stats.pct_removed + '%';
  [els.kept, els.pct].forEach(function (el) { el.style.color = 'var(--accent)'; });
}

// ═══════════════════════════════════════════════════════════════════════════════
// TIMELINE HOVER TOOLTIP (track scrub)
// ═══════════════════════════════════════════════════════════════════════════════

(function () {
  var tooltip = document.getElementById('tlTooltip');

  function onMove(e) {
    var rect = e.currentTarget.getBoundingClientRect();
    var pct  = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    var t    = pct * state.duration;
    var ph = document.getElementById('phKept');
    if (ph) { ph.style.display = ''; ph.style.left = (pct * 100) + '%'; }
    var inSeg = state.segments.find(function (s) { return t >= s[0] && t <= s[1]; });
    var color = 'var(--accent)';
    tooltip.innerHTML =
      '<span class="tl-tt-dot" style="background:' + (inSeg ? color : 'var(--label-3)') + '"></span>' +
      fmtTime(t) + ' &middot; ' +
      (inSeg ? '<b style="color:' + color + '">kept</b>' : '<span style="color:var(--label-3)">cut</span>');
    tooltip.classList.add('show');
    var tx = e.clientX - tooltip.offsetWidth / 2;
    var ty = e.clientY - 40;
    tx = Math.max(8, Math.min(tx, window.innerWidth - tooltip.offsetWidth - 8));
    tooltip.style.left = tx + 'px'; tooltip.style.top = ty + 'px';
  }

  function onLeave() {
    tooltip.classList.remove('show');
    document.querySelectorAll('.tl-playhead').forEach(function (p) { p.style.display = 'none'; });
  }

  // Kept track
  var el = document.getElementById('trackKept');
  if (el) { el.addEventListener('mousemove', onMove); el.addEventListener('mouseleave', onLeave); }

  // Waveform canvas (attached after load via delegation on container)
  var wContainer = document.getElementById('waveformContainer');
  if (wContainer) { wContainer.addEventListener('mousemove', onMove); wContainer.addEventListener('mouseleave', onLeave); }
})();

// ═══════════════════════════════════════════════════════════════════════════════
// SEGMENT CLIP TOOLTIP
// ═══════════════════════════════════════════════════════════════════════════════

function showSegmentTooltip(e, startTime, endTime) {
  var tooltip  = document.getElementById('tlTooltip');
  var duration = endTime - startTime;
  var fps      = state.fps || 25;
  tooltip.innerHTML =
    '<span class="tl-tt-dot" style="background:var(--accent)"></span>' +
    '<span class="tl-tt-content">' +
    '<div class="tl-tt-time">' + fmtTime(startTime) + ' → ' + fmtTime(endTime) + ' (' + fmtTime(duration) + ')</div>' +
    '<div class="tl-tt-timecode">' + toTimecode(startTime, fps) + ' → ' + toTimecode(endTime, fps) + '</div>' +
    '</span>';
  tooltip.classList.add('show');
  tooltip.style.pointerEvents = 'none';
  var tx = e.clientX - tooltip.offsetWidth / 2;
  var ty = e.clientY - 50;
  tx = Math.max(8, Math.min(tx, window.innerWidth - tooltip.offsetWidth - 8));
  tooltip.style.left = tx + 'px';
  tooltip.style.top  = ty + 'px';
}

function hideSegmentTooltip() {
  document.getElementById('tlTooltip').classList.remove('show');
}

// ═══════════════════════════════════════════════════════════════════════════════
// VAD INDICATOR
// ═══════════════════════════════════════════════════════════════════════════════

function vadStart() {
  var vad = document.getElementById('tlVadState');
  if (!vad) return;
  vad.classList.add('active');
  requestAnimationFrame(function () {
    requestAnimationFrame(function () { vad.classList.add('visible'); });
  });
}

function vadStop() {
  var vad = document.getElementById('tlVadState');
  if (!vad) return;
  vad.classList.remove('visible');
  setTimeout(function () { vad.classList.remove('active'); }, 300);
}


// ═══════════════════════════════════════════════════════════════════════════════
// WAVEFORM VISUALIZER
// ═══════════════════════════════════════════════════════════════════════════════

var _waveformData     = null;   // Float32Array normalised peak values [0..1]
var _waveformFileId   = null;
var _waveformLoading  = false;
var _waveformDuration = 0;      // actual audio duration from decoded buffer (seconds)

function _wfLog(msg) {
  console.log('[waveform] ' + msg);
  var st = document.getElementById('waveformStatus');
  if (st) { st.textContent = msg; st.style.display = ''; }
}

function _wfErr(msg) {
  console.error('[waveform] ' + msg);
  var st = document.getElementById('waveformStatus');
  if (st) {
    st.textContent = '⚠ ' + msg;
    st.style.color = 'var(--red, #ff453a)';
    st.style.display = '';
  }
}

/**
 * Entry point — called from main.js onFileReady().
 * Shows waveform panel immediately (skeleton), then fetches + decodes async.
 * The panel is shown even while tlBody is still hidden so the canvas gets
 * sized properly on first draw.
 */
function loadWaveform(fileId) {
  console.log('[waveform] ========== loadWaveform START ==========');
  console.log('[waveform] fileId=' + fileId);

  var container = document.getElementById('waveformContainer');
  var canvas    = document.getElementById('waveformCanvas');

  if (!container) { console.error('[waveform] FATAL: #waveformContainer not in DOM'); return; }
  if (!canvas)    { console.error('[waveform] FATAL: #waveformCanvas not in DOM');    return; }

  _waveformFileId  = fileId;
  _waveformData    = null;
  _waveformLoading = true;

  // Make the panel visible before anything else
  container.style.display = '';

  // Check if tlBody is visible — canvas needs to be in a visible parent to get dimensions
  var tlBody = document.getElementById('tlBody');
  console.log('[waveform] tlBody display=' + (tlBody ? tlBody.style.display : 'N/A'));

  _wfLog('Fetching audio…');
  _drawLoadingSkeleton(canvas);

  var url = '/api/audio/' + fileId;
  console.log('[waveform] GET ' + url);

  fetch(url, { cache: 'no-store' })
    .then(function (r) {
      var ct  = r.headers.get('content-type') || '?';
      var cl  = r.headers.get('content-length') || '?';
      console.log('[waveform] response: ' + r.status + ' content-type=' + ct + ' content-length=' + cl + 'B');
      if (!r.ok) {
        return r.text().then(function (body) {
          throw new Error('HTTP ' + r.status + ': ' + body.slice(0, 200));
        });
      }
      _wfLog('Downloading audio (' + (cl !== '?' ? (parseInt(cl) / 1024).toFixed(0) + ' KB' : '…') + ')…');
      return r.arrayBuffer();
    })
    .then(function (buf) {
      console.log('[waveform] arrayBuffer byteLength=' + buf.byteLength);
      if (buf.byteLength < 100) throw new Error('Buffer too small (' + buf.byteLength + ' bytes) — probably an error response');
      _wfLog('Downloaded ' + (buf.byteLength / 1024).toFixed(0) + ' KB — decoding PCM…');

      var AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) throw new Error('Web Audio API not supported');

      var actx = new AudioCtx();
      console.log('[waveform] AudioContext state=' + actx.state + ' sampleRate=' + actx.sampleRate);

      return new Promise(function (resolve, reject) {
        actx.decodeAudioData(
          buf,
          function (decoded) {
            console.log('[waveform] decodeAudioData OK — ch=' + decoded.numberOfChannels +
              ' sr=' + decoded.sampleRate + ' dur=' + decoded.duration.toFixed(2) + 's samples=' + decoded.length);
            resolve(decoded);
          },
          function (err) {
            // err may be null in some browsers
            var msg = err ? (err.message || err.toString()) : 'unknown decode error';
            console.error('[waveform] decodeAudioData FAILED:', err);
            reject(new Error('Decode failed: ' + msg));
          }
        );
      });
    })
    .then(function (decoded) {
      _wfLog('Building waveform peaks…');
      _waveformDuration = decoded.duration;  // store actual audio duration
      var raw = decoded.getChannelData(0);
      console.log('[waveform] raw sample count=' + raw.length + ' audioDur=' + decoded.duration.toFixed(3) + 's stateDur=' + state.duration);
      _waveformData    = _buildPeaks(raw, 2000);
      _waveformLoading = false;
      console.log('[waveform] peaks ready, drawing…');

      var st = document.getElementById('waveformStatus');
      if (st) { st.textContent = ''; st.style.display = 'none'; }

      // Draw immediately — tlBody may still be hidden, so force canvas size
      _drawWaveform(state.segments, state.duration, true);
      console.log('[waveform] ========== loadWaveform COMPLETE ==========');
    })
    .catch(function (err) {
      _waveformLoading = false;
      _wfErr(err.message || String(err));
      console.error('[waveform] ========== loadWaveform FAILED ==========', err);
    });
}

/**
 * Draw a placeholder skeleton while audio is loading.
 * Canvas lives inside .tl-waveform-track (height: 36px via CSS).
 */
function _drawLoadingSkeleton(canvas) {
  var dpr  = window.devicePixelRatio || 1;
  var rect = canvas.getBoundingClientRect();
  var W    = Math.round((rect.width  || canvas.offsetWidth  || 800) * dpr);
  var H    = Math.round((rect.height || canvas.offsetHeight || 36)  * dpr);
  if (W < 10) W = Math.round(800 * dpr);
  if (H < 10) H = Math.round(36  * dpr);
  canvas.width  = W;
  canvas.height = H;
  var ctx  = canvas.getContext('2d');
  var mid  = H / 2;
  var bars = 100;
  var barW = W / bars;
  ctx.clearRect(0, 0, W, H);
  for (var i = 0; i < bars; i++) {
    var h = (Math.sin(i * 0.5) * 0.25 + 0.3) * mid * 0.6;
    ctx.fillStyle = 'rgba(120,120,140,0.14)';
    ctx.fillRect(i * barW, mid - h, Math.max(1, barW - 1), h);
    ctx.fillRect(i * barW, mid,     Math.max(1, barW - 1), h);
  }
  console.log('[waveform] skeleton drawn at ' + W + 'x' + H);
}

/**
 * Downsample raw PCM float32 to `bars` peak values, normalised to [0,1].
 */
function _buildPeaks(raw, bars) {
  var blockSize = Math.max(1, Math.floor(raw.length / bars));
  var peaks     = new Float32Array(bars);
  for (var i = 0; i < bars; i++) {
    var start = i * blockSize;
    var end   = Math.min(start + blockSize, raw.length);
    var max   = 0;
    for (var j = start; j < end; j++) {
      var v = Math.abs(raw[j]);
      if (v > max) max = v;
    }
    peaks[i] = max;
  }
  var globalMax = 0;
  for (var k = 0; k < bars; k++) if (peaks[k] > globalMax) globalMax = peaks[k];
  if (globalMax > 0) for (var m = 0; m < bars; m++) peaks[m] /= globalMax;
  return peaks;
}

/**
 * Paint the waveform canvas.
 *
 * Key alignment guarantee: we use _waveformDuration (actual decoded audio length)
 * for bar→time mapping, but we map segment boundaries using state.duration
 * (the ffprobe duration the track uses) so both rows stay pixel-perfect in sync.
 *
 * segs        = [[start,end], ...] in seconds, same coordinate space as state.duration
 * dur         = state.duration (ffprobe value)
 * forceSize   = true when tlBody may still be hidden (canvas has no CSS size)
 */
function _drawWaveform(segs, dur, forceSize) {
  var canvas = document.getElementById('waveformCanvas');
  if (!canvas)        { console.warn('[waveform] draw: canvas missing'); return; }
  if (!_waveformData) { console.warn('[waveform] draw: no peak data');   return; }

  var dpr  = window.devicePixelRatio || 1;
  var rect = canvas.getBoundingClientRect();
  var W, H;

  if (forceSize || rect.width < 10) {
    var container = document.getElementById('waveformContainer');
    var cRect = container ? container.getBoundingClientRect() : { width: 0 };
    W = Math.round((cRect.width  || 800) * dpr);
    H = Math.round(36 * dpr);
    console.log('[waveform] draw (forceSize): W=' + W + ' H=' + H);
  } else {
    W = Math.round(rect.width  * dpr);
    H = Math.round(rect.height * dpr);
    console.log('[waveform] draw (normal): W=' + W + ' H=' + H);
  }

  if (W < 10) W = Math.round(800 * dpr);
  if (H < 10) H = Math.round(36  * dpr);

  canvas.width  = W;
  canvas.height = H;

  var ctx    = canvas.getContext('2d');
  var bars   = _waveformData.length;
  var mid    = H / 2;
  var hasVad = segs && segs.length > 0 && dur > 0;

  // The reference duration for segment position (state.duration, same as the segment track).
  // If dur isn't available yet fall back to _waveformDuration.
  var refDur = (dur > 0) ? dur : _waveformDuration;

  var accentRgb = getComputedStyle(document.documentElement)
    .getPropertyValue('--accent-rgb').trim() || '0,122,255';

  ctx.clearRect(0, 0, W, H);

  // ── Step 1: draw all bars in "cut" or "neutral" colour first ──────────────
  for (var i = 0; i < bars; i++) {
    var amp  = _waveformData[i];
    var barH = Math.max(1.5 * dpr, amp * mid * 0.88);
    var x    = (i / bars) * W;
    var bw   = Math.max(1, (W / bars) - 0.6);

    ctx.fillStyle = hasVad
      ? 'rgba(120,120,140,0.20)'   // cut — very dim
      : 'rgba(140,140,160,0.48)';  // no VAD yet — neutral grey

    ctx.fillRect(x, mid - barH, bw, barH);
    ctx.fillRect(x, mid,        bw, barH);
  }

  // ── Step 2: paint speech segments in accent colour by pixel range ─────────
  // Convert each segment's time boundary to an exact pixel x-position using
  // the same refDur as the segment track above, guaranteeing alignment.
  if (hasVad && refDur > 0) {
    ctx.fillStyle = 'rgba(' + accentRgb + ',0.90)';

    for (var si = 0; si < segs.length; si++) {
      var segStart = segs[si][0];
      var segEnd   = segs[si][1];

      // Clamp to valid range
      segStart = Math.max(0, Math.min(segStart, refDur));
      segEnd   = Math.max(0, Math.min(segEnd,   refDur));

      // Pixel boundaries — same formula as the segment track clips (left% * W)
      var xStart = (segStart / refDur) * W;
      var xEnd   = (segEnd   / refDur) * W;

      // Find bars that fall inside this pixel range and redraw them in accent
      var barFirst = Math.floor(xStart / (W / bars));
      var barLast  = Math.ceil(xEnd   / (W / bars));

      for (var b = barFirst; b <= barLast && b < bars; b++) {
        var bx   = (b / bars) * W;
        var bw2  = Math.max(1, (W / bars) - 0.6);
        var amp2 = _waveformData[b];
        var bh2  = Math.max(1.5 * dpr, amp2 * mid * 0.88);
        ctx.fillRect(bx, mid - bh2, bw2, bh2);
        ctx.fillRect(bx, mid,       bw2, bh2);
      }
    }
  }

  // ── Step 3: segment boundary markers (thin vertical lines at cut edges) ───
  if (hasVad && refDur > 0) {
    ctx.fillStyle = 'rgba(' + accentRgb + ',0.55)';
    for (var mi2 = 0; mi2 < segs.length; mi2++) {
      var lx = Math.round((segs[mi2][0] / refDur) * W);
      var rx = Math.round((segs[mi2][1] / refDur) * W);
      ctx.fillRect(lx, 0, Math.max(1, dpr), H);
      ctx.fillRect(rx, 0, Math.max(1, dpr), H);
    }
  }

  // ── Step 4: centre hairline ───────────────────────────────────────────────
  ctx.fillStyle = 'rgba(120,120,140,0.15)';
  ctx.fillRect(0, mid - 0.5 * dpr, W, dpr);

  console.log('[waveform] draw complete: refDur=' + refDur.toFixed(2) +
    ' audioDur=' + _waveformDuration.toFixed(2) +
    ' hasVad=' + hasVad + ' segs=' + (segs ? segs.length : 0) +
    ' W=' + W + ' H=' + H);
}

/**
 * Called by buildTracks() after VAD results arrive.
 */
function overlayWaveformSegments(segs, dur) {
  if (!_waveformData) {
    console.log('[waveform] overlayWaveformSegments: no data yet');
    return;
  }
  console.log('[waveform] overlayWaveformSegments: ' + (segs ? segs.length : 0) + ' segs, dur=' + dur);
  _drawWaveform(segs, dur, false);
}

/**
 * Called from main.js resetState().
 */
function resetWaveform() {
  console.log('[waveform] resetWaveform()');
  _waveformData     = null;
  _waveformFileId   = null;
  _waveformLoading  = false;
  _waveformDuration = 0;
  var canvas = document.getElementById('waveformCanvas');
  if (canvas) canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
  var container = document.getElementById('waveformContainer');
  if (container) container.style.display = 'none';
  var st = document.getElementById('waveformStatus');
  if (st) { st.textContent = ''; st.style.color = ''; st.style.display = 'none'; }
}

// Redraw on window resize
window.addEventListener('resize', function () {
  if (_waveformData) _drawWaveform(state.segments, state.duration, false);
});