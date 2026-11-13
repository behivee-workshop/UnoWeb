// Shared across every page in app/ — no build step, so this just attaches a
// namespace object to window rather than using ES modules.
window.KB = (function(){
  "use strict";

  // lucide.dev icons, inlined as static SVG paths (MIT) — no CDN, no icon library
  const ICON_PATHS = {
    play: '<path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z"/>',
    pause: '<rect x="14" y="3" width="5" height="18" rx="1"/><rect x="5" y="3" width="5" height="18" rx="1"/>',
    square: '<rect width="18" height="18" x="3" y="3" rx="2"/>',
    circle: '<circle cx="12" cy="12" r="10"/>',
    metronome: '<path d="m14.5 8.5-5 5"/><path d="M20 22H4"/><path d="m6.4 12.7 3.1-9.8h5l3.1 9.8a6 6 0 0 1-11.2 0Z"/><path d="M12 2v5"/>',
    minus: '<path d="M5 12h14"/>',
    plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
    volumeX: '<path d="M11 4.702a.7.7 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.7.7 0 0 0 11 19.298z"/><path d="m16.5 14.5 5-5"/><path d="m16.5 9.5 5 5"/>',
    plug: '<path d="M12 22v-5"/><path d="M15 8V2"/><path d="M17 8a1 1 0 0 1 1 1v4a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1z"/><path d="M9 8V2"/>',
    settings: '<path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"/><circle cx="12" cy="12" r="3"/>',
    chevronLeft: '<path d="m15 18-6-6 6-6"/>',
    chevronRight: '<path d="m9 18 6-6-6-6"/>',
    repeat: '<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>',
    trash: '<path d="M10 11v6"/><path d="M14 11v6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  };
  function iconSvg(name, cls){
    return `<svg class="icon${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name]}</svg>`;
  }

  const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  const midiName = m => NOTE_NAMES[m % 12] + (Math.floor(m/12) - 1);
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const WHITE_PC = new Set([0,2,4,5,7,9,11]);
  const ROW_H = 28;
  const LOW = 21, HIGH = 108; // A0–C8, the full 88-key range
  const RANGE = []; for (let m = HIGH; m >= LOW; m--) RANGE.push(m); // index 0 = highest pitch (top row)

  /* ---------------- vertical piano: a key column, shared by every app ---------------- */
  function buildKeyColumn(container, {keyboardMap, onNoteOn, onNoteOff}){
    container.innerHTML = '';
    const keyEls = new Map();
    RANGE.forEach(midi => {
      const key = document.createElement('div');
      key.className = 'roll-key ' + (WHITE_PC.has(midi % 12) ? 'white' : 'black') + (midi === 60 ? ' middle-c' : '');
      key.dataset.midi = midi;
      key.textContent = (midi % 12 === 0) ? midiName(midi) : '';
      container.appendChild(key);
      keyEls.set(midi, key);
    });

    const down = new Set();
    function press(midi, vel){ if (down.has(midi)) return; down.add(midi); keyEls.get(midi)?.classList.add('on'); onNoteOn && onNoteOn(midi, vel ?? 100); }
    function release(midi){ if (!down.has(midi)) return; down.delete(midi); keyEls.get(midi)?.classList.remove('on'); onNoteOff && onNoteOff(midi); }

    keyEls.forEach((el, midi) => {
      el.addEventListener('pointerdown', e => { e.preventDefault(); press(midi, 100); });
      el.addEventListener('pointerup', () => release(midi));
      el.addEventListener('pointerleave', () => release(midi));
      el.addEventListener('pointercancel', () => release(midi));
    });

    if (keyboardMap) {
      const MAP = {a:60,w:61,s:62,e:63,d:64,f:65,t:66,g:67,y:68,h:69,u:70,j:71,k:72,o:73,l:74,p:75};
      let octaveShift = 0;
      const heldKeys = new Set();
      window.addEventListener('keydown', ev => {
        if (ev.defaultPrevented) return;
        if (document.activeElement && /INPUT|TEXTAREA/.test(document.activeElement.tagName)) return;
        const key = ev.key.toLowerCase();
        if (key === 'z') { octaveShift = Math.max(-48, octaveShift - 12); return; }
        if (key === 'x') { octaveShift = Math.min(48, octaveShift + 12); return; }
        if (!(key in MAP) || heldKeys.has(key)) return;
        heldKeys.add(key); press(MAP[key] + octaveShift);
      });
      window.addEventListener('keyup', ev => {
        const key = ev.key.toLowerCase();
        if (!(key in MAP)) return;
        heldKeys.delete(key); release(MAP[key] + octaveShift);
      });
    }
    return { press, release, keyEls };
  }

  function centerOn(scrollEl, midi){
    const idx = RANGE.indexOf(midi);
    scrollEl.scrollTop = Math.max(0, idx * ROW_H - scrollEl.clientHeight / 2 + ROW_H / 2);
  }

  /* ---------------- MIDI device manager: connect, device lists, routing, sending ----------------
     One instance per page. `els.quickConnectBtn` is the navbar one-click control; the fuller
     input/output lists (and rescan) live in that page's own Device/settings panel. Device names
     from requestMIDIAccess() are untrusted hardware/driver strings, so rows are built with
     createElement/textContent, never innerHTML. */
  function createDeviceManager({ els, onRealNoteOn, onRealNoteOff }){
    const BUILTIN_INPUT = { id:'virtual', name:'Virtual Keyboard', kind:'Browser' };
    const BUILTIN_OUTPUT = { id:'monitor', name:'None (local only)', kind:'Internal' };

    let midiAccess = null;
    const realInputs = new Map();  // id -> MIDIInput
    const realOutputs = new Map(); // id -> MIDIOutput
    let selectedInputId = 'virtual';
    let selectedOutputId = 'monitor';
    let activeInputPort = null;
    let activeOutputPort = null;

    function buildDeviceList(container, devices, selectedId, onSelect){
      container.innerHTML = '';
      devices.forEach(d => {
        const row = document.createElement('button');
        row.className = 'device-row'; row.type = 'button'; row.setAttribute('role', 'radio');
        row.setAttribute('aria-checked', String(d.id === selectedId));

        const dot = document.createElement('span'); dot.className = 'device-dot';
        const info = document.createElement('span'); info.className = 'device-info';
        const name = document.createElement('b'); name.textContent = d.name;
        const kind = document.createElement('small'); kind.textContent = d.kind + ' · connected';
        info.append(name, kind);
        const check = document.createElement('span'); check.className = 'device-check';
        row.append(dot, info, check);

        row.addEventListener('click', () => onSelect(d.id));
        container.appendChild(row);
      });
    }
    // Live has no output list (it only ever receives); els.outputList is simply absent there
    function renderDeviceLists(){
      const inputs = [BUILTIN_INPUT, ...[...realInputs.values()].map(p => ({ id:p.id, name:p.name || 'MIDI input', kind:'USB' }))];
      buildDeviceList(els.inputList, inputs, selectedInputId, id => { selectedInputId = id; applyInputSelection(); renderDeviceLists(); });
      if (els.outputList) {
        const outputs = [BUILTIN_OUTPUT, ...[...realOutputs.values()].map(p => ({ id:p.id, name:p.name || 'MIDI output', kind:'USB' }))];
        buildDeviceList(els.outputList, outputs, selectedOutputId, id => { selectedOutputId = id; applyOutputSelection(); renderDeviceLists(); });
      }
    }

    function handleMidiMessage(ev){
      const [status, note, vel] = ev.data;
      const cmd = status & 0xf0;
      if (cmd === 0x90 && vel > 0) onRealNoteOn(note, vel);
      else if (cmd === 0x80 || (cmd === 0x90 && vel === 0)) onRealNoteOff(note);
    }
    function applyInputSelection(){
      if (activeInputPort) activeInputPort.onmidimessage = null;
      activeInputPort = realInputs.get(selectedInputId) || null;
      if (activeInputPort) activeInputPort.onmidimessage = handleMidiMessage;
    }
    function applyOutputSelection(){
      activeOutputPort = realOutputs.get(selectedOutputId) || null;
    }

    function refreshDeviceLists(){
      realInputs.clear(); realOutputs.clear();
      if (midiAccess) {
        midiAccess.inputs.forEach(p => realInputs.set(p.id, p));
        midiAccess.outputs.forEach(p => realOutputs.set(p.id, p));
      }
      renderDeviceLists();
      applyInputSelection();
      applyOutputSelection();
    }

    // the icon+label shell is written once, with no interpolated content; every later
    // update below only ever touches the label's textContent, never innerHTML again
    els.quickConnectBtn.innerHTML = iconSvg('plug') + '<span class="qc-label"></span>';
    const quickConnectLabel = els.quickConnectBtn.querySelector('.qc-label');
    function setQuickConnectLabel(text, on){
      quickConnectLabel.textContent = text;
      els.quickConnectBtn.classList.toggle('on', !!on);
    }
    async function connectMIDI(){
      if (!navigator.requestMIDIAccess) {
        els.statusText.textContent = "This browser doesn't support Web MIDI — try Chrome or Edge.";
        return;
      }
      els.quickConnectBtn.disabled = true; setQuickConnectLabel('Connecting…');
      try {
        midiAccess = await navigator.requestMIDIAccess({ sysex:false });
        midiAccess.onstatechange = refreshDeviceLists;
        refreshDeviceLists();
        // auto-enable the first real instrument found, so a connect that finds your gear
        // doesn't also need a manual pick from the device list
        const firstInput = [...realInputs.values()][0];
        const firstOutput = [...realOutputs.values()][0];
        if (firstInput) { selectedInputId = firstInput.id; applyInputSelection(); }
        if (firstOutput) { selectedOutputId = firstOutput.id; applyOutputSelection(); }
        if (firstInput || firstOutput) renderDeviceLists();
        const count = realInputs.size + realOutputs.size;
        els.statusText.textContent = count
          ? `Connected — ${realInputs.size} input(s), ${realOutputs.size} output(s) found and enabled.`
          : 'Connected, but no MIDI devices were found. Plug one in, then rescan.';
        setQuickConnectLabel('Connected', true);
      } catch (err) {
        els.statusText.textContent = 'MIDI access was blocked or denied.';
        els.quickConnectBtn.disabled = false; setQuickConnectLabel('Connect MIDI');
      }
    }
    els.quickConnectBtn.addEventListener('click', () => { if (!midiAccess) connectMIDI(); });

    els.rescanBtn.addEventListener('click', () => {
      els.rescanBtn.disabled = true; els.rescanBtn.textContent = 'Scanning…';
      setTimeout(() => {
        refreshDeviceLists();
        els.rescanBtn.disabled = false; els.rescanBtn.textContent = 'Rescan devices';
      }, 400);
    });

    setQuickConnectLabel('Connect MIDI');
    renderDeviceLists();

    return {
      sendNoteOn(ch, midi, vel){ activeOutputPort?.send([0x90 | ((ch - 1) & 0x0f), midi, vel]); },
      sendNoteOff(ch, midi){ activeOutputPort?.send([0x80 | ((ch - 1) & 0x0f), midi, 0]); },
    };
  }

  /* ---------------- metronome: one shared tempo + click, lives in the navbar of every app ----------------
     BPM is persisted (localStorage) so it's the same number whichever app you open. Other app
     logic (Sheet's sequencer, say) can read the current tempo via `getBpm()` instead of keeping
     its own separate BPM control — one tempo, not a different number in every app. */
  function createMetronome(els){
    const STORE_KEY = 'kb-metronome-bpm';
    let bpm = Math.max(40, Math.min(220, Number(localStorage.getItem(STORE_KEY)) || 100));
    let running = false, timer = null, audioCtx = null, beat = 0, nextBeatAt = 0;
    let tapTimes = [];

    els.bpmReadout.textContent = bpm;
    els.bpmDown.innerHTML = iconSvg('minus');
    els.bpmUp.innerHTML = iconSvg('plus');
    function setBpm(v){
      bpm = Math.max(40, Math.min(220, v));
      els.bpmReadout.textContent = bpm;
      localStorage.setItem(STORE_KEY, String(bpm));
      if (running) restart();
    }
    els.bpmDown.addEventListener('click', () => setBpm(bpm - 1));
    els.bpmUp.addEventListener('click', () => setBpm(bpm + 1));

    function click(strong){
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const t = audioCtx.currentTime;
      const osc = audioCtx.createOscillator(), gain = audioCtx.createGain();
      osc.frequency.value = strong ? 1600 : 1100;
      gain.gain.setValueAtTime(0.18, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
      osc.connect(gain); gain.connect(audioCtx.destination);
      osc.start(t); osc.stop(t + 0.06);
    }
    function pulse(strong){
      if (reduceMotion) return;
      els.beatDot.animate(
        [{ transform:'scale(1)', background: strong ? 'var(--accent)' : 'var(--border)' },
         { transform:`scale(${strong ? 1.7 : 1.3})`, background:'var(--accent)' },
         { transform:'scale(1)', background:'var(--border)' }],
        { duration: strong ? 260 : 160, easing:'ease-out' }
      );
    }
    function tick(){
      // one tick per beat (quarter note) — a metronome clicks on the beat, not on 16th-note
      // subdivisions; the accent just marks the first beat of each 4-beat bar
      const strong = beat % 4 === 0;
      click(strong); pulse(strong);
      beat++;
      nextBeatAt = performance.now() + (60000 / bpm);
    }
    function restart(){
      clearInterval(timer);
      nextBeatAt = performance.now() + (60000 / bpm);
      timer = setInterval(tick, 60000 / bpm);
    }
    function start(){
      if (running) return;
      running = true; beat = 0; els.playBtn.setAttribute('aria-pressed', 'true');
      els.playBtn.setAttribute('aria-label', 'Stop metronome');
      tick(); restart();
    }
    function stop(){
      running = false; clearInterval(timer);
      els.playBtn.setAttribute('aria-pressed', 'false');
      els.playBtn.setAttribute('aria-label', 'Start metronome');
    }
    function tapTempo(){
      const now = performance.now();
      if (tapTimes.length && now - tapTimes.at(-1) > 2000) tapTimes = [];
      tapTimes.push(now);
      if (tapTimes.length > 5) tapTimes.shift();
      if (tapTimes.length < 2) return;
      const intervals = tapTimes.slice(1).map((time, i) => time - tapTimes[i]);
      setBpm(Math.round(60000 / (intervals.reduce((sum, value) => sum + value, 0) / intervals.length)));
    }
    els.playBtn.innerHTML = iconSvg('metronome');
    els.playBtn.setAttribute('aria-label', 'Start metronome');
    els.playBtn.addEventListener('click', () => running ? stop() : start());
    window.addEventListener('keydown', ev => {
      if (ev.defaultPrevented || ev.ctrlKey || ev.metaKey || ev.altKey || ev.repeat || ev.key.toLowerCase() !== 'k') return;
      if (document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
      ev.preventDefault();
      if (ev.shiftKey) tapTempo();
      else running ? stop() : start();
    });

    // Apps can use this to finish a phrase at the next four-beat bar boundary.
    function getTimeToNextBar(){
      if (!running) return null;
      const beatMs = 60000 / bpm;
      const currentBeat = beat % 4 || 4;
      const beatsToBarEnd = 5 - currentBeat;
      return Math.max(0, nextBeatAt - performance.now()) + (beatsToBarEnd - 1) * beatMs;
    }

    return { getBpm: () => bpm, getTimeToNextBar, tapTempo };
  }

  return {
    iconSvg, NOTE_NAMES, midiName, reduceMotion, WHITE_PC, ROW_H, LOW, HIGH, RANGE,
    buildKeyColumn, centerOn, createDeviceManager, createMetronome,
  };
})();
