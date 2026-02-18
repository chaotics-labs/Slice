/* ════════════════════════════════════════════
   Chaotics Slice — App Logic
   ════════════════════════════════════════════ */

'use strict';

// ── State ─────────────────────────────────────────────────────────────────────
var state = {
  fileId:   null,
  jobId:    null,
  duration: 0,
  segments: [],
  mode:     'normal',
  previewTimer: null,
  filename: '',
  currentSegIdx: 0,
  previewActive: false,
  previewJumpTimer: null,
};

var jobs_done = {};  // jobId → true when download is available

var MODE_PRESETS = {
  chill:  { threshold: 0.4, min_speech: 400 },
  normal: { threshold: 0.5, min_speech: 250 },
  tight:  { threshold: 0.6, min_speech: 150 },
  savage: { threshold: 0.7, min_speech: 80  }
};
var MODE_HINTS = {
  chill:  'Natural pauses, gentle pacing',
  normal: 'Balanced cuts with natural pacing',
  tight:  'Aggressive — removes short pauses',
  savage: 'Maximum cuts, no mercy'
};

// ── Utils ─────────────────────────────────────────────────────────────────────
function fmtBytes(b) {
  if (!b) return '—';
  if (b<1e6) return (b/1024).toFixed(1)+' KB';
  if (b<1e9) return (b/1e6).toFixed(1)+' MB';
  return (b/1e9).toFixed(2)+' GB';
}
function fmtTime(s) {
  if (s<0) s=0;
  var m=Math.floor(s/60), sec=Math.floor(s%60);
  if (m>0) return m+':'+String(sec).padStart(2,'0');
  return s<10 ? s.toFixed(1)+'s' : sec+'s';
}
function toTimecode(secs,fps) {
  fps=fps||25;
  var tf=Math.round(secs*fps), fr=tf%fps, ts=Math.floor(tf/fps);
  var ss=ts%60, mm=Math.floor(ts/60)%60, hh=Math.floor(ts/3600);
  return String(hh).padStart(2,'0')+':'+String(mm).padStart(2,'0')+':'+String(ss).padStart(2,'0')+':'+String(fr).padStart(2,'0');
}

// Mode → accent color values (light and dark share the same hue, CSS tokens handle the shade)
var MODE_ACCENT_VARS = {
  chill:  { color: 'var(--teal)',   rgb: '50,173,230'  },
  normal: { color: 'var(--blue)',   rgb: '0,122,255'   },
  tight:  { color: 'var(--orange)', rgb: '255,149,0'   },
  savage: { color: 'var(--red)',    rgb: '255,59,48'   },
};

function applyAccent() {
  var a = MODE_ACCENT_VARS[state.mode];
  var root = document.documentElement;
  root.style.setProperty('--accent',     a.color);
  root.style.setProperty('--accent-rgb', a.rgb);
}

// ── Theme ─────────────────────────────────────────────────────────────────────
(function(){
  function getTheme(){
    try{var s=localStorage.getItem('cs-theme');if(s==='light'||s==='dark')return s;}catch(_){}
    return window.matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light';
  }
  function applyTheme(t){
    document.documentElement.setAttribute('data-theme',t);
    document.getElementById('iconSun').style.display  = t==='dark' ?'':'none';
    document.getElementById('iconMoon').style.display = t==='light'?'':'none';
  }
  var cur=getTheme(); applyTheme(cur);
  document.getElementById('themeBtn').addEventListener('click',function(){
    cur=cur==='dark'?'light':'dark';
    try{localStorage.setItem('cs-theme',cur);}catch(_){}
    applyTheme(cur);
    buildTracks(state.segments,state.duration);
  });
})();

// ── Log ───────────────────────────────────────────────────────────────────────
function pushLog(msg,level){
  var box=document.getElementById('logBox');
  var ph=box.querySelector('.log-placeholder'); if(ph) ph.remove();
  var d=document.createElement('div');
  d.className='log-'+(level||'info');
  d.textContent=msg;
  box.appendChild(d);
  box.scrollTop=box.scrollHeight;
}
function setProgress(pct){
  var pill=document.getElementById('progressPill');
  var fill=document.getElementById('progressFill');
  if(pct>0&&pct<100){
    pill.style.display='';
    fill.style.width=pct+'%';
    fill.style.background='var(--accent)';
    pill.setAttribute('data-pct', Math.round(pct)+'%');
  } else if(pct>=100){
    fill.style.width='100%';
    fill.style.background='var(--green)';
    pill.setAttribute('data-pct','100%');
    setTimeout(function(){pill.style.display='none';},800);
  } else {
    pill.style.display='none';
    fill.style.width='0%';
    pill.removeAttribute('data-pct');
  }
}

// Track mouse on progress pill so the tooltip follows the cursor
(function(){
  document.addEventListener('mousemove', function(e){
    var pill = document.getElementById('progressPill');
    if(!pill||pill.style.display==='none') return;
    var rect = pill.getBoundingClientRect();
    if(e.clientX<rect.left||e.clientX>rect.right||e.clientY<rect.top-40||e.clientY>rect.bottom+8) return;
    var pct = Math.max(0,Math.min(100,(e.clientX-rect.left)/rect.width*100));
    pill.style.setProperty('--tt-left', pct+'%');
  });
})();

// ── Sliders ───────────────────────────────────────────────────────────────────
function initSlider(sid,fid,vid,min,max,fmt){
  var sl=document.getElementById(sid),fi=document.getElementById(fid),va=document.getElementById(vid);
  function upd(){
    fi.style.width=((parseFloat(sl.value)-min)/(max-min)*100)+'%';
    va.textContent=fmt(sl.value);
  }
  sl.addEventListener('input',function(){upd();fetchPreview();});
  return upd;
}
var syncThr    = initSlider('thrSlider','thrFill','thrVal',0.1,0.9,function(v){return parseFloat(v).toFixed(2);});
var syncSpeech = initSlider('speechSlider','speechFill','speechVal',50,800,function(v){return v+' ms';});
syncThr(); syncSpeech();

// ── Timeline ──────────────────────────────────────────────────────────────────
function buildRuler(dur){
  var ruler=document.getElementById('tlRuler'); ruler.innerHTML='';
  if(!dur) return;
  var steps=[0.5,1,2,5,10,15,30,60,120,300];
  var step=steps.find(function(i){return dur/i<=10;})||300;
  for(var t=0;t<=dur+0.001;t+=step){
    var pct=Math.min(t,dur)/dur*100;
    var wrap=document.createElement('div'); wrap.style.cssText='position:absolute;left:'+pct+'%;top:0;bottom:0;';
    var tick=document.createElement('div'); tick.style.cssText='position:absolute;bottom:0;left:0;width:1px;height:6px;background:var(--sep-strong);';
    var lbl=document.createElement('span'); lbl.style.cssText='position:absolute;bottom:1px;left:3px;font-size:9px;color:var(--label-3);white-space:nowrap;font-variant-numeric:tabular-nums;font-family:-apple-system,sans-serif;';
    lbl.textContent=fmtTime(t);
    wrap.appendChild(tick); wrap.appendChild(lbl); ruler.appendChild(wrap);
  }
}
function buildTracks(segs,dur){
  var tkK=document.getElementById('trackKept'),tkC=document.getElementById('trackCut');
  [tkK,tkC].forEach(function(tr){Array.from(tr.children).forEach(function(c){if(!c.classList.contains('tl-playhead'))c.remove();});});
  if(!dur) return;
  var color='var(--accent)';
  segs.forEach(function(seg,idx){
    var s=seg[0],e=seg[1],lp=s/dur*100,wp=(e-s)/dur*100;
    if(wp<0.1) return;
    var clip=document.createElement('div');
    clip.className='tl-clip';
    clip.style.left=lp+'%'; clip.style.width=wp+'%'; clip.style.background=color;
    clip.style.cursor='pointer'; clip.style.pointerEvents='auto';
    clip.dataset.segIdx=idx;
    clip.addEventListener('click',function(ev){ev.stopPropagation();jumpToSegment(idx);if(!state.previewActive)startPreview();});
    var lh=document.createElement('div'); lh.className='tl-clip-handle left';
    var rh=document.createElement('div'); rh.className='tl-clip-handle right';
    clip.appendChild(lh); clip.appendChild(rh);
    tkK.appendChild(clip);
  });
  var gaps=[];
  if(segs.length===0){gaps.push([0,dur]);}
  else{
    if(segs[0][0]>0.1) gaps.push([0,segs[0][0]]);
    for(var i=0;i<segs.length-1;i++) gaps.push([segs[i][1],segs[i+1][0]]);
    if(segs[segs.length-1][1]<dur-0.1) gaps.push([segs[segs.length-1][1],dur]);
  }
  gaps.forEach(function(gap){
    var s=gap[0],e=gap[1],lp=s/dur*100,wp=(e-s)/dur*100;
    if(wp<0.1) return;
    var g=document.createElement('div'); g.className='tl-gap';
    g.style.left=lp+'%'; g.style.width=wp+'%';
    if(wp>3){var lbl=document.createElement('span');lbl.className='tl-gap-label';lbl.textContent=fmtTime(e-s);g.appendChild(lbl);}
    tkC.appendChild(g);
  });
}
function showTimeline(segs,dur){
  state.segments=segs||[]; state.duration=dur||0;
  document.getElementById('tlEmpty').style.display='none';
  document.getElementById('tlBody').style.display='';
  document.getElementById('tlAxisEnd').textContent=fmtTime(dur);
  document.getElementById('tlAxisMid').textContent=fmtTime(dur/2);
  buildRuler(dur); buildTracks(segs,dur);
}
function updateTimelineMeta(stats){
  var pc=document.getElementById('tlChipPct'),sc=document.getElementById('tlChipSegs');
  pc.textContent='-'+stats.pct_removed+'%'; pc.style.display='';
  pc.style.background='rgba(var(--accent-rgb),.12)'; pc.style.color='var(--accent)';
  sc.textContent=stats.segments+' segs'; sc.style.display='';
  document.getElementById('tlDurLabel').textContent=fmtTime(stats.original_duration);
  updateInfoPanel(stats);
}
function updateInfoPanel(stats){
  var orig=document.getElementById('pvInfoOriginal');
  var kept=document.getElementById('pvInfoKept');
  var remv=document.getElementById('pvInfoRemoved');
  var segs=document.getElementById('pvInfoSegs');
  var pct =document.getElementById('pvInfoPct');
  if(!orig) return;
  orig.textContent = fmtTime(stats.original_duration);
  kept.textContent = fmtTime(stats.kept);
  remv.textContent = '-'+fmtTime(stats.removed);
  segs.textContent = stats.segments;
  pct.textContent  = '-'+stats.pct_removed+'%';
  // Apply current accent color to accented values
  [kept,pct].forEach(function(el){ el.style.color='var(--accent)'; });
}

// ── Timeline hover ────────────────────────────────────────────────────────────
(function(){
  var tooltip=document.getElementById('tlTooltip');
  function onMove(e){
    var rect=e.currentTarget.getBoundingClientRect();
    var pct=Math.max(0,Math.min(1,(e.clientX-rect.left)/rect.width));
    var t=pct*state.duration;
    ['phKept','phCut'].forEach(function(id){var ph=document.getElementById(id);ph.style.display='';ph.style.left=(pct*100)+'%';});
    var inSeg=state.segments.find(function(s){return t>=s[0]&&t<=s[1];});
    var color='var(--accent)';
    tooltip.innerHTML='<span class="tl-tt-dot" style="background:'+(inSeg?color:'var(--label-3)')+'"></span>'+fmtTime(t)+' &middot; '+(inSeg?'<b style="color:'+color+'">kept</b>':'<span style="color:var(--label-3)">cut</span>');
    tooltip.classList.add('show');
    var tx=e.clientX-tooltip.offsetWidth/2, ty=e.clientY-40;
    tx=Math.max(8,Math.min(tx,window.innerWidth-tooltip.offsetWidth-8));
    tooltip.style.left=tx+'px'; tooltip.style.top=ty+'px';
  }
  function onLeave(){tooltip.classList.remove('show');document.querySelectorAll('.tl-playhead').forEach(function(p){p.style.display='none';});}
  ['trackKept','trackCut'].forEach(function(id){
    var el=document.getElementById(id);
    el.addEventListener('mousemove',onMove);
    el.addEventListener('mouseleave',onLeave);
  });
})();

// ── File handling ─────────────────────────────────────────────────────────────
//
// Click  → GET /api/browse  → server opens native OS file dialog → returns path
// Drop   → get File object from drag event → create object URL for preview
//           then POST /api/register with the dropped file's name heuristic
//
// For drag-drop the browser doesn't expose the full system path, so we call
// /api/browse after drop to let the user confirm via the native dialog —
// but we pre-seed the video preview from the File object immediately.
// ─────────────────────────────────────────────────────────────────────────────

var dropZone = document.getElementById('dropZone');
var fileChip = document.getElementById('fileChip');
var _browsing = false;  // guard against double-clicks

// Click anywhere on the dropzone → open native file picker on the server
dropZone.addEventListener('click', function() {
  if (state.fileId) return;   // already loaded
  openNativeFilePicker();
});

// Drag over
dropZone.addEventListener('dragover', function(e) {
  e.preventDefault();
  dropZone.classList.add('drag');
});
dropZone.addEventListener('dragleave', function() {
  dropZone.classList.remove('drag');
});

// Drop — register via native dialog (browser can't expose full path)
dropZone.addEventListener('drop', function(e) {
  e.preventDefault();
  dropZone.classList.remove('drag');
  var file = e.dataTransfer.files[0];
  if (!file) return;
  setDropZoneLoading(file.name);
  openNativeFilePicker(file.name);
});

// Clear button
document.getElementById('chipClear').addEventListener('click', resetState);

async function openNativeFilePicker(hintName) {
  if (_browsing) return;
  _browsing = true;

  if (!hintName) {
    // Show a subtle loading state on the dropzone itself
    setDropZoneLoading(null);
  }

  try {
    var res  = await fetch('/api/browse');
    var data = await res.json();

    if (data.cancelled || !data.path) {
      // User hit cancel — restore dropzone
      restoreDropZone();
      _browsing = false;
      return;
    }

    if (data.error) {
      pushLog('Browse error: ' + data.error, 'error');
      restoreDropZone();
      _browsing = false;
      return;
    }

    await registerPath(data.path);
  } catch(e) {
    pushLog('Error: ' + e.message, 'error');
    restoreDropZone();
  }
  _browsing = false;
}

async function registerPath(filePath) {
  var filename = filePath.split(/[\\/]/).pop();
  state.filename = filename.replace(/\.[^.]+$/, '');

  // Switch to chip view
  dropZone.style.display = 'none';
  fileChip.classList.add('show');
  document.getElementById('chipName').textContent = filename;
  document.getElementById('chipSize').textContent = '…';
  document.getElementById('logBox').innerHTML = '';
  setChipLoading();
  pushLog('Loading ' + filename + '…');

  try {
    var res  = await fetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: filePath })
    });
    var data = await res.json();

    if (!res.ok) {
      pushLog('Error: ' + (data.error || 'Registration failed'), 'error');
      setChipError();
      dropZone.style.display = '';
      fileChip.classList.remove('show');
      return;
    }

    onFileReady(data);
  } catch(e) {
    pushLog('Error: ' + e.message, 'error');
    setChipError();
    dropZone.style.display = '';
    fileChip.classList.remove('show');
  }
}

function setDropZoneLoading(name) {
  var titleEl = dropZone.querySelector('.dz-title');
  var subEl   = dropZone.querySelector('.dz-sub');
  if (titleEl) titleEl.textContent = name ? name : 'Opening…';
  if (subEl)   subEl.textContent   = name ? 'Opening file dialog…' : 'Choose a video file';
  dropZone.style.pointerEvents = 'none';
  dropZone.style.opacity = '0.6';
}

function restoreDropZone() {
  var titleEl = dropZone.querySelector('.dz-title');
  var subEl   = dropZone.querySelector('.dz-sub');
  if (titleEl) titleEl.textContent = 'Drop video here';
  if (subEl)   subEl.textContent   = 'or click to browse · MP4 · MKV · MOV · AVI · WebM';
  dropZone.style.pointerEvents = '';
  dropZone.style.opacity = '';
}

function onFileReady(data) {
  state.fileId   = data.file_id;
  state.duration = data.duration;
  document.getElementById('chipSize').textContent = fmtBytes(data.size);
  setChipReady();

  // Always stream from backend — works for both click-browse and drag-drop
  setupVideoPreview('/api/video/' + data.file_id);

  pushLog('Ready — ' + fmtTime(data.duration) + ' · ' + fmtBytes(data.size), 'success');
  document.getElementById('sliceBtn').disabled = true; // enabled after VAD preview
  applyAccent();
  fetchPreview();
}

function resetState() {
  state.fileId=null; state.jobId=null; state.duration=0; state.segments=[]; state.filename='';
  _browsing=false;
  jobs_done={};
  db.stop();
  fileChip.classList.remove('show');
  dropZone.style.display='';
  restoreDropZone();
  document.getElementById('sliceBtn').disabled=true;
  document.getElementById('tlEmpty').style.display='';
  document.getElementById('tlBody').style.display='none';
  var vs=document.getElementById('tlVadState'); if(vs){vs.classList.remove('active','visible');}
  document.getElementById('tlChipPct').style.display='none';
  document.getElementById('tlChipSegs').style.display='none';
  document.getElementById('tlDurLabel').textContent='';
  document.getElementById('statsCard').style.display='none';
  document.getElementById('logBox').innerHTML='<span class="log-placeholder">Waiting for input…</span>';
  setProgress(0);
  renderActions('idle');
  var vp=document.getElementById('videoPreviewCard'); if(vp) vp.style.display='none';
  var ec=document.getElementById('exportCard'); if(ec) ec.style.display='none';
}

function setChipLoading(){
  document.getElementById('chipIcon').innerHTML='<div class="spin" style="color:var(--accent)"></div>';
}
function setChipReady(){
  document.getElementById('chipIcon').innerHTML='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="15" rx="2"/><polyline points="17 2 12 7 7 2"/></svg>';
  document.getElementById('chipIcon').style.color='var(--accent)';
}
function setChipError(){
  document.getElementById('chipIcon').innerHTML='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--red)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';
}

// ══════════════════════════════════════════════════════════════════════════════
// ── Double-Buffer Video Engine ────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════
var db = (function(){
  var _els=[null,null], _active=0, _ready=[false,false];
  function _idle(){return 1-_active;}
  function _init(){
    var ref=document.getElementById('previewVideo');
    var container=ref.parentNode;
    container.style.position='relative'; container.style.overflow='hidden';
    _els[0]=ref; _els[1]=document.createElement('video');
    [0,1].forEach(function(i){
      var el=_els[i];
      el.style.position='absolute'; el.style.top='0'; el.style.left='0';
      el.style.width='100%'; el.style.height='100%';
      el.style.objectFit='contain'; el.style.background='transparent';
      el.preload='auto'; el.style.transition='opacity 0.05s linear';
    });
    _els[0].style.opacity='1'; _els[1].style.opacity='0';
    container.appendChild(_els[1]);
    [0,1].forEach(function(i){
      _els[i].addEventListener('timeupdate',function(){
        if(i!==_active||!state.duration) return;
        var ph=document.getElementById('pvPlayheadBar');
        if(ph) ph.style.left=(_els[i].currentTime/state.duration*100)+'%';
      });
      _els[i].addEventListener('ended',function(){
        if(i!==_active) return;
        state.previewActive=false; updatePreviewUI();
      });
    });
  }
  function load(src){
    _ready=[false,false]; _active=0;
    [0,1].forEach(function(i){_els[i].src=src;_els[i].load();});
    _els[0].style.opacity='1'; _els[1].style.opacity='0';
  }
  function preseek(idx){
    if(!state.segments[idx]) return;
    var i=_idle(), t=state.segments[idx][0]; _ready[i]=false;
    function doSeek(){_els[i].currentTime=t;}
    if(_els[i].readyState>=1){doSeek();}
    else{_els[i].addEventListener('loadedmetadata',function onM(){_els[i].removeEventListener('loadedmetadata',onM);doSeek();});}
    _els[i].addEventListener('seeked',function onS(){_els[i].removeEventListener('seeked',onS);_ready[i]=true;});
  }
  function seek(t){_els[_active].currentTime=t;}
  function cut(idx,cb){
    if(!state.segments[idx]) return;
    var i=_idle(), target=state.segments[idx][0];
    function doSwap(){
      _els[_active].style.opacity='0'; _els[i].style.opacity='1'; _els[_active].pause(); _active=i;
      state.currentSegIdx=idx; updateSegCounter(); highlightActiveClip(idx);
      _els[_active].play().then(function(){if(cb)cb();preseek(idx+1);}).catch(function(e){
        pushLog('Preview error: '+e.message,'error'); state.previewActive=false; updatePreviewUI();
      });
    }
    if(_ready[i]){doSwap();}
    else{
      var done=false;
      function onSeeked(){if(done)return;done=true;_els[i].removeEventListener('seeked',onSeeked);_ready[i]=true;doSwap();}
      _els[i].addEventListener('seeked',onSeeked);
      if(_els[i].readyState>=1){_els[i].currentTime=target;}
      else{_els[i].addEventListener('loadedmetadata',function onM(){_els[i].removeEventListener('loadedmetadata',onM);_els[i].currentTime=target;});}
      setTimeout(function(){
        if(done)return;done=true;_els[i].removeEventListener('seeked',onSeeked);
        _els[_active].currentTime=target;state.currentSegIdx=idx;updateSegCounter();highlightActiveClip(idx);if(cb)cb();preseek(idx+1);
      },400);
    }
  }
  function play(){return _els[_active].play();}
  function pause(){_els[_active].pause();}
  function currentTime(){return _els[_active].currentTime;}
  function stop(){[0,1].forEach(function(i){if(_els[i]){_els[i].pause();_els[i].removeAttribute('src');_els[i].load();}});_ready=[false,false];}
  _init();
  return {load:load,preseek:preseek,seek:seek,cut:cut,play:play,pause:pause,currentTime:currentTime,stop:stop};
})();

// ── Video Preview ─────────────────────────────────────────────────────────────
function setupVideoPreview(objectUrl){
  var card=document.getElementById('videoPreviewCard'); card.style.display='';
  state.currentSegIdx=0; state.previewActive=false;
  db.load(objectUrl); updatePreviewUI();
}
function jumpToSegment(idx){
  if(!state.segments.length) return;
  idx=Math.max(0,Math.min(idx,state.segments.length-1));
  if(state.previewActive){clearTimeout(state.previewJumpTimer);db.cut(idx,function(){scheduleNextJump(idx);});}
  else{state.currentSegIdx=idx;db.seek(state.segments[idx][0]);updateSegCounter();highlightActiveClip(idx);db.preseek(idx+1);}
}
function scheduleNextJump(idx){
  clearTimeout(state.previewJumpTimer);
  if(!state.previewActive) return;
  var endTime=state.segments[idx][1];
  function checkEnd(){
    if(!state.previewActive) return;
    if(db.currentTime()>=endTime-0.05){
      var next=idx+1;
      if(next<state.segments.length){db.cut(next,function(){scheduleNextJump(next);});}
      else{state.previewActive=false;updatePreviewUI();highlightActiveClip(-1);}
      return;
    }
    state.previewJumpTimer=setTimeout(checkEnd,40);
  }
  state.previewJumpTimer=setTimeout(checkEnd,40);
}
function startPreview(){
  if(!state.segments.length) return;
  state.previewActive=true; updatePreviewUI();
  var idx=state.currentSegIdx;
  db.seek(state.segments[idx][0]); db.preseek(idx+1);
  db.play().then(function(){scheduleNextJump(idx);}).catch(function(e){
    pushLog('Preview error: '+e.message,'error'); state.previewActive=false; updatePreviewUI();
  });
}
function pausePreview(){state.previewActive=false;clearTimeout(state.previewJumpTimer);db.pause();updatePreviewUI();}
function updatePreviewUI(){
  var pb=document.getElementById('pvPlayBtn'),pau=document.getElementById('pvPauseBtn');
  if(!pb) return;
  pb.style.display=state.previewActive?'none':'';
  pau.style.display=state.previewActive?'':'none';
  updateSegCounter();
}
function updateSegCounter(){
  var c=document.getElementById('pvSegCounter'); if(!c) return;
  if(!state.segments.length){c.textContent='No cuts yet';return;}
  c.textContent='Seg '+(state.currentSegIdx+1)+' / '+state.segments.length;
}
function highlightActiveClip(idx){
  document.querySelectorAll('.tl-clip').forEach(function(clip,i){
    clip.style.outline      =(i===idx)?'2px solid rgba(255,255,255,.85)':'';
    clip.style.outlineOffset=(i===idx)?'2px':'';
  });
}

// ── Preview (VAD) ─────────────────────────────────────────────────────────────
// ── VAD indicator ─────────────────────────────────────────────────────────────
function vadStart() {
  var empty = document.getElementById('tlEmpty');
  var vad   = document.getElementById('tlVadState');
  var body  = document.getElementById('tlBody');
  if (!vad) return;
  if (empty) empty.style.display = 'none';
  if (body)  body.style.display  = 'none';
  vad.classList.add('active');
  requestAnimationFrame(function() {
    requestAnimationFrame(function() { vad.classList.add('visible'); });
  });
}
function vadStop() {
  var vad = document.getElementById('tlVadState');
  if (!vad) return;
  vad.classList.remove('visible');
  setTimeout(function() { vad.classList.remove('active'); }, 260);
}

function fetchPreview(){
  if(!state.fileId) return;
  clearTimeout(state.previewTimer);
  var sb=document.getElementById('sliceBtn');
  if(sb){sb.disabled=true;sb.style.opacity='0.5';sb.style.cursor='wait';}
  vadStart();
  state.previewTimer=setTimeout(async function(){
    try{
      var res=await fetch('/api/preview',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
          file_id:state.fileId, mode:state.mode,
          threshold:parseFloat(document.getElementById('thrSlider').value),
          min_speech:parseInt(document.getElementById('speechSlider').value)
        })
      });
      if(res.status===429){vadStop();return;}
      var data=await res.json();
      if(data.ok&&data.stats){
        showTimeline(data.stats.segments_list,data.stats.original_duration);
        updateTimelineMeta(data.stats);
        showExportCard();
        var sb=document.getElementById('sliceBtn');
        if(sb){sb.disabled=false;sb.style.opacity='';sb.style.cursor='';applyAccent();}
      }
    } catch(_){
      var sb=document.getElementById('sliceBtn');
      if(sb){sb.disabled=false;sb.style.opacity='';sb.style.cursor='';}
    } finally {
      vadStop();
    }
  }, 800);
}
function showExportCard(){
  if(!state.segments.length) return;
  var ec=document.getElementById('exportCard'); if(ec) ec.style.display='';
}

// ── Mode selector ─────────────────────────────────────────────────────────────
document.getElementById('modeSelector').addEventListener('click',function(e){
  var btn=e.target.closest('.seg-btn'); if(!btn) return;
  if(btn.classList.contains('active')) return; // already selected, no-op

  // If a processed video is ready, confirm before discarding it
  if(state.jobId && jobs_done[state.jobId]) {
    var ok = confirm('Switching presets will discard the current processed video. Continue?');
    if(!ok) return;
    // Reset action area back to slice button
    jobs_done[state.jobId] = false;
    document.getElementById('statsCard').style.display='none';
    setProgress(0);
    document.getElementById('logBox').innerHTML='<span class="log-placeholder">Ready.</span>';
    renderActions('idle');
  }

  document.querySelectorAll('.seg-btn').forEach(function(b){b.classList.remove('active');});
  btn.classList.add('active');
  state.mode=btn.dataset.mode;
  var p=MODE_PRESETS[state.mode];
  document.getElementById('thrSlider').value=p.threshold;
  document.getElementById('speechSlider').value=p.min_speech;
  syncThr(); syncSpeech();
  document.getElementById('modeHint').textContent=MODE_HINTS[state.mode];
  applyAccent();
  buildTracks(state.segments,state.duration);
  fetchPreview();
});

// ── Pro toggle ────────────────────────────────────────────────────────────────
document.getElementById('proToggle').addEventListener('click',function(){
  var panel=document.getElementById('proPanel');
  var expanded=this.getAttribute('aria-expanded')==='true';
  this.setAttribute('aria-expanded',String(!expanded));
  if(expanded) panel.setAttribute('hidden',''); else panel.removeAttribute('hidden');
});

// ── Slice ─────────────────────────────────────────────────────────────────────
document.getElementById('actionArea').addEventListener('click',function(e){if(e.target.closest('#sliceBtn'))doSlice();});
async function doSlice(){
  if(!state.fileId) return;
  var sb=document.getElementById('sliceBtn'); sb.disabled=true;
  document.getElementById('statsCard').style.display='none';
  document.getElementById('logBox').innerHTML='';
  setProgress(0); pushLog('Starting job…');
  try{
    var res=await fetch('/api/process',{
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        file_id:state.fileId, mode:state.mode,
        threshold:parseFloat(document.getElementById('thrSlider').value),
        min_speech:parseInt(document.getElementById('speechSlider').value)
      })
    });
    var data=await res.json();
    if(!res.ok) throw new Error(data.error);
    state.jobId=data.job_id;
    var sse=new EventSource('/api/logs/'+state.jobId);
    var _totalSegs=0;
    sse.onmessage=function(e){
      var item=JSON.parse(e.data);
      if(item.done){sse.close();return;}
      pushLog(item.msg,item.level);

      // "Encoding 59 segments (4 workers)…" — grab total, show bar at 0
      var mTotal=item.msg.match(/Encoding (\d+) segments/);
      if(mTotal){ _totalSegs=parseInt(mTotal[1]); setProgress(1); }

      // "Encoded 10/59 segments" — 0→100% exclusively
      var mDone=item.msg.match(/Encoded (\d+)\/(\d+) segments/);
      if(mDone){
        var done=parseInt(mDone[1]), total=parseInt(mDone[2])||_totalSegs||1;
        setProgress(Math.round(done/total * 100));
      }
    };
    var poll=setInterval(async function(){
      try{
        var sr=await fetch('/api/status/'+state.jobId);
        if(sr.status===404){clearInterval(poll);return;}
        var sd=await sr.json();
        if(sd.status==='done'){clearInterval(poll);onJobDone(sd.stats);}
        else if(sd.status==='error'){clearInterval(poll);pushLog(sd.error||'Error','error');sb.disabled=false;}
      } catch(_){}
    },600);
  } catch(e){
    pushLog('Error: '+e.message,'error');
    document.getElementById('sliceBtn').disabled=false;
  }
}
function onJobDone(stats){
  setProgress(100);
  jobs_done[state.jobId] = true;
  if(stats){
    showTimeline(stats.segments_list,stats.original_duration);
    updateTimelineMeta(stats);
    document.getElementById('statPct').textContent=stats.pct_removed+'%';   document.getElementById('statPct').style.color='var(--accent)';
    document.getElementById('statCut').textContent=fmtTime(stats.removed);  document.getElementById('statCut').style.color='var(--accent)';
    document.getElementById('statSegs').textContent=stats.segments;          document.getElementById('statSegs').style.color='var(--accent)';
    document.getElementById('statsCard').style.display='';
    showExportCard();
  }
  renderActions('done');
}

// ── Actions ───────────────────────────────────────────────────────────────────
function renderActions(phase){
  var area=document.getElementById('actionArea');
  if(phase==='done'){
    area.innerHTML=
      '<a href="/api/download/'+state.jobId+'" class="btn-primary btn-download">'+
        '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>'+
        'Download'+
      '</a>'+
      '<button class="btn-secondary" id="againBtn">Process Another File</button>';
    document.getElementById('againBtn').addEventListener('click',function(){
      document.getElementById('statsCard').style.display='none';
      setProgress(0);
      document.getElementById('logBox').innerHTML='<span class="log-placeholder">Ready.</span>';
      renderActions('idle');
    });
  } else {
    area.innerHTML=
      '<button class="btn-primary" id="sliceBtn"'+(state.fileId?'':' disabled')+'>'+
        '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4 8.12 15.88M14.47 14.48 20 20M8.12 8.12 12 12"/></svg>'+
        'Slice'+
      '</button>';
  }
}

// ── Export: EDL ───────────────────────────────────────────────────────────────
function exportEDL(){
  if(!state.segments.length) return;
  var fps=25,name=state.filename||'ChaoticSlice';
  var lines=['TITLE: '+name+'_cuts','FCM: NON-DROP FRAME',''];
  var recStart=0;
  state.segments.forEach(function(seg,i){
    var sIn=seg[0],sOut=seg[1],dur=sOut-sIn;
    var num=String(i+1).padStart(3,'0');
    lines.push(num+'  AX       AA/V  C        '+toTimecode(sIn,fps)+' '+toTimecode(sOut,fps)+' '+toTimecode(recStart,fps)+' '+toTimecode(recStart+dur,fps));
    lines.push('* FROM CLIP NAME: '+name+'.mp4');
    lines.push('');
    recStart+=dur;
  });
  downloadText(lines.join('\n'),name+'_cuts.edl','text/plain');
  pushLog('EDL exported — DaVinci Resolve / Avid (25fps)','success');
}
function exportFCPXML(){
  if(!state.segments.length) return;
  var fps=25,name=state.filename||'ChaoticSlice';
  var totalDur=state.segments.reduce(function(a,s){return a+(s[1]-s[0]);},0);
  function rat(s){return Math.round(s*fps)+'/'+fps+'s';}
  var clips='',off=0;
  state.segments.forEach(function(seg,i){
    var sIn=seg[0],sOut=seg[1],dur=sOut-sIn;
    clips+='      <clip name="'+name+'_clip'+(i+1)+'" offset="'+rat(off)+'" duration="'+rat(dur)+'" start="'+rat(sIn)+'">\n'+
           '        <video ref="r1" offset="'+rat(sIn)+'" duration="'+rat(dur)+'" start="'+rat(sIn)+'"/>\n'+
           '        <audio ref="r1" offset="'+rat(sIn)+'" duration="'+rat(dur)+'" start="'+rat(sIn)+'" role="dialogue"/>\n'+
           '      </clip>\n';
    off+=dur;
  });
  var xml='<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE fcpxml>\n<fcpxml version="1.10">\n'+
    '  <resources>\n    <format id="r0" name="FFVideoFormat1080p25" frameDuration="1/'+fps+'s" width="1920" height="1080"/>\n'+
    '    <asset id="r1" name="'+name+'" src="file:///'+name+'.mp4" duration="'+rat(state.duration)+'" hasVideo="1" hasAudio="1" audioSources="1" audioChannels="2" audioRate="48000"/>\n'+
    '  </resources>\n  <library>\n    <event name="'+name+'_cuts">\n      <project name="'+name+'_cuts">\n'+
    '        <sequence duration="'+rat(totalDur)+'" format="r0" tcStart="0s" tcFormat="NDF" audioLayout="stereo" audioRate="48k">\n'+
    '          <spine>\n'+clips+'          </spine>\n        </sequence>\n      </project>\n    </event>\n  </library>\n</fcpxml>\n';
  downloadText(xml,name+'_cuts.fcpxml','application/xml');
  pushLog('FCPXML exported — Final Cut Pro / DaVinci XML','success');
}
function exportPremierePro(){
  if(!state.segments.length) return;
  var fps=25,name=state.filename||'ChaoticSlice';
  function fr(s){return Math.round(s*fps);}
  var items='',aItems='',trackStart=0;
  state.segments.forEach(function(seg,i){
    var sIn=seg[0],sOut=seg[1],dur=sOut-sIn;
    var v='      <clipitem id="clipitem-'+(i+1)+'">\n        <name>'+name+'_'+(i+1)+'</name>\n        <in>'+fr(sIn)+'</in><out>'+fr(sOut)+'</out>\n        <start>'+fr(trackStart)+'</start><end>'+fr(trackStart+dur)+'</end>\n        <file id="file-1"/>\n      </clipitem>\n';
    items+=v; aItems+=v.replace(/clipitem-/g,'audioclip-'); trackStart+=dur;
  });
  var xml='<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE xmeml>\n<xmeml version="4">\n  <sequence>\n    <name>'+name+'_cuts</name>\n'+
    '    <rate><timebase>'+fps+'</timebase><ntsc>FALSE</ntsc></rate>\n    <media>\n'+
    '      <video><track>\n'+items+'      </track></video>\n      <audio><track>\n'+aItems+'      </track></audio>\n    </media>\n'+
    '    <file id="file-1">\n      <name>'+name+'</name>\n      <pathurl>file:///'+name+'.mp4</pathurl>\n'+
    '      <rate><timebase>'+fps+'</timebase><ntsc>FALSE</ntsc></rate>\n      <duration>'+fr(state.duration)+'</duration>\n'+
    '      <media><video/><audio/></media>\n    </file>\n  </sequence>\n</xmeml>\n';
  downloadText(xml,name+'_cuts.xml','application/xml');
  pushLog('Premiere Pro XML exported (XMEML v4)','success');
}
function downloadText(content,filename,mimeType){
  var blob=new Blob([content],{type:mimeType});
  var url=URL.createObjectURL(blob);
  var a=document.createElement('a'); a.href=url; a.download=filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(function(){URL.revokeObjectURL(url);},1000);
}

// ── Wire controls ─────────────────────────────────────────────────────────────
(function(){
  function wire(id,fn){var el=document.getElementById(id);if(el)el.addEventListener('click',fn);}
  wire('pvPlayBtn',   function(){if(state.segments.length)startPreview();});
  wire('pvPauseBtn',  pausePreview);
  wire('pvPrevBtn',   function(){jumpToSegment(state.currentSegIdx-1);});
  wire('pvNextBtn',   function(){jumpToSegment(state.currentSegIdx+1);});
  wire('exportEdlBtn',exportEDL);
  wire('exportFcpBtn',exportFCPXML);
  wire('exportPpBtn', exportPremierePro);
})();