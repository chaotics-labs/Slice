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
      el.style.transition = 'opacity 0.02s linear';  // 20ms = frame-fast at 25fps (1/25 = 40ms)
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
        console.log('[player] video ended on buffer', i);
        state.previewActive = false;
        updatePreviewUI();
      });
      _els[i].addEventListener('error', function () {
        console.error('[player] video error on buffer', i, _els[i].error);
      });
    });
  }

  function load(src) {
    console.log('[player] loading src:', src);
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
    console.log('[player] CUT to seg ' + idx + '@' + target.toFixed(3) + 's (buffer=' + i + ', old buffer=' + _active + ')');

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
        console.error('[player] play() failed after cut:', e.name, e.message);
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
      else {
        _els[i].addEventListener('loadedmetadata', function onM() {
          _els[i].removeEventListener('loadedmetadata', onM);
          _els[i].currentTime = target;
        });
      }

      setTimeout(function () {
        if (done) return; done = true;
        console.warn('[player] cut fallback triggered for idx', idx);
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
    console.log('[player] stop()');
    [0, 1].forEach(function (i) {
      if (_els[i]) { _els[i].pause(); _els[i].removeAttribute('src'); _els[i].load(); }
    });
    _ready = [false, false];
  }

  _init();
  return { load, preseek, seek, cut, play, pause, currentTime, stop };
})();


// ── Preview player UI ────────────────────────────────────────────────────────
function setupVideoPreview(url) {
  console.log('[player] setupVideoPreview:', url);
  document.getElementById('videoPreviewCard').style.display = '';
  state.currentSegIdx = 0; state.previewActive = false;
  db.load(url);
  updatePreviewUI();
}

function jumpToSegment(idx) {
  if (!state.segments.length) return;
  idx = Math.max(0, Math.min(idx, state.segments.length - 1));
  console.log('[player] jumpToSegment:', idx);
  if (state.previewActive) {
    clearTimeout(state.previewJumpTimer);
    db.cut(idx, function () { scheduleNextJump(idx); });
  } else {
    state.currentSegIdx = idx;
    db.seek(state.segments[idx][0]);
    updateSegCounter(); highlightActiveClip(idx);
    db.preseek(idx + 1);
    updatePlaybackTime();   // Update info panel when jumping while paused
    updatePlayheadBar();    // Update playhead position
  }
}

function scheduleNextJump(idx) {
  clearTimeout(state.previewJumpTimer);
  if (!state.previewActive) return;
  var endTime = state.segments[idx][1];
  var fps = state.fps || 25;
  var frameDuration = 1 / fps;
  var tolerance = frameDuration * 0.5;

  function checkEnd() {
    if (!state.previewActive) return;
    var currentTime = db.currentTime();
    var timeToEnd = endTime - currentTime;
    
    // When segment ends
    if (timeToEnd <= tolerance) {
      console.log('[player] seg ' + idx + ' ended: currentTime=' + currentTime.toFixed(4) + 's');
      
      // Check if autoplay is enabled
      if (state.autoplay && idx + 1 < state.segments.length) {
        console.log('[player] autoplay enabled, jumping to next segment');
        db.cut(idx + 1, function () { scheduleNextJump(idx + 1); });
      } else {
        console.log('[player] autoplay disabled or no more segments, pausing');
        db.pause();
        state.previewActive = false;
        updatePreviewUI();
      }
      return;
    }
    
    // Update time display every 16ms (~60fps)
    updatePlaybackTime();
    
    // Dynamic polling: use 10ms interval in final 200ms, otherwise 40ms
    var nextInterval = timeToEnd < 0.2 ? 10 : 40;
    state.previewJumpTimer = setTimeout(checkEnd, nextInterval);
  }
  state.previewJumpTimer = setTimeout(checkEnd, 40);
}

function updatePlaybackTime() {
  var timeEl = document.getElementById('pvInfoTime');
  var tcEl = document.getElementById('pvInfoTimecode');
  if (!timeEl || !tcEl) return;
  
  var t = db.currentTime();
  var fps = state.fps || 25;
  
  timeEl.textContent = t.toFixed(2) + 's';
  tcEl.textContent = toTimecode(t, fps);
}

function startPreview() {
  if (!state.segments.length) return;
  console.log('[player] startPreview, idx:', state.currentSegIdx);
  state.previewActive = true; updatePreviewUI();
  var idx = state.currentSegIdx;
  db.seek(state.segments[idx][0]); db.preseek(idx + 1);
  db.play().then(function () {
    scheduleNextJump(idx);
  }).catch(function (e) {
    console.error('[player] play() failed:', e.name, e.message);
    pushLog('Preview error: ' + e.message, 'error');
    state.previewActive = false; updatePreviewUI();
  });
}

function pausePreview() {
  console.log('[player] pausePreview');
  state.previewActive = false;
  clearTimeout(state.previewJumpTimer);
  db.pause();
  updatePlaybackTime();  // Update display to show where we paused
  updatePlayheadBar();   // Update playhead position
  updatePreviewUI();
}

function updatePlayheadBar() {
  var ph = document.getElementById('pvPlayheadBar');
  if (!ph || !state.duration) return;
  var currentTime = db.currentTime();
  ph.style.left = (currentTime / state.duration * 100) + '%';
}

function updatePreviewUI() {
  var toggleBtn = document.getElementById('pvToggleBtn');
  if (!toggleBtn) return;
  
  var playIcon = toggleBtn.querySelector('.pv-icon-play');
  var pauseIcon = toggleBtn.querySelector('.pv-icon-pause');
  
  if (state.previewActive) {
    // Currently playing, show pause icon
    if (playIcon) playIcon.style.display = 'none';
    if (pauseIcon) pauseIcon.style.display = '';
  } else {
    // Currently paused, show play icon
    if (playIcon) playIcon.style.display = '';
    if (pauseIcon) pauseIcon.style.display = 'none';
  }
  
  updateSegCounter();
  lucide.createIcons();  // Re-render icons after visibility changes
}

function togglePreview() {
  if (state.previewActive) {
    pausePreview();
  } else {
    resumePreview();
  }
}

function resumePreview() {
  if (!state.segments.length) return;
  console.log('[player] resumePreview from paused state, idx:', state.currentSegIdx);
  state.previewActive = true;
  updatePreviewUI();
  db.play().then(function () {
    scheduleNextJump(state.currentSegIdx);
  }).catch(function (e) {
    console.error('[player] play() failed:', e.name, e.message);
    pushLog('Preview error: ' + e.message, 'error');
    state.previewActive = false;
    updatePreviewUI();
  });
}

function replaySegment() {
  if (!state.segments.length) return;
  var idx = state.currentSegIdx;
  console.log('[player] replaySegment:', idx);
  db.seek(state.segments[idx][0]);
  updatePlaybackTime();
}

function toggleAutoplay() {
  state.autoplay = !state.autoplay;
  console.log('[player] autoplay toggled:', state.autoplay);
  updateAutoplayButton();
}

function updateAutoplayButton() {
  var btn = document.getElementById('pvAutoplayBtn');
  if (!btn) return;
  var offIcon = btn.querySelector('.pv-icon-autoplay-off');
  var onIcon = btn.querySelector('.pv-icon-autoplay-on');
  if (state.autoplay) {
    if (offIcon) offIcon.style.display = 'none';
    if (onIcon) onIcon.style.display = '';
    btn.style.opacity = '1';
  } else {
    if (offIcon) offIcon.style.display = '';
    if (onIcon) onIcon.style.display = 'none';
    btn.style.opacity = '0.6';
  }
  lucide.createIcons();  // Re-render icons after visibility changes
}

function resetPlaybackTime() {
  // Removed: don't reset time display when preview stops
  // This keeps the position visible for inspection
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