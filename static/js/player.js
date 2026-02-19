/* player.js — Double-buffer video engine for gapless segment preview */
'use strict';

var db = (function () {
  var _els    = [null, null];
  var _active = 0;
  var _ready  = [false, false];

  function _idle() { return 1 - _active; }

  function _init() {
    var ref       = document.getElementById('previewVideo');
    var container = ref.parentNode;
    container.style.position = 'relative'; container.style.overflow = 'hidden';

    _els[0] = ref;
    _els[1] = document.createElement('video');

    [0, 1].forEach(function (i) {
      var el = _els[i];
      el.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;object-fit:contain;background:transparent;';
      el.preload = 'auto';
      el.style.transition = 'opacity 0.05s linear';
    });

    _els[0].style.opacity = '1';
    _els[1].style.opacity = '0';
    container.appendChild(_els[1]);

    [0, 1].forEach(function (i) {
      _els[i].addEventListener('timeupdate', function () {
        if (i !== _active || !state.duration) return;
        var ph = document.getElementById('pvPlayheadBar');
        if (ph) ph.style.left = (_els[i].currentTime / state.duration * 100) + '%';
      });
      _els[i].addEventListener('ended', function () {
        if (i !== _active) return;
        state.previewActive = false;
        updatePreviewUI();
      });
    });
  }

  function load(src) {
    _ready = [false, false]; _active = 0;
    [0, 1].forEach(function (i) { _els[i].src = src; _els[i].load(); });
    _els[0].style.opacity = '1'; _els[1].style.opacity = '0';
  }

  function preseek(idx) {
    if (!state.segments[idx]) return;
    var i = _idle(), t = state.segments[idx][0];
    _ready[i] = false;

    function doSeek() { _els[i].currentTime = t; }
    if (_els[i].readyState >= 1) { doSeek(); }
    else { _els[i].addEventListener('loadedmetadata', function onM() { _els[i].removeEventListener('loadedmetadata', onM); doSeek(); }); }

    _els[i].addEventListener('seeked', function onS() { _els[i].removeEventListener('seeked', onS); _ready[i] = true; });
  }

  function seek(t) { _els[_active].currentTime = t; }

  function cut(idx, cb) {
    if (!state.segments[idx]) return;
    var i = _idle(), target = state.segments[idx][0];

    function doSwap() {
      _els[_active].style.opacity = '0';
      _els[i].style.opacity = '1';
      _els[_active].pause();
      _active = i;
      state.currentSegIdx = idx;
      updateSegCounter();
      highlightActiveClip(idx);
      _els[_active].play().then(function () {
        if (cb) cb();
        preseek(idx + 1);
      }).catch(function (e) {
        pushLog('Preview error: ' + e.message, 'error');
        state.previewActive = false;
        updatePreviewUI();
      });
    }

    if (_ready[i]) {
      doSwap();
    } else {
      var done = false;
      function onSeeked() {
        if (done) return; done = true;
        _els[i].removeEventListener('seeked', onSeeked);
        _ready[i] = true; doSwap();
      }
      _els[i].addEventListener('seeked', onSeeked);
      if (_els[i].readyState >= 1) { _els[i].currentTime = target; }
      else { _els[i].addEventListener('loadedmetadata', function onM() { _els[i].removeEventListener('loadedmetadata', onM); _els[i].currentTime = target; }); }

      // Fallback: seek active element directly if idle buffer is slow
      setTimeout(function () {
        if (done) return; done = true;
        _els[i].removeEventListener('seeked', onSeeked);
        _els[_active].currentTime = target;
        state.currentSegIdx = idx;
        updateSegCounter(); highlightActiveClip(idx);
        if (cb) cb(); preseek(idx + 1);
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
  return { load, preseek, seek, cut, play, pause, currentTime, stop };
})();


// ── Preview player UI ─────────────────────────────────────────────────────────
function setupVideoPreview(url) {
  document.getElementById('videoPreviewCard').style.display = '';
  state.currentSegIdx = 0; state.previewActive = false;
  db.load(url);
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
    updateSegCounter(); highlightActiveClip(idx);
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
        updatePreviewUI(); highlightActiveClip(-1);
      }
      return;
    }
    state.previewJumpTimer = setTimeout(checkEnd, 40);
  }
  state.previewJumpTimer = setTimeout(checkEnd, 40);
}

function startPreview() {
  if (!state.segments.length) return;
  state.previewActive = true; updatePreviewUI();
  var idx = state.currentSegIdx;
  db.seek(state.segments[idx][0]); db.preseek(idx + 1);
  db.play().then(function () { scheduleNextJump(idx); }).catch(function (e) {
    pushLog('Preview error: ' + e.message, 'error');
    state.previewActive = false; updatePreviewUI();
  });
}

function pausePreview() {
  state.previewActive = false;
  clearTimeout(state.previewJumpTimer);
  db.pause(); updatePreviewUI();
}

function updatePreviewUI() {
  var pb  = document.getElementById('pvPlayBtn');
  var pau = document.getElementById('pvPauseBtn');
  if (!pb) return;
  pb.style.display  = state.previewActive ? 'none' : '';
  pau.style.display = state.previewActive ? '' : 'none';
  updateSegCounter();
}

function updateSegCounter() {
  var c = document.getElementById('pvSegCounter');
  if (!c) return;
  c.textContent = state.segments.length
    ? 'Seg ' + (state.currentSegIdx + 1) + ' / ' + state.segments.length
    : 'No cuts yet';
}

function highlightActiveClip(idx) {
  document.querySelectorAll('.tl-clip').forEach(function (clip, i) {
    clip.style.outline       = i === idx ? '2px solid rgba(255,255,255,.85)' : '';
    clip.style.outlineOffset = i === idx ? '2px' : '';
  });
}
