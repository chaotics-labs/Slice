/* export.js — Cut list export: EDL, FCPXML, Premiere Pro XML */
'use strict';

function exportEDL() {
  if (!state.segments.length) return;
  var fps  = state.fps || 25, name = state.filename || 'Slice';
  var lines = ['TITLE: ' + name + '_cuts', 'FCM: NON-DROP FRAME', ''];
  var recStart = 0;

  state.segments.forEach(function (seg, i) {
    var sIn = seg[0], sOut = seg[1], dur = sOut - sIn;
    var num = String(i + 1).padStart(3, '0');
    lines.push(num + '  AX       AA/V  C        ' +
      toTimecode(sIn, fps) + ' ' + toTimecode(sOut, fps) + ' ' +
      toTimecode(recStart, fps) + ' ' + toTimecode(recStart + dur, fps));
    lines.push('* FROM CLIP NAME: ' + name + '.mp4');
    lines.push('');
    recStart += dur;
  });

  downloadText(lines.join('\n'), name + '_cuts.edl', 'text/plain');
  pushLog('EDL exported — DaVinci Resolve / Avid (' + fps.toFixed(2) + 'fps)', 'success');
}

function exportFCPXML() {
  if (!state.segments.length) return;
  var fps = state.fps || 25, name = state.filename || 'Slice';
  var totalDur = state.segments.reduce(function (a, s) { return a + (s[1] - s[0]); }, 0);
  function rat(s) { return Math.round(s * fps) + '/' + fps + 's'; }

  var clips = '', off = 0;
  state.segments.forEach(function (seg, i) {
    var sIn = seg[0], sOut = seg[1], dur = sOut - sIn;
    clips +=
      '      <clip name="' + name + '_clip' + (i + 1) + '" offset="' + rat(off) +
      '" duration="' + rat(dur) + '" start="' + rat(sIn) + '">\n' +
      '        <video ref="r1" offset="' + rat(sIn) + '" duration="' + rat(dur) + '" start="' + rat(sIn) + '"/>\n' +
      '        <audio ref="r1" offset="' + rat(sIn) + '" duration="' + rat(dur) + '" start="' + rat(sIn) + '" role="dialogue"/>\n' +
      '      </clip>\n';
    off += dur;
  });

  var xml =
    '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE fcpxml>\n<fcpxml version="1.10">\n' +
    '  <resources>\n' +
    '    <format id="r0" name="FFVideoFormat1080p25" frameDuration="1/' + fps + 's" width="1920" height="1080"/>\n' +
    '    <asset id="r1" name="' + name + '" src="file:///' + name + '.mp4" duration="' + rat(state.duration) +
    '" hasVideo="1" hasAudio="1" audioSources="1" audioChannels="2" audioRate="48000"/>\n' +
    '  </resources>\n  <library>\n    <event name="' + name + '_cuts">\n      <project name="' + name + '_cuts">\n' +
    '        <sequence duration="' + rat(totalDur) + '" format="r0" tcStart="0s" tcFormat="NDF" audioLayout="stereo" audioRate="48k">\n' +
    '          <spine>\n' + clips + '          </spine>\n        </sequence>\n' +
    '      </project>\n    </event>\n  </library>\n</fcpxml>\n';

  downloadText(xml, name + '_cuts.fcpxml', 'application/xml');
  pushLog('FCPXML exported — Final Cut Pro / DaVinci XML', 'success');
}

function exportPremierePro() {
  if (!state.segments.length) return;
  var fps = state.fps || 25, name = state.filename || 'Slice';
  function fr(s) { return Math.round(s * fps); }

  var items = '', aItems = '', trackStart = 0;
  state.segments.forEach(function (seg, i) {
    var sIn = seg[0], sOut = seg[1], dur = sOut - sIn;
    var v =
      '      <clipitem id="clipitem-' + (i + 1) + '">\n' +
      '        <name>' + name + '_' + (i + 1) + '</name>\n' +
      '        <in>' + fr(sIn) + '</in><out>' + fr(sOut) + '</out>\n' +
      '        <start>' + fr(trackStart) + '</start><end>' + fr(trackStart + dur) + '</end>\n' +
      '        <file id="file-1"/>\n      </clipitem>\n';
    items += v;
    aItems += v.replace(/clipitem-/g, 'audioclip-');
    trackStart += dur;
  });

  var xml =
    '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE xmeml>\n<xmeml version="4">\n  <sequence>\n' +
    '    <name>' + name + '_cuts</name>\n' +
    '    <rate><timebase>' + fps + '</timebase><ntsc>FALSE</ntsc></rate>\n    <media>\n' +
    '      <video><track>\n' + items + '      </track></video>\n' +
    '      <audio><track>\n' + aItems + '      </track></audio>\n    </media>\n' +
    '    <file id="file-1">\n      <name>' + name + '</name>\n' +
    '      <pathurl>file:///' + name + '.mp4</pathurl>\n' +
    '      <rate><timebase>' + fps + '</timebase><ntsc>FALSE</ntsc></rate>\n' +
    '      <duration>' + fr(state.duration) + '</duration>\n' +
    '      <media><video/><audio/></media>\n    </file>\n  </sequence>\n</xmeml>\n';

  downloadText(xml, name + '_cuts.xml', 'application/xml');
  pushLog('Premiere Pro XML exported (XMEML v4)', 'success');
}