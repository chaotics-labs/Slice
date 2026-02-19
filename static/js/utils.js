/* utils.js — Pure formatting helpers */
'use strict';

function fmtBytes(b) {
  if (!b) return '—';
  if (b < 1e6) return (b / 1024).toFixed(1) + ' KB';
  if (b < 1e9) return (b / 1e6).toFixed(1) + ' MB';
  return (b / 1e9).toFixed(2) + ' GB';
}

function fmtTime(s) {
  if (s < 0) s = 0;
  var m = Math.floor(s / 60), sec = Math.floor(s % 60);
  if (m > 0) return m + ':' + String(sec).padStart(2, '0');
  return s < 10 ? s.toFixed(1) + 's' : sec + 's';
}

function toTimecode(secs, fps) {
  fps = fps || 25;
  var tf = Math.round(secs * fps), fr = tf % fps, ts = Math.floor(tf / fps);
  var ss = ts % 60, mm = Math.floor(ts / 60) % 60, hh = Math.floor(ts / 3600);
  return String(hh).padStart(2,'0') + ':' + String(mm).padStart(2,'0') + ':' +
         String(ss).padStart(2,'0') + ':' + String(fr).padStart(2,'0');
}

function downloadText(content, filename, mimeType) {
  var blob = new Blob([content], { type: mimeType });
  var url  = URL.createObjectURL(blob);
  var a    = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
}