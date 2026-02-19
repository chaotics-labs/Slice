/* timeline.js — Ruler, track segments, tooltip, and info panel rendering */
'use strict';

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

function buildTracks(segs, dur) {
  var tkK = document.getElementById('trackKept');
  var tkC = document.getElementById('trackCut');

  // Clear existing clips/gaps (keep playhead elements)
  [tkK, tkC].forEach(function (tr) {
    Array.from(tr.children).forEach(function (c) {
      if (!c.classList.contains('tl-playhead')) c.remove();
    });
  });
  if (!dur) return;

  // Keep clips
  segs.forEach(function (seg, idx) {
    var s = seg[0], e = seg[1];
    var lp = s / dur * 100, wp = (e - s) / dur * 100;
    if (wp < 0.1) return;
    var clip = document.createElement('div');
    clip.className  = 'tl-clip';
    clip.style.left = lp + '%'; clip.style.width = wp + '%';
    clip.style.background = 'var(--accent)';
    clip.style.cursor = 'pointer'; clip.style.pointerEvents = 'auto';
    clip.dataset.segIdx = idx;
    clip.addEventListener('click', function (ev) {
      ev.stopPropagation();
      jumpToSegment(idx);
      if (!state.previewActive) startPreview();
    });
    var lh = document.createElement('div'); lh.className = 'tl-clip-handle left';
    var rh = document.createElement('div'); rh.className = 'tl-clip-handle right';
    clip.appendChild(lh); clip.appendChild(rh);
    tkK.appendChild(clip);
  });

  // Cut gaps
  var gaps = [];
  if (segs.length === 0) {
    gaps.push([0, dur]);
  } else {
    if (segs[0][0] > 0.1) gaps.push([0, segs[0][0]]);
    for (var i = 0; i < segs.length - 1; i++) gaps.push([segs[i][1], segs[i + 1][0]]);
    if (segs[segs.length - 1][1] < dur - 0.1) gaps.push([segs[segs.length - 1][1], dur]);
  }
  gaps.forEach(function (gap) {
    var s = gap[0], e = gap[1];
    var lp = s / dur * 100, wp = (e - s) / dur * 100;
    if (wp < 0.1) return;
    var g = document.createElement('div'); g.className = 'tl-gap';
    g.style.left = lp + '%'; g.style.width = wp + '%';
    if (wp > 3) {
      var lbl = document.createElement('span');
      lbl.className = 'tl-gap-label'; lbl.textContent = fmtTime(e - s);
      g.appendChild(lbl);
    }
    tkC.appendChild(g);
  });
}

function showTimeline(segs, dur) {
  state.segments = segs || []; state.duration = dur || 0;
  document.getElementById('tlEmpty').style.display  = 'none';
  document.getElementById('tlBody').style.display   = '';
  document.getElementById('tlAxisEnd').textContent  = fmtTime(dur);
  document.getElementById('tlAxisMid').textContent  = fmtTime(dur / 2);
  buildRuler(dur);
  buildTracks(segs, dur);
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

// ── Timeline hover tooltip ────────────────────────────────────────────────────
(function () {
  var tooltip = document.getElementById('tlTooltip');

  function onMove(e) {
    var rect = e.currentTarget.getBoundingClientRect();
    var pct  = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    var t    = pct * state.duration;
    ['phKept', 'phCut'].forEach(function (id) {
      var ph = document.getElementById(id);
      ph.style.display = ''; ph.style.left = (pct * 100) + '%';
    });
    var inSeg  = state.segments.find(function (s) { return t >= s[0] && t <= s[1]; });
    var color  = 'var(--accent)';
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

  ['trackKept', 'trackCut'].forEach(function (id) {
    var el = document.getElementById(id);
    el.addEventListener('mousemove', onMove);
    el.addEventListener('mouseleave', onLeave);
  });
})();

// ── VAD analyzing indicator ───────────────────────────────────────────────────
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