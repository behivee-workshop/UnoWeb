(function(){
  "use strict";
  const { iconSvg, RANGE, buildKeyColumn, centerOn, createDeviceManager, createMetronome } = window.KB;

  const metronome = createMetronome({
    playBtn: document.getElementById('metroPlay'), bpmDown: document.getElementById('bpmDown'),
    bpmUp: document.getElementById('bpmUp'), bpmReadout: document.getElementById('bpmReadout'),
    beatDot: document.getElementById('beatDot'),
  });

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

  const sheetHelpBtn = document.getElementById('sheetHelpBtn');
  const sheetHelp = document.getElementById('sheetHelp');
  function setSheetHelp(open){
    sheetHelp.hidden = !open;
    sheetHelpBtn.setAttribute('aria-expanded', String(open));
  }
  sheetHelpBtn.addEventListener('click', () => setSheetHelp(sheetHelp.hidden));
  window.addEventListener('keydown', e => { if (e.key === 'Escape' && !sheetHelp.hidden) setSheetHelp(false); });

  /* ================= SHEET: a bar is 16 steps (always 1/16 resolution); each track keeps
     its own 1-4 bar length and loops independently (polymetric) — see ARCHITECTURE.md ================= */
  const BAR_STEPS = 16;
  const MAX_BARS = 4;
  const STORAGE_LEN = MAX_BARS * BAR_STEPS;
  let quantizeDenom = 16; // record snaps to the nearest 1/quantizeDenom note

  function emptySteps(){
    return Array.from({length:STORAGE_LEN}, () => ({ notes: [] }));
  }
  // a step holds a chord (zero or more simultaneous notes), not a single note
  const TRACKS = [
    { id:1, ch:1, color:'var(--t1)', steps:emptySteps(), muted:false, bars:1, page:0 },
    { id:2, ch:2, color:'var(--t2)', steps:emptySteps(), muted:false, bars:1, page:0 },
    { id:3, ch:3, color:'var(--t3)', steps:emptySteps(), muted:false, bars:1, page:0 },
    { id:4, ch:4, color:'var(--t4)', steps:emptySteps(), muted:false, bars:1, page:0 },
  ];

  let recordTarget = 1;
  function currentTrack(){ return TRACKS.find(t => t.id === recordTarget); }
  function colToIndex(tr, col){ return tr.page * BAR_STEPS + col; }
  function barBounds(i){ const bar = Math.floor(i / BAR_STEPS); return { start: bar * BAR_STEPS, end: bar * BAR_STEPS + BAR_STEPS }; }

  const seqStepElsByMidi = new Map();
  const selectedNotes = new Set(); // `${stepIndex}:${midi}` for heads in the current track
  const noteKey = (index, midi) => index + ':' + midi;
  const sequencePlayhead = document.createElement('div');
  sequencePlayhead.className = 'sequence-playhead';
  (function buildStepColumns(){
    const container = document.getElementById('seqStepCols');
    RANGE.forEach(midi => {
      const row = document.createElement('div'); row.className = 'roll-steps' + (midi === 60 ? ' middle-c-row' : '');
      const arr = [];
      for (let col = 0; col < BAR_STEPS; col++) {
        const s = document.createElement('div'); s.className = 'step' + (col % 4 === 0 ? ' group' : col % 2 === 0 ? ' eighth' : ''); s.dataset.midi = midi; s.dataset.col = col;
        const handle = document.createElement('div'); handle.className = 'note-handle';
        s.appendChild(handle);
        s.addEventListener('pointerdown', e => { if (e.target !== handle) startCellPress(e, midi, col); });
        handle.addEventListener('pointerdown', e => startResize(e, midi, col));
        row.appendChild(s); arr.push(s);
      }
      container.appendChild(row);
      seqStepElsByMidi.set(midi, arr);
    });
    document.getElementById('seqRoll').appendChild(sequencePlayhead);
  })();

  // Click empty space to add a note. Click a note to select it, Shift-drag to select a group,
  // and drag a selected note to move the selection through the current bar.
  function startCellPress(e, midi, col){
    e.preventDefault();
    const tr = currentTrack();
    const i = colToIndex(tr, col);
    if (e.shiftKey) { startMarqueeSelection(e, midi, col); return; }
    const headIdx = findNoteHead(tr, midi, i);
    if (headIdx !== -1) {
      if (e.altKey) {
        const notes = tr.steps[headIdx].notes;
        notes.splice(notes.findIndex(n => n.midi === midi), 1);
        selectedNotes.delete(noteKey(headIdx, midi));
        renderTrackGrid();
      } else startNoteMove(e, midi, headIdx);
      return;
    }
    tr.steps[i].notes.push({ midi, vel:100, len:1 });
    selectedNotes.clear(); selectedNotes.add(noteKey(i, midi));
    renderTrackGrid();
  }

  function startMarqueeSelection(e, midi, col){
    const startMidi = midi, startCol = col;
    function onUp(ev){
      window.removeEventListener('pointerup', onUp);
      const target = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.step');
      const endMidi = target ? Number(target.dataset.midi) : startMidi;
      const endCol = target ? Number(target.dataset.col) : startCol;
      const minMidi = Math.min(startMidi, endMidi), maxMidi = Math.max(startMidi, endMidi);
      const minCol = Math.min(startCol, endCol), maxCol = Math.max(startCol, endCol);
      const tr = currentTrack();
      selectedNotes.clear();
      for (let local = minCol; local <= maxCol; local++) {
        const index = colToIndex(tr, local);
        tr.steps[index].notes.forEach(note => {
          if (note.midi >= minMidi && note.midi <= maxMidi) selectedNotes.add(noteKey(index, note.midi));
        });
      }
      renderTrackGrid();
    }
    window.addEventListener('pointerup', onUp);
  }

  function startNoteMove(e, midi, headIdx){
    const tr = currentTrack();
    const key = noteKey(headIdx, midi);
    if (!selectedNotes.has(key)) { selectedNotes.clear(); selectedNotes.add(key); renderTrackGrid(); }
    const cell = seqStepElsByMidi.get(midi)[headIdx - tr.page * BAR_STEPS];
    const stepW = cell.getBoundingClientRect().width;
    const startX = e.clientX, startY = e.clientY;
    let moved = false, stepsX = 0, midiDelta = 0;
    function onMove(ev){
      stepsX = Math.round((ev.clientX - startX) / stepW);
      midiDelta = -Math.round((ev.clientY - startY) / 28);
      moved ||= Math.abs(stepsX) > 0 || Math.abs(midiDelta) > 0;
    }
    function onUp(){
      window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp);
      if (moved) moveSelectedNotes(tr, stepsX, midiDelta);
      else renderTrackGrid();
    }
    window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp);
  }

  function moveSelectedNotes(tr, stepsX, midiDelta){
    const items = [...selectedNotes].map(key => {
      const [index, midi] = key.split(':').map(Number);
      const note = tr.steps[index]?.notes.find(n => n.midi === midi);
      return note && { index, midi, note };
    }).filter(Boolean);
    if (!items.length) return;
    const { start, end } = barBounds(items[0].index);
    const minIndex = Math.min(...items.map(item => item.index));
    const maxEnd = Math.max(...items.map(item => item.index + Math.min(item.note.len || 1, end - item.index)));
    const minMidi = Math.min(...items.map(item => item.midi));
    const maxMidi = Math.max(...items.map(item => item.midi));
    const safeX = Math.max(start - minIndex, Math.min(stepsX, end - maxEnd));
    const safeY = Math.max(21 - minMidi, Math.min(midiDelta, 108 - maxMidi));
    if (!safeX && !safeY) return;
    const itemNotes = new Set(items.map(item => item.note));
    const destinations = items.map(item => ({ index:item.index + safeX, midi:item.midi + safeY, note:item.note }));
    const destinationKeys = new Set(destinations.map(item => noteKey(item.index, item.midi)));
    if (destinationKeys.size !== destinations.length) return;
    for (const destination of destinations) {
      if (tr.steps[destination.index].notes.some(note => !itemNotes.has(note) && note.midi === destination.midi)) return;
    }
    items.forEach(item => { const notes = tr.steps[item.index].notes; notes.splice(notes.indexOf(item.note), 1); });
    selectedNotes.clear();
    destinations.forEach(destination => {
      const movedNote = { ...destination.note, midi:destination.midi };
      tr.steps[destination.index].notes.push(movedNote);
      selectedNotes.add(noteKey(destination.index, destination.midi));
    });
    renderTrackGrid();
  }

  // stretch is per note, not per step — a chord's voices can each hold their own length.
  // both manual stretch and recorded length are clamped to the note's own bar: a note can't
  // span a page boundary, since the grid only ever shows one bar/page at a time
  function findNoteHead(tr, midi, i){
    if (tr.steps[i].notes.some(n => n.midi === midi)) return i;
    const { start } = barBounds(i);
    for (let k = i - 1; k >= start; k--) {
      const n = tr.steps[k].notes.find(n => n.midi === midi);
      if (n) { const len = Math.min(n.len || 1, barBounds(k).end - k); return (k + len > i) ? k : -1; }
    }
    return -1;
  }
  function nextNoteHeadAfter(tr, midi, headIdx){
    const { end } = barBounds(headIdx);
    for (let k = headIdx + 1; k < end; k++) { if (tr.steps[k].notes.some(n => n.midi === midi)) return k; }
    return end;
  }
  function toggleCell(midi, col){
    const tr = currentTrack();
    const i = colToIndex(tr, col);
    const s = tr.steps[i];
    const own = s.notes.find(n => n.midi === midi);
    if (own) { s.notes.splice(s.notes.indexOf(own), 1); renderTrackGrid(); return; }
    const headIdx = findNoteHead(tr, midi, i);
    if (headIdx !== -1) {
      // clicked inside this note's own stretched tail — trim just this note
      tr.steps[headIdx].notes.find(n => n.midi === midi).len = Math.max(1, i - headIdx);
    } else {
      s.notes.push({ midi, vel:100, len:1 });
    }
    renderTrackGrid();
  }
  function renderTrackGrid(){
    const tr = currentTrack();
    RANGE.forEach(midi => seqStepElsByMidi.get(midi).forEach(el => {
      el.classList.remove('active', 'note-head', 'note-body', 'note-tail', 'selected');
      el.style.removeProperty('--track-color'); el.style.removeProperty('--vel-pct');
      el.removeAttribute('title');
    }));
    const pageStart = tr.page * BAR_STEPS, pageEnd = pageStart + BAR_STEPS;
    for (let i = pageStart; i < pageEnd; i++) {
      tr.steps[i].notes.forEach(note => {
        const rowEls = seqStepElsByMidi.get(note.midi);
        if (!rowEls) return;
        const len = Math.min(note.len || 1, pageEnd - i);
        const pct = Math.round(30 + (note.vel / 127) * 55);
        const selected = selectedNotes.has(noteKey(i, note.midi));
        for (let k = 0; k < len; k++) {
          const col = (i + k) - pageStart;
          const el = rowEls[col];
          el.classList.add('active');
          if (selected) el.classList.add('selected');
          el.style.setProperty('--track-color', tr.color);
          el.style.setProperty('--vel-pct', pct + '%');
          if (k === 0) { el.classList.add('note-head'); el.title = 'vel ' + note.vel; }
          if (k === len - 1) el.classList.add('note-tail');
          if (k > 0 && k < len - 1) el.classList.add('note-body');
        }
      });
    }
    updateBarUI();
  }
  function startResize(e, midi, col){
    e.stopPropagation(); e.preventDefault();
    const tr = currentTrack();
    const i = colToIndex(tr, col);
    const headIdx = findNoteHead(tr, midi, i);
    if (headIdx === -1) return;
    const note = tr.steps[headIdx].notes.find(n => n.midi === midi);
    if (!note) return;
    const stepW = seqStepElsByMidi.get(midi)[col].getBoundingClientRect().width;
    const startX = e.clientX, startLen = note.len || 1;
    const maxLen = nextNoteHeadAfter(tr, midi, headIdx) - headIdx;
    function onMove(ev){
      const deltaSteps = Math.round((ev.clientX - startX) / stepW);
      const newLen = Math.max(1, Math.min(startLen + deltaSteps, maxLen));
      if (newLen !== note.len) { note.len = newLen; renderTrackGrid(); }
    }
    function onUp(){ window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  /* ---- bars (1-4, per track) + which bar/page is currently shown for that track ---- */
  const barsCtl = document.getElementById('barsCtl');
  const pagePrevBtn = document.getElementById('pagePrev');
  const pageNextBtn = document.getElementById('pageNext');
  const pageReadout = document.getElementById('pageReadout');
  pagePrevBtn.innerHTML = iconSvg('chevronLeft');
  pageNextBtn.innerHTML = iconSvg('chevronRight');
  barsCtl.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      const tr = currentTrack();
      tr.bars = Number(btn.dataset.bars);
      tr.page = Math.min(tr.page, tr.bars - 1);
      renderTrackGrid();
    });
  });
  pagePrevBtn.addEventListener('click', () => { const tr = currentTrack(); if (tr.page > 0) { tr.page--; renderTrackGrid(); } });
  pageNextBtn.addEventListener('click', () => { const tr = currentTrack(); if (tr.page < tr.bars - 1) { tr.page++; renderTrackGrid(); } });
  function updateBarUI(){
    const tr = currentTrack();
    barsCtl.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(Number(b.dataset.bars) === tr.bars)));
    pageReadout.textContent = `bar ${tr.page + 1}/${tr.bars}`;
    pagePrevBtn.disabled = tr.page <= 0;
    pageNextBtn.disabled = tr.page >= tr.bars - 1;
  }

  const qtzCtl = document.getElementById('qtzCtl');
  qtzCtl.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      quantizeDenom = Number(btn.dataset.qtz);
      qtzCtl.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b === btn)));
    });
  });
  function quantizeStep(step, trackLen){
    const unit = 16 / quantizeDenom;
    if (unit < 1) return step;
    return Math.min(trackLen - 1, Math.round(step / unit) * unit);
  }

  document.getElementById('clearTrackBtn').addEventListener('click', () => {
    clearCurrentTrack();
  });
  function clearCurrentTrack(){
    const tr = currentTrack();
    tr.steps.forEach(s => { s.notes = []; });
    selectedNotes.clear();
    renderTrackGrid();
  }

  const tabTabsEl = document.getElementById('trackTabs');
  const trackTabEls = {};
  TRACKS.forEach(tr => {
    const tab = document.createElement('button'); tab.className = 'track-tab'; tab.setAttribute('role', 'tab');
    tab.style.setProperty('--track-color', tr.color);
    tab.innerHTML = `<span class="swatch"></span><b>Track ${tr.id}</b><small>CH${tr.ch}</small>`;
    tab.addEventListener('click', () => selectTrack(tr.id));

    const muteBtn = document.createElement('button'); muteBtn.className = 'mute-btn';
    muteBtn.innerHTML = iconSvg('volumeX'); muteBtn.setAttribute('aria-label', 'Mute track');
    muteBtn.setAttribute('aria-pressed', 'false');
    muteBtn.addEventListener('click', e => {
      e.stopPropagation(); toggleTrackMute(tr);
    });
    tab.appendChild(muteBtn);
    tabTabsEl.appendChild(tab); trackTabEls[tr.id] = tab;
  });
  function selectTrack(id){
    recordTarget = id;
    selectedNotes.clear();
    Object.entries(trackTabEls).forEach(([tid, el]) => el.setAttribute('aria-selected', String(Number(tid) === id)));
    renderTrackGrid();
  }
  function toggleTrackMute(tr){
    tr.muted = !tr.muted;
    const tab = trackTabEls[tr.id];
    tab.querySelector('.mute-btn').setAttribute('aria-pressed', String(tr.muted));
    tab.classList.toggle('muted', tr.muted);
  }
  selectTrack(1);

  const seqRollScroll = document.getElementById('seqRoll');
  const seqPianoCtl = buildKeyColumn(document.getElementById('seqPianoKeys'), {
    keyboardMap: true, onNoteOn: seqNoteOn, onNoteOff: seqNoteOff
  });
  centerOn(seqRollScroll, 60);

  /* ---------------- transport: one free-running master step; each track reads its own
     position from it as masterStep % (track.bars*16) — tracks are not required to loop
     at the same length, and only Stop re-syncs them (see ARCHITECTURE.md) ---------------- */
  let playing = false, masterStep = 0, stepTimer = null, recordArmed = false;

  let displayedPlayheadColumn = -1;
  function setPlayheadColumn(col, durationMs = 0){
    displayedPlayheadColumn = col;
    sequencePlayhead.classList.toggle('visible', col >= 0);
    if (col < 0) return;
    const step = seqStepElsByMidi.get(RANGE[0])?.[col];
    if (!step) return;
    const rollRect = seqRollScroll.getBoundingClientRect();
    const stepRect = step.getBoundingClientRect();
    sequencePlayhead.style.setProperty('--playhead-duration', durationMs + 'ms');
    sequencePlayhead.style.left = (stepRect.left + stepRect.width / 2) + 'px';
    sequencePlayhead.style.top = rollRect.top + 'px';
    sequencePlayhead.style.height = rollRect.height + 'px';
  }
  function updateSelectedPlayhead(durationMs){
    const tr = currentTrack();
    const trackLen = tr.bars * 16;
    const trackStep = masterStep % trackLen;
    const local = trackStep - tr.page * 16;
    setPlayheadColumn(local >= 0 && local < 16 ? local : -1, durationMs);
  }

  let deviceManager; // assigned once createDeviceManager runs, below
  function stepTick(){
    const bpm = metronome.getBpm();
    const stepMs = (60000 / bpm) / 4;
    TRACKS.forEach(tr => {
      const trackLen = tr.bars * 16;
      const trackStep = masterStep % trackLen;
      const s = tr.steps[trackStep];
      if (s.notes.length && !tr.muted) s.notes.forEach(n => {
        deviceManager.sendNoteOn(tr.ch, n.midi, n.vel);
        setTimeout(() => deviceManager.sendNoteOff(tr.ch, n.midi), (n.len || 1) * stepMs);
      });
    });
    updateSelectedPlayhead(stepMs);
    masterStep++;
  }
  function restartScheduler(){
    clearInterval(stepTimer);
    stepTimer = setInterval(stepTick, (60000 / metronome.getBpm()) / 4);
  }
  function play(){
    if (playing) return;
    playing = true;
    document.getElementById('playBtn').innerHTML = iconSvg('pause');
    restartScheduler();
  }
  function pause(){
    playing = false; clearInterval(stepTimer);
    document.getElementById('playBtn').innerHTML = iconSvg('play', 'play');
  }
  function stop(){
    pause(); masterStep = 0; setPlayheadColumn(-1);
  }
  window.addEventListener('resize', () => {
    if (displayedPlayheadColumn >= 0) setPlayheadColumn(displayedPlayheadColumn);
  });
  window.addEventListener('scroll', () => {
    if (displayedPlayheadColumn >= 0) setPlayheadColumn(displayedPlayheadColumn);
  }, { passive:true });
  seqRollScroll.addEventListener('scroll', () => {
    if (displayedPlayheadColumn >= 0) setPlayheadColumn(displayedPlayheadColumn);
  }, { passive:true });
  document.getElementById('playBtn').innerHTML = iconSvg('play', 'play');
  document.getElementById('stopBtn').innerHTML = iconSvg('square');
  document.getElementById('recBtn').innerHTML = iconSvg('circle');
  document.getElementById('playBtn').addEventListener('click', () => playing ? pause() : play());
  document.getElementById('stopBtn').addEventListener('click', stop);

  const recBtn = document.getElementById('recBtn');
  recBtn.addEventListener('click', () => {
    recordArmed = !recordArmed;
    recBtn.setAttribute('aria-pressed', String(recordArmed));
  });
  window.addEventListener('keydown', e => {
    if (onDevice || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    if (e.key.toLowerCase() === 'r') { e.preventDefault(); recBtn.click(); }
    if (e.code === 'Space') { e.preventDefault(); playing ? pause() : play(); }
    if (e.key.toLowerCase() === 'm') { e.preventDefault(); toggleTrackMute(currentTrack()); }
    if (e.key.toLowerCase() === 'c' || e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); clearCurrentTrack(); }
  });

  /* ---- recording captures hold duration as note length: note-on writes a len:1 placeholder
     and stashes when/where it started; note-off measures elapsed time and sets the real
     length, snapped to the step grid and clamped to the current bar ---- */
  const liveRecordings = new Map(); // midi -> { trackId, stepIndex, startedAt }

  function seqNoteOn(midi, vel){
    if (!recordArmed) return;
    if (!playing) play();
    const tr = currentTrack();
    const trackLen = tr.bars * 16;
    const idx = quantizeStep(masterStep % trackLen, trackLen);
    const s = tr.steps[idx];
    // notes played together (same quantized step) stack into one chord, not overwrite each other
    if (!s.notes.some(n => n.midi === midi)) s.notes.push({ midi, vel: vel ?? 100, len:1 });
    liveRecordings.set(midi, { trackId: tr.id, stepIndex: idx, startedAt: performance.now() });
    renderTrackGrid();
    const col = idx - tr.page * 16;
    if (col >= 0 && col < 16) {
      const el = seqStepElsByMidi.get(midi)[col];
      el.classList.add('just-recorded');
      setTimeout(() => el.classList.remove('just-recorded'), 350);
    }
  }
  function seqNoteOff(midi){
    const rec = liveRecordings.get(midi);
    if (!rec) return;
    liveRecordings.delete(midi);
    const tr = TRACKS.find(t => t.id === rec.trackId);
    const note = tr.steps[rec.stepIndex]?.notes.find(n => n.midi === midi);
    if (!note) return;
    const stepMs = (60000 / metronome.getBpm()) / 4;
    const heldMs = performance.now() - rec.startedAt;
    const stepsHeld = Math.max(1, Math.round(heldMs / stepMs));
    const maxLen = barBounds(rec.stepIndex).end - rec.stepIndex;
    note.len = Math.min(stepsHeld, maxLen);
    renderTrackGrid();
  }

  /* ================= DEVICE ================= */
  deviceManager = createDeviceManager({
    els: {
      quickConnectBtn: document.getElementById('quickConnectBtn'),
      statusText: document.getElementById('connectStatus'),
      rescanBtn: document.getElementById('rescanBtn'),
      inputList: document.getElementById('inputList'),
      outputList: document.getElementById('outputList'),
    },
    onRealNoteOn: (midi, vel) => seqPianoCtl.press(midi, vel),
    onRealNoteOff: midi => seqPianoCtl.release(midi),
  });
})();
