/* ui.js — Log panel, progress pill, file chip states, theme toggle, accent color */
'use strict';

// ── Theme ─────────────────────────────────────────────────────────────────────
(function () {
  function getTheme() {
    try { var s = localStorage.getItem('cs-theme'); if (s === 'light' || s === 'dark') return s; } catch (_) {}
    return window.matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light';
  }
  function applyTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    document.getElementById('iconSun').style.display  = t === 'dark'  ? '' : 'none';
    document.getElementById('iconMoon').style.display = t === 'light' ? '' : 'none';
  }
  var cur = getTheme();
  applyTheme(cur);
  document.getElementById('themeBtn').addEventListener('click', function () {
    cur = cur === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem('cs-theme', cur); } catch (_) {}
    applyTheme(cur);
    buildTracks(state.segments, state.duration);
  });
})();

// ── Accent color ──────────────────────────────────────────────────────────────
function applyAccent() {
  var a = MODE_ACCENT_VARS[state.mode];
  document.documentElement.style.setProperty('--accent',     a.color);
  document.documentElement.style.setProperty('--accent-rgb', a.rgb);
}

// ── Log panel ─────────────────────────────────────────────────────────────────
function pushLog(msg, level) {
  var box = document.getElementById('logBox');
  var ph  = box.querySelector('.log-placeholder');
  if (ph) ph.remove();
  var d = document.createElement('div');
  d.className  = 'log-' + (level || 'info');
  d.textContent = msg;
  box.appendChild(d);
  box.scrollTop = box.scrollHeight;
}

// ── Progress pill ─────────────────────────────────────────────────────────────
function setProgress(pct) {
  var pill = document.getElementById('progressPill');
  var fill = document.getElementById('progressFill');
  if (pct > 0 && pct < 100) {
    pill.style.display = '';
    fill.style.width   = pct + '%';
    fill.style.background = 'var(--accent)';
    pill.setAttribute('data-pct', Math.round(pct) + '%');
  } else if (pct >= 100) {
    fill.style.width   = '100%';
    fill.style.background = 'var(--green)';
    pill.setAttribute('data-pct', '100%');
    setTimeout(function () { pill.style.display = 'none'; }, 800);
  } else {
    pill.style.display = 'none';
    fill.style.width   = '0%';
    pill.removeAttribute('data-pct');
  }
}

// Tooltip position tracking for progress pill
document.addEventListener('mousemove', function (e) {
  var pill = document.getElementById('progressPill');
  if (!pill || pill.style.display === 'none') return;
  var rect = pill.getBoundingClientRect();
  if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top - 40 || e.clientY > rect.bottom + 8) return;
  pill.style.setProperty('--tt-left', ((e.clientX - rect.left) / rect.width * 100) + '%');
});

// ── File chip states ──────────────────────────────────────────────────────────
function setChipLoading() {
  document.getElementById('chipIcon').innerHTML =
    '<div class="spin" style="color:var(--accent)"></div>';
}

function setChipReady() {
  var icon = document.getElementById('chipIcon');
  icon.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="15" rx="2"/><polyline points="17 2 12 7 7 2"/></svg>';
  icon.style.color = 'var(--accent)';
}

function setChipError() {
  document.getElementById('chipIcon').innerHTML =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--red)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';
}