/* preview.js — VAD preview: debounced fetch and result handling */
'use strict';

function fetchPreview() {
  if (!state.fileId) return;
  clearTimeout(state.previewTimer);

  var sb = document.getElementById('sliceBtn');
  if (sb) { sb.disabled = true; sb.style.opacity = '0.5'; sb.style.cursor = 'wait'; }
  vadStart();

  state.previewTimer = setTimeout(async function () {
    try {
      var res = await fetch('/api/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          file_id:    state.fileId,
          mode:       state.mode,
          threshold:  parseFloat(document.getElementById('thrSlider').value),
          min_speech: parseInt(document.getElementById('speechSlider').value),
        }),
      });

      if (res.status === 429) { vadStop(); return; }

      var data = await res.json();
      if (data.ok && data.stats) {
        showTimeline(data.stats.segments_list, data.stats.original_duration);
        updateTimelineMeta(data.stats);
        showExportCard();
        var sb = document.getElementById('sliceBtn');
        if (sb) { sb.disabled = false; sb.style.opacity = ''; sb.style.cursor = ''; applyAccent(); }
      }
    } catch (_) {
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
