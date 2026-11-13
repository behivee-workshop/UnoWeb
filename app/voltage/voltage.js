(function(){
  "use strict";
  const { iconSvg, midiName, createDeviceManager, createMetronome } = window.KB;
  const STEPS = Array.from({ length:16 }, () => ({ midi:60, muted:false }));
  let rootMidi = 60, currentStep = -1, playing = false, timer = null, deviceManager;

  const metronome = createMetronome({
    playBtn: document.getElementById('metroPlay'), bpmDown: document.getElementById('bpmDown'),
    bpmUp: document.getElementById('bpmUp'), bpmReadout: document.getElementById('bpmReadout'), beatDot: document.getElementById('beatDot'),
  });

  const panelMain = document.getElementById('panelMain');
  const panelDevice = document.getElementById('panelDevice');
  const settingsBtn = document.getElementById('settingsBtn');
  let onDevice = false;
  settingsBtn.addEventListener('click', () => {
    onDevice = !onDevice; panelMain.inert = onDevice; panelMain.setAttribute('aria-hidden', String(onDevice));
    panelDevice.classList.toggle('active', onDevice); settingsBtn.setAttribute('aria-pressed', String(onDevice)); settingsBtn.setAttribute('aria-expanded', String(onDevice));
  });
  window.addEventListener('keydown', e => { if (e.key === 'Escape' && onDevice) settingsBtn.click(); });

  const rootSelect = document.getElementById('rootNote');
  for (let midi = 48; midi <= 72; midi++) {
    const option = document.createElement('option'); option.value = midi; option.textContent = midiName(midi); rootSelect.appendChild(option);
  }
  rootSelect.value = rootMidi;
  function setRootMidi(midi){
    rootMidi = midi; rootSelect.value = rootMidi;
    document.getElementById('minPitch').textContent = midiName(rootMidi - 12);
    document.getElementById('maxPitch').textContent = midiName(rootMidi + 12);
    STEPS.forEach(step => { step.midi = rootMidi; }); renderSteps();
  }
  rootSelect.addEventListener('change', () => setRootMidi(Number(rootSelect.value)));

  const sequencer = document.getElementById('voltageSequencer');
  function renderSteps(){
    sequencer.replaceChildren();
    STEPS.forEach((step, index) => {
      const el = document.createElement('div'); el.className = 'voltage-step' + (step.muted ? ' muted' : '') + (index === currentStep ? ' current' : '');
      const light = document.createElement('span'); light.className = 'step-light'; light.setAttribute('aria-label', `Step ${index + 1}${index === currentStep ? ', current' : ''}`);
      const slider = document.createElement('input'); slider.className = 'pitch-slider'; slider.type = 'range'; slider.min = rootMidi - 12; slider.max = rootMidi + 12; slider.value = step.midi; slider.step = '1'; slider.setAttribute('aria-label', `Step ${index + 1} pitch`);
      const note = document.createElement('output'); note.className = 'step-note'; note.textContent = midiName(step.midi);
      const number = document.createElement('span'); number.className = 'step-number'; number.textContent = String(index + 1).padStart(2, '0');
      const mute = document.createElement('button'); mute.className = 'step-mute'; mute.type = 'button'; mute.textContent = 'M'; mute.setAttribute('aria-label', `Mute step ${index + 1}`); mute.setAttribute('aria-pressed', String(step.muted));
      slider.addEventListener('input', () => { step.midi = Number(slider.value); note.textContent = midiName(step.midi); });
      mute.addEventListener('click', () => { step.muted = !step.muted; el.classList.toggle('muted', step.muted); mute.setAttribute('aria-pressed', String(step.muted)); });
      el.append(light, slider, note, number, mute); sequencer.appendChild(el);
    });
  }
  function showCurrentStep(){ [...sequencer.children].forEach((el, index) => el.classList.toggle('current', index === currentStep)); }
  function tick(){
    currentStep = (currentStep + 1) % STEPS.length;
    const step = STEPS[currentStep];
    if (!step.muted) { const length = (60000 / metronome.getBpm()) / 4; deviceManager.sendNoteOn(1, step.midi, 100); setTimeout(() => deviceManager.sendNoteOff(1, step.midi), length * .9); }
    showCurrentStep();
  }
  function play(){ if (playing) return; playing = true; document.getElementById('playBtn').innerHTML = iconSvg('pause'); tick(); timer = setInterval(tick, (60000 / metronome.getBpm()) / 4); }
  function stop(){ playing = false; clearInterval(timer); timer = null; currentStep = -1; showCurrentStep(); document.getElementById('playBtn').innerHTML = iconSvg('play', 'play'); }
  document.getElementById('playBtn').innerHTML = iconSvg('play', 'play');
  document.getElementById('stopBtn').innerHTML = iconSvg('square');
  document.getElementById('playBtn').addEventListener('click', () => playing ? stop() : play());
  document.getElementById('stopBtn').addEventListener('click', stop);
  window.addEventListener('keydown', e => { if (onDevice || e.ctrlKey || e.metaKey || e.altKey || e.repeat || e.code !== 'Space') return; e.preventDefault(); playing ? stop() : play(); });

  deviceManager = createDeviceManager({
    els: { quickConnectBtn:document.getElementById('quickConnectBtn'), statusText:document.getElementById('connectStatus'), rescanBtn:document.getElementById('rescanBtn'), inputList:document.getElementById('inputList'), outputList:document.getElementById('outputList') },
    onRealNoteOn: () => {}, onRealNoteOff: () => {},
  });
  setRootMidi(rootMidi);
})();
