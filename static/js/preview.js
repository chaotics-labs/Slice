/* preview.js — VAD preview: debounced fetch and result handling */
'use strict';

function fetchPreview() {
  console.log('[preview] ======== fetchPreview CALLED ========');
  console.log('[preview] state.fileId=' + state.fileId);
  if (!state.fileId) {
    console.error('[preview] ERROR: no fileId in state, cannot fetch preview');
    pushLog('No file selected', 'error');
    return;
  }
  
  console.log('[preview] fileId exists, clearing existing timeout');
  clearTimeout(state.previewTimer);
  console.log('[preview] existing timeout cleared, id=' + state.previewTimer);

  var sb = document.getElementById('sliceBtn');
  if (sb) { 
    sb.disabled = true; sb.style.opacity = '0.5'; sb.style.cursor = 'wait';
    console.log('[preview] slice button disabled');
  } else {
    console.warn('[preview] WARNING: slice button not found');
  }
  
  vadStart();
  console.log('[preview] vad animation started');

  state.previewTimer = setTimeout(async function () {
    console.log('[preview] ======== DEBOUNCE TIMEOUT FIRED = 800ms passed ========');
    var controller = new AbortController();
    var timeoutId  = setTimeout(function () {
      console.error('[preview] request timed out after 60s — aborting');
      controller.abort();
    }, 60000);

    console.log('[preview] looking for slider elements...');
    var thrSlider = document.getElementById('thrSlider');
    var speechSlider = document.getElementById('speechSlider');
    console.log('[preview] thrSlider=' + (thrSlider ? 'found' : 'NOT FOUND'), 'speechSlider=' + (speechSlider ? 'found' : 'NOT FOUND'));
    if (!thrSlider) {
      console.error('[preview] CRITICAL ERROR: thrSlider not found in DOM!');
      console.error('[preview] available inputs:', document.querySelectorAll('input').length);
      pushLog('Error: Threshold slider not found', 'error');
      vadStop();
      return;
    }
    if (!speechSlider) {
      console.error('[preview] CRITICAL ERROR: speechSlider not found in DOM!');
      pushLog('Error: Speech slider not found', 'error');
      vadStop();
      return;
    }
    console.log('[preview] both sliders found successfully');
    var thrValue = parseFloat(thrSlider.value);
    var speechValue = parseInt(speechSlider.value);
    console.log('[preview] slider values: threshold=' + thrValue + ', min_speech=' + speechValue);
    
    var payload = {
      file_id:    state.fileId,
      mode:       state.mode,
      threshold:  thrValue,
      min_speech: speechValue,
    };
    console.log('[preview] payload assembled:', JSON.stringify(payload));
    console.log('[preview] ======== SENDING FETCH REQUEST ========');

    try {
      var res = await fetch('/api/preview', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
        signal:  controller.signal,
      });
      clearTimeout(timeoutId);

      console.log('[preview] ======== RESPONSE RECEIVED ========');
      console.log('[preview] response status:', res.status);

      if (res.status === 429) {
        console.warn('[preview] server busy (429) - VAD still processing previous request');
        console.warn('[preview] will retry in 1 second...');
        pushLog('Server busy (VAD still processing) - retrying...', 'warning');
        vadStop();
        var sb = document.getElementById('sliceBtn');
        if (sb) { sb.disabled = false; sb.style.opacity = ''; sb.style.cursor = ''; }
        setTimeout(function() {
          console.log('[preview] retrying after 429 wait');
          fetchPreview();
        }, 1000);
        return;
      }

      if (!res.ok) {
        var errText = await res.text();
        console.error('[preview] server error ' + res.status + ':', errText);
        pushLog('Preview failed (' + res.status + '): ' + errText, 'error');
        return;
      }

      var data = await res.json();
      console.log('[preview] got response, full data:', JSON.stringify(data).substring(0, 300));
      console.log('[preview] data.ok=' + data.ok, 'data.stats=' + (data.stats ? 'yes' : 'NO'), 'segments=' + (data.stats && data.stats.segments));

      if (data.error) {
        console.error('[preview] server returned error:', data.error);
        pushLog('Preview error: ' + data.error, 'error');
        return;
      }

      if (data.ok && data.stats) {
        console.log('[preview] stats received, building timeline...');
        console.log('[preview] segments_list:', data.stats.segments_list);
        showTimeline(data.stats.segments_list, data.stats.original_duration);
        console.log('[preview] timeline shown, updating meta...');
        updateTimelineMeta(data.stats);
        console.log('[preview] showing export card...');
        showExportCard();
        console.log('[preview] enabling slice button...');
        var sb = document.getElementById('sliceBtn');
        if (sb) { sb.disabled = false; sb.style.opacity = ''; sb.style.cursor = ''; applyAccent(); }
        console.log('[preview] preview complete');
      } else {
        console.error('[preview] data.ok is false or data.stats missing');
        console.error('[preview] full response:', JSON.stringify(data));
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