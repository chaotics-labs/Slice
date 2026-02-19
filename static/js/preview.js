/* preview.js — VAD preview: debounced fetch and result handling */
'use strict';

function fetchPreview() {
  if (!state.fileId) return;
  clearTimeout(state.previewTimer);

  var sb = document.getElementById('sliceBtn');
  if (sb) { sb.disabled = true; sb.style.opacity = '0.5'; sb.style.cursor = 'wait'; }
  vadStart();

  state.previewTimer = setTimeout(async function () {
    var controller = new AbortController();
    var timeoutId  = setTimeout(function () {
      console.error('[preview] request timed out after 60s — aborting');
      controller.abort();
    }, 60000);

    var payload = {
      file_id:    state.fileId,
      mode:       state.mode,
      threshold:  parseFloat(document.getElementById('thrSlider').value),
      min_speech: parseInt(document.getElementById('speechSlider').value),
    };
    console.log('[preview] sending request', payload);

    try {
      var res = await fetch('/api/preview', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
        signal:  controller.signal,
      });
      clearTimeout(timeoutId);

      console.log('[preview] response status:', res.status);

      if (res.status === 429) {
        console.warn('[preview] server busy (429), skipping');
        return;
      }

      if (!res.ok) {
        var errText = await res.text();
        console.error('[preview] server error ' + res.status + ':', errText);
        pushLog('Preview failed (' + res.status + '): ' + errText, 'error');
        return;
      }

      var data = await res.json();
      console.log('[preview] got response, ok=' + data.ok, 'segments=' + (data.stats && data.stats.segments));

      if (data.error) {
        console.error('[preview] server returned error:', data.error);
        pushLog('Preview error: ' + data.error, 'error');
        return;
      }

      if (data.ok && data.stats) {
        showTimeline(data.stats.segments_list, data.stats.original_duration);
        updateTimelineMeta(data.stats);
        showExportCard();
        var sb = document.getElementById('sliceBtn');
        if (sb) { sb.disabled = false; sb.style.opacity = ''; sb.style.cursor = ''; applyAccent(); }
      }
    } catch (err) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') {
        console.error('[preview] aborted after timeout');
        pushLog('Preview timed out — VAD may be stuck on the server', 'error');
      } else {
        console.error('[preview] fetch error:', err.name, err.message, err);
        pushLog('Preview fetch error: ' + err.message, 'error');
      }
      var sb = document.getElementById('sliceBtn');
      if (sb) { sb.disabled = false; sb.style.opacity = ''; sb.style.cursor = ''; }
    } finally {
      vadStop();
    }
  }, 800);
}

function showExportCard() {
  if (!state.segments.length) return;
  var ec = document.getElementById('exportCard');
  if (ec) ec.style.display = '';
}