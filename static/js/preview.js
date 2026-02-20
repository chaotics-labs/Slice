/* preview.js — VAD preview: debounced fetch and result handling */
'use strict';

function fetchPreview() {
  console.log('[preview] ======== fetchPreview CALLED ========');
  console.log('[preview] state.fileId=' + state.fileId);
  if (!state.fileId) {
    console.error('[preview] ERROR: no fileId in state');
    pushLog('No file selected — try uploading a video first', 'error');
    return;
  }

  clearTimeout(state.previewTimer);

  var sb = document.getElementById('sliceBtn');
  if (sb) { sb.disabled = true; sb.style.opacity = '0.5'; sb.style.cursor = 'wait'; }

  vadStart();
  console.log('[preview] vad animation started, debouncing 800ms…');

  state.previewTimer = setTimeout(async function () {
    console.log('[preview] ======== DEBOUNCE TIMEOUT FIRED ========');
    var controller = new AbortController();
    var timeoutId  = setTimeout(function () {
      console.error('[preview] request timed out after 60s — aborting');
      controller.abort();
    }, 60000);

    // Helper to re-enable the slice button
    function _enableBtn() {
      var b = document.getElementById('sliceBtn');
      if (b) { b.disabled = false; b.style.opacity = ''; b.style.cursor = ''; }
    }

    var thrSlider    = document.getElementById('thrSlider');
    var speechSlider = document.getElementById('speechSlider');

    if (!thrSlider || !speechSlider) {
      console.error('[preview] sliders not found in DOM');
      pushLog('Error: sliders not found', 'error');
      vadStop();
      _enableBtn();
      return;
    }

    var payload = {
      file_id:    state.fileId,
      mode:       state.mode,
      threshold:  parseFloat(thrSlider.value),
      min_speech: parseInt(speechSlider.value),
    };
    console.log('[preview] payload:', JSON.stringify(payload));
    console.log('[preview] ======== SENDING FETCH REQUEST ========');

    try {
      var res = await fetch('/api/preview', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
        signal:  controller.signal,
      });
      clearTimeout(timeoutId);

      console.log('[preview] ======== RESPONSE RECEIVED: status=' + res.status + ' ========');

      if (res.status === 429) {
        console.warn('[preview] 429 busy — retrying in 1s');
        pushLog('Server busy — retrying…', 'warning');
        vadStop();
        _enableBtn();
        setTimeout(fetchPreview, 1000);
        return;
      }

      if (!res.ok) {
        var errText = await res.text();
        console.error('[preview] server error ' + res.status + ':', errText);
        pushLog('Preview failed (' + res.status + '): ' + errText, 'error');
        // vadStop() runs in finally
        return;
      }

      var data = await res.json();
      console.log('[preview] response JSON:', JSON.stringify(data).slice(0, 300));

      if (data.error) {
        console.error('[preview] server returned error:', data.error);
        pushLog('Preview error: ' + data.error, 'error');
        // vadStop() runs in finally
        return;
      }

      if (data.ok && data.stats) {
        console.log('[preview] stats OK — segments=' + data.stats.segments + ' dur=' + data.stats.original_duration);
        console.log('[preview] segments_list:', JSON.stringify(data.stats.segments_list));
        showTimeline(data.stats.segments_list, data.stats.original_duration);
        updateTimelineMeta(data.stats);
        showExportCard();
        _enableBtn();
        applyAccent();
        console.log('[preview] ======== PREVIEW COMPLETE ========');
      } else {
        console.error('[preview] unexpected response shape:', JSON.stringify(data));
        pushLog('Preview returned unexpected data', 'error');
      }

    } catch (err) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') {
        console.error('[preview] aborted after 60s timeout');
        pushLog('Preview timed out — VAD may be stuck', 'error');
      } else {
        console.error('[preview] fetch exception:', err.name, err.message);
        pushLog('Preview error: ' + err.message, 'error');
      }
      _enableBtn();
    } finally {
      // Always stop the spinner, no matter which path we took
      console.log('[preview] finally — calling vadStop()');
      vadStop();
    }
  }, 800);
}

function showExportCard() {
  if (!state.segments.length) return;
  var ec = document.getElementById('exportCard');
  if (ec) ec.style.display = '';
}