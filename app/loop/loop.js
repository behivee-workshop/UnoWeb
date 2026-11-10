(function(){
  "use strict";
  const { iconSvg, createDeviceManager, createMetronome } = window.KB;

  const metronome = createMetronome({
    playBtn: document.getElementById('metroPlay'), bpmDown: document.getElementById('bpmDown'),
    bpmUp: document.getElementById('bpmUp'), bpmReadout: document.getElementById('bpmReadout'),
    beatDot: document.getElementById('beatDot'),
  });
  // Playback stays free-time. The metronome only supplies the bar boundary for closing
  // an initial recording pass.

  /* ---------------- device settings drawer ---------------- */
  const panelMain = document.getElementById('panelMain');
  const panelDevice = document.getElementById('panelDevice');
  const settingsBtn = document.getElementById('settingsBtn');
  let onDevice = false;
  settingsBtn.addEventListener('click', () => {
    onDevice = !onDevice;
    panelMain.inert = onDevice;
    panelMain.setAttribute('aria-hidden', String(onDevice));
    panelDevice.classList.toggle('active', onDevice);
    settingsBtn.setAttribute('aria-pressed', String(onDevice));
    settingsBtn.setAttribute('aria-expanded', String(onDevice));
  });
  window.addEventListener('keydown', e => { if (e.key === 'Escape' && onDevice) settingsBtn.click(); });

  const looperHelpBtn = document.getElementById('looperHelpBtn');
  const looperHelp = document.getElementById('looperHelp');
  function setLooperHelp(open){
    looperHelp.hidden = !open;
    looperHelpBtn.setAttribute('aria-expanded', String(open));
  }
  looperHelpBtn.addEventListener('click', () => setLooperHelp(looperHelp.hidden));
  window.addEventListener('keydown', e => { if (e.key === 'Escape' && !looperHelp.hidden) setLooperHelp(false); });

  /* ================= LOOPER: Boss RC-5 style, per track =================
     Two controls per track (play/pause, overdub), not one cycling button — see ARCHITECTURE.md.
     state machine per track: empty -> armed -> recording -> finishing -> playing <-> paused,
     with playing <-> overdubbing.
     Each track's loop length is whatever it was when you closed it — independent per track,
     same "polymetric, no shared bar length" idea as Sheet. */
  const TRACKS = [
    { id:1, ch:1, color:'var(--t1)' },
    { id:2, ch:2, color:'var(--t2)' },
    { id:3, ch:3, color:'var(--t3)' },
    { id:4, ch:4, color:'var(--t4)' },
  ].map(t => Object.assign(t, { state:'empty', muted:false, loopLenMs:null, loopBars:null, events:[], loopStartAt:0, recordStartAt:0, recordStopAt:0, armTimer:null, finishTimer:null, overdubStartIndex:null, undoOverdub:null, pausedAt:0, lastElapsed:0 }));

  const els = {};
  let selectedTrackId = 1;
  const tracksEl = document.getElementById('looperTracks');
  TRACKS.forEach(tr => {
    const row = document.createElement('div'); row.className = 'loop-track'; row.style.setProperty('--track-color', tr.color);

    const head = document.createElement('div'); head.className = 'loop-track-head';
    head.innerHTML = `<span class="swatch"></span><b>Track ${tr.id}</b><small>CH${tr.ch}</small>`;
    const barsEl = document.createElement('span'); barsEl.className = 'loop-bars';
    const stateEl = document.createElement('span'); stateEl.className = 'loop-state'; stateEl.textContent = 'Empty';
    head.append(barsEl, stateEl);

    const controls = document.createElement('div'); controls.className = 'loop-track-controls';
    const playBtn = document.createElement('button'); playBtn.className = 'tbtn primary'; playBtn.setAttribute('aria-label', 'Play, pause, or record');
    const overdubBtn = document.createElement('button'); overdubBtn.className = 'tbtn'; overdubBtn.setAttribute('aria-label', 'Overdub'); overdubBtn.innerHTML = iconSvg('repeat');
    const clearBtn = document.createElement('button'); clearBtn.className = 'tbtn'; clearBtn.setAttribute('aria-label', 'Clear track'); clearBtn.innerHTML = iconSvg('trash');
    const muteBtn = document.createElement('button'); muteBtn.className = 'mute-btn'; muteBtn.setAttribute('aria-pressed', 'false'); muteBtn.setAttribute('aria-label', 'Mute track'); muteBtn.innerHTML = iconSvg('volumeX');
    controls.append(playBtn, overdubBtn, clearBtn, muteBtn);

    const progress = document.createElement('div'); progress.className = 'loop-progress';
    const progressFill = document.createElement('div'); progressFill.className = 'loop-progress-fill';
    progress.appendChild(progressFill);

    row.append(head, controls, progress);
    tracksEl.appendChild(row);
    els[tr.id] = { row, barsEl, stateEl, playBtn, overdubBtn, clearBtn, muteBtn, progressFill };

    playBtn.addEventListener('click', () => onPlayPause(tr));
    overdubBtn.addEventListener('click', () => onOverdub(tr));
    clearBtn.addEventListener('click', () => onClear(tr));
    muteBtn.addEventListener('click', () => {
      toggleMute(tr);
    });
    row.addEventListener('click', () => selectTrack(tr.id));
  });

  function selectedTrack(){ return TRACKS.find(tr => tr.id === selectedTrackId); }
  function selectTrack(id){
    selectedTrackId = id;
    TRACKS.forEach(tr => els[tr.id].row.classList.toggle('selected', tr.id === id));
  }
  function toggleMute(tr){
    tr.muted = !tr.muted;
    els[tr.id].muteBtn.setAttribute('aria-pressed', String(tr.muted));
    els[tr.id].row.classList.toggle('muted', tr.muted);
  }

  function onPlayPause(tr){
    const now = performance.now();
    if (tr.state === 'empty') {
      const timeToBarStart = metronome.getTimeToNextBar();
      if (timeToBarStart == null) beginRecording(tr, now);
      else {
        tr.state = 'armed';
        tr.recordStartAt = now + timeToBarStart;
        tr.armTimer = setTimeout(() => beginRecording(tr, tr.recordStartAt), timeToBarStart);
      }
    } else if (tr.state === 'armed') {
      clearTimeout(tr.armTimer);
      tr.armTimer = null;
      tr.state = 'empty';
    } else if (tr.state === 'recording') {
      const timeToBarEnd = metronome.getTimeToNextBar();
      if (timeToBarEnd == null) closeRecording(tr, now);
      else {
        tr.state = 'finishing';
        tr.recordStopAt = now + timeToBarEnd;
        tr.finishTimer = setTimeout(() => closeRecording(tr, tr.recordStopAt), timeToBarEnd);
      }
    } else if (tr.state === 'playing' || tr.state === 'overdubbing') {
      tr.state = 'paused'; tr.pausedAt = now;
    } else if (tr.state === 'paused') {
      tr.loopStartAt += (now - tr.pausedAt);
      tr.state = 'playing';
    }
    renderTrackUI(tr);
  }
  function beginRecording(tr, startedAt){
    if (tr.state !== 'armed' && tr.state !== 'empty') return;
    clearTimeout(tr.armTimer);
    tr.armTimer = null;
    tr.state = 'recording'; tr.recordStartAt = startedAt; tr.events = [];
    renderTrackUI(tr);
  }
  function closeRecording(tr, stoppedAt){
    if (tr.state !== 'recording' && tr.state !== 'finishing') return;
    clearTimeout(tr.finishTimer);
    tr.finishTimer = null;
    tr.loopLenMs = Math.max(200, stoppedAt - tr.recordStartAt);
    tr.loopBars = Math.max(1, Math.round(tr.loopLenMs / ((60000 / metronome.getBpm()) * 4)));
    tr.events = tr.events.filter(ev => ev.onAt < tr.loopLenMs);
    tr.events.forEach(ev => {
      if (ev.dur == null) ev.dur = Math.max(10, tr.loopLenMs - ev.onAt);
    });
    tr.loopStartAt = tr.recordStartAt; tr.lastElapsed = 0;
    tr.state = 'playing';
    renderTrackUI(tr);
  }
  function onOverdub(tr){
    if (tr.state === 'playing') {
      tr.overdubStartIndex = tr.events.length;
      tr.state = 'overdubbing';
    } else if (tr.state === 'overdubbing') {
      const count = tr.events.length - tr.overdubStartIndex;
      tr.undoOverdub = count > 0 ? { start:tr.overdubStartIndex, count } : null;
      tr.overdubStartIndex = null;
      tr.state = 'playing';
    }
    renderTrackUI(tr);
  }
  function undoLastOverdub(tr){
    if (!tr.undoOverdub || tr.state === 'overdubbing') return;
    tr.events.splice(tr.undoOverdub.start, tr.undoOverdub.count);
    tr.undoOverdub = null;
  }
  function onClear(tr){
    clearTimeout(tr.armTimer);
    clearTimeout(tr.finishTimer);
    tr.armTimer = null;
    tr.finishTimer = null;
    tr.overdubStartIndex = null;
    tr.undoOverdub = null;
    tr.state = 'empty'; tr.loopLenMs = null; tr.loopBars = null; tr.events = []; tr.lastElapsed = 0;
    renderTrackUI(tr);
  }

  const STATE_LABEL = { empty:'Empty', armed:'Starts on next 1…', recording:'Recording…', finishing:'Finishing bar…', playing:'Playing', overdubbing:'Overdubbing', paused:'Paused' };
  function updateBarReadout(tr, now = performance.now()){
    let bars = tr.loopBars;
    if (tr.state === 'recording' || tr.state === 'finishing') {
      const elapsed = Math.max(0, Math.min(now, tr.recordStopAt || now) - tr.recordStartAt);
      bars = Math.max(1, Math.ceil(elapsed / ((60000 / metronome.getBpm()) * 4)));
    }
    els[tr.id].barsEl.textContent = bars ? `${bars} ${bars === 1 ? 'bar' : 'bars'}` : '';
  }
  function renderTrackUI(tr){
    const e = els[tr.id];
    updateBarReadout(tr);
    e.stateEl.textContent = STATE_LABEL[tr.state];
    e.stateEl.classList.toggle('is-recording', tr.state === 'armed' || tr.state === 'recording' || tr.state === 'finishing');
    e.stateEl.classList.toggle('is-overdubbing', tr.state === 'overdubbing');
    e.playBtn.classList.toggle('recording', tr.state === 'armed' || tr.state === 'recording' || tr.state === 'finishing');
    e.playBtn.setAttribute('aria-pressed', String(tr.state === 'armed' || tr.state === 'recording' || tr.state === 'finishing'));
    e.playBtn.disabled = tr.state === 'finishing';
    const isPlaying = tr.state === 'playing' || tr.state === 'overdubbing';
    const isPending = tr.state === 'armed' || tr.state === 'recording' || tr.state === 'finishing';
    e.playBtn.innerHTML = iconSvg(isPlaying ? 'pause' : (isPending ? 'square' : 'play'), !isPending && !isPlaying ? 'play' : '');
    e.playBtn.dataset.label = tr.state === 'armed' ? 'cancel' : tr.state === 'recording' ? 'finish' : tr.state === 'finishing' ? 'closing' : tr.state === 'paused' ? 'resume' : isPlaying ? 'pause' : 'record';
    e.playBtn.setAttribute('aria-label', tr.state === 'armed' ? 'Cancel armed recording' : tr.state === 'recording' ? 'Finish recording at the next bar' : tr.state === 'finishing' ? 'Recording finishes at the next bar' : isPlaying ? 'Pause track' : 'Start recording');
    e.overdubBtn.disabled = !(tr.state === 'playing' || tr.state === 'overdubbing');
    e.overdubBtn.classList.add('overdub');
    e.overdubBtn.setAttribute('aria-pressed', String(tr.state === 'overdubbing'));
    if (tr.state === 'empty') e.progressFill.style.width = '0%';
  }
  TRACKS.forEach(renderTrackUI);
  selectTrack(1);

  window.addEventListener('keydown', e => {
    if (onDevice || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    if (/^[1-4]$/.test(e.key)) { e.preventDefault(); selectTrack(Number(e.key)); return; }
    const tr = selectedTrack();
    if (e.key.toLowerCase() === 'r' && ['empty', 'armed', 'recording'].includes(tr.state)) {
      e.preventDefault(); onPlayPause(tr); return;
    }
    if (e.key.toLowerCase() === 'm') { e.preventDefault(); toggleMute(tr); return; }
    if (e.key.toLowerCase() === 'o') { e.preventDefault(); onOverdub(tr); return; }
    if (e.key.toLowerCase() === 'z') { e.preventDefault(); undoLastOverdub(tr); return; }
    if (e.key.toLowerCase() === 'c' || e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); onClear(tr); return; }
    if (e.code === 'Space' && ['playing', 'overdubbing', 'paused'].includes(tr.state)) {
      e.preventDefault(); onPlayPause(tr);
    }
  });

  /* ---- recording: notes played while a track is armed (recording or overdubbing) get
     appended to that track's own event list, timestamped relative to its own loop ---- */
  function elapsedFor(tr, now){
    return tr.state === 'recording' || tr.state === 'finishing' ? (now - tr.recordStartAt) : ((now - tr.loopStartAt) % tr.loopLenMs);
  }
  function looperNoteOn(midi, vel){
    const now = performance.now();
    TRACKS.forEach(tr => {
      if (tr.state === 'armed' && now >= tr.recordStartAt) beginRecording(tr, tr.recordStartAt);
      if (tr.state === 'finishing' && now >= tr.recordStopAt) closeRecording(tr, tr.recordStopAt);
      updateBarReadout(tr, now);
      if (tr.state !== 'recording' && tr.state !== 'finishing' && tr.state !== 'overdubbing') return;
      tr.events.push({ midi, vel, onAt: elapsedFor(tr, now), dur: null });
    });
  }
  function looperNoteOff(midi){
    const now = performance.now();
    TRACKS.forEach(tr => {
      if (tr.state === 'armed' && now >= tr.recordStartAt) beginRecording(tr, tr.recordStartAt);
      if (tr.state === 'finishing' && now >= tr.recordStopAt) closeRecording(tr, tr.recordStopAt);
      if (tr.state !== 'recording' && tr.state !== 'finishing' && tr.state !== 'overdubbing') return;
      const ev = [...tr.events].reverse().find(e => e.midi === midi && e.dur === null);
      if (!ev) return;
      let dur = elapsedFor(tr, now) - ev.onAt;
      if (tr.state === 'overdubbing' && dur < 0) dur += tr.loopLenMs; // held across the loop's wrap point
      ev.dur = Math.max(10, dur);
    });
  }

  /* ---- playback: one rAF loop drives every track's own independent position ---- */
  let deviceManager; // assigned once createDeviceManager runs, below
  function loopFrame(){
    requestAnimationFrame(loopFrame);
    const now = performance.now();
    TRACKS.forEach(tr => {
      if (tr.state === 'armed' && now >= tr.recordStartAt) beginRecording(tr, tr.recordStartAt);
      if (tr.state === 'finishing' && now >= tr.recordStopAt) closeRecording(tr, tr.recordStopAt);
      if (tr.loopLenMs == null) return;
      if (tr.state !== 'playing' && tr.state !== 'overdubbing') return;
      const elapsed = (now - tr.loopStartAt) % tr.loopLenMs;
      const prev = tr.lastElapsed;
      const crossed = ev => prev <= elapsed ? (ev.onAt > prev && ev.onAt <= elapsed) : (ev.onAt > prev || ev.onAt <= elapsed);
      if (!tr.muted) {
        tr.events.forEach(ev => {
          if (ev.dur == null) return; // still being held down this instant
          if (crossed(ev)) {
            deviceManager.sendNoteOn(tr.ch, ev.midi, ev.vel);
            setTimeout(() => deviceManager.sendNoteOff(tr.ch, ev.midi), ev.dur);
          }
        });
      }
      tr.lastElapsed = elapsed;
      els[tr.id].progressFill.style.width = ((elapsed / tr.loopLenMs) * 100) + '%';
    });
  }
  requestAnimationFrame(loopFrame);

  /* ================= DEVICE ================= */
  deviceManager = createDeviceManager({
    els: {
      quickConnectBtn: document.getElementById('quickConnectBtn'),
      statusText: document.getElementById('connectStatus'),
      rescanBtn: document.getElementById('rescanBtn'),
      inputList: document.getElementById('inputList'),
      outputList: document.getElementById('outputList'),
    },
    onRealNoteOn: looperNoteOn,
    onRealNoteOff: looperNoteOff,
  });
})();
