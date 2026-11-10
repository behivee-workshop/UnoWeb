# Keybench — Architecture

Three small standalone apps sharing one foundation. No build step, no
framework, no external runtime dependency anywhere. Icons are lucide.dev SVG
paths inlined directly (`ICON_PATHS` in `shared.js`).

```
app/
  index.html    launcher — three cards, links to the apps below
  shared.css    design tokens, navbar, piano/roll, pill controls, device panel
  shared.js     window.KB — icons, piano component, MIDI device manager, metronome
  live.html     Live  — the MIDI viewer (chord/sequence detection, note chart)
  sheet.html    Sheet — the step sequencer (per-track bars/pages, stretch, velocity)
  looper.html   Looper — Boss RC-5-style live looper (per-track play/pause, overdub)
```

Each app page is a complete document: `<link shared.css>` + `<script
shared.js>` (which attaches `window.KB`, not an ES module — there's no build
step to bundle one) + its own small inline `<style>` for whatever is specific
to that app, and its own inline `<script>` IIFE wiring that app's behavior.

Design system: a dark-only Bauhaus/"Composer" token set in `:root` (no
light-mode toggle — this is the product's own screen, like a synth's LCD, not
a page expected to follow the OS theme). Pill-shaped buttons, 6px cards,
hairline borders, four confetti hues (`--t1`..`--t4`) used as the four track
colors in both Sheet and Looper.

## Shared foundation (`shared.css` / `shared.js`)

**Navbar.** Every app's `.chassis-head` is the same three things: a wordmark
(links back to the launcher), a metronome, a quick-connect button, and a
settings gear. There is no in-page tab row anymore — each app has exactly one
center view, so switching "tabs" was replaced by: switching *apps* is a page
navigation (via the wordmark), and the gear button swaps the one center panel
for the Device/settings panel within the current app. This is simpler than
the earlier single-page, three-tab version and was a direct consequence of
splitting into separate apps — once each page only has one piece of main
content, a tablist for it stops making sense.

**Metronome** (`createMetronome`, in every navbar): one BPM, persisted to
`localStorage` so it reads the same across all three apps, a play/pause that
drives an audible click (Web Audio `OscillatorNode` blips, no audio files)
and the beat-dot pulse, and `getBpm()` for any app that wants to read the
current tempo. Sheet reads it directly instead of keeping its own separate
BPM control — one tempo, not a different number in every app. Looper
deliberately does **not** sync to it: a live looper is free-time, like a real
pedal, and quantizing it would defeat the point.

**Shared piano** (`buildKeyColumn`, one instance per app): the full 88 keys,
A0–C8 (MIDI 21–108), vertical, high pitch at top, in an `overflow:auto`
scroll container. Rows are a uniform 28px regardless of white/black key — a
deliberate simplification: real pianos don't give black keys equal "slot"
width, but a uniform-row schematic keyboard is how every DAW piano-roll
actually renders it, and it's what makes keys line up 1:1 with 16th-note grid
rows in Sheet. `press(midi, vel)` / `release(midi)` are the single entry
point for note events regardless of source — mouse/touch, the
computer-keyboard map (A W S E D F T G Y H U J K, Z/X to shift octaves), or a
real MIDI controller routed in via the device manager. This is why velocity
flows end-to-end from real hardware: `press` takes a `vel` that only
defaults to 100 when the source has none (mouse, computer keys).

**MIDI device manager** (`createDeviceManager`): real
`navigator.requestMIDIAccess()`, gated behind the navbar's quick-connect
button (not auto-requested on load, to avoid a surprise permission prompt).
On success, the first real input and first real output found are
auto-selected ("auto enable instruments") rather than silently staying on
the built-in Virtual Keyboard / local-only fallbacks — those fallbacks always
remain selectable and are what the app uses when nothing real is connected or
granted. `midiAccess.onstatechange` keeps the device list live on hotplug but
does **not** re-auto-select (a plugged-in second device shouldn't silently
steal a selection you already made). The fuller input/output lists (and
rescan) live in each app's own Device panel — the navbar button is the quick
path, the gear is "further control." Live has no output list at all (it only
ever receives). Device names from `requestMIDIAccess()` are untrusted
hardware/driver strings — the device list is built with
`createElement`/`textContent`, never `innerHTML`.

Each app routes incoming real MIDI (`onRealNoteOn`/`onRealNoteOff`) straight
to its own piano's `press`/`release`, unconditionally — there's no "only if
this panel is active" check. A hardware note should still register (and, in
Sheet/Looper, still record) even while you're glancing at the Device panel to
change a setting.

## Live (`live.html`)

- **Chord detection** (`detectChord`): matches the currently-held pitch-class
  set against a fixed chord-formula table (maj/min/dim/aug/7ths/sus).
  1 note → note name. 2 notes → interval name. 3+ → exact-set formula match,
  else falls back to listing the raw notes.
- **Sequence detection** (`checkSequence`): a rolling log of note-on pitches;
  compares the tail of consecutive semitone deltas against a small pattern
  table (major/minor scale, major/minor/dom7 arpeggio) plus a chromatic-run
  predicate. Transposition-invariant by construction (deltas, not raw notes).
- **Note chart** (canvas, `renderRoll`): every note-on punches a diamond and
  traces a flat glowing line at its pitch's row for exactly as long as it's
  held. Each note's line is independent (color per-pitch via `hue(midi)`) —
  an earlier version assigned notes to ranked "voice slots" and glided
  between them, which looked good for chords but meant stretching one note
  visually dragged unrelated notes with it; replaced for that reason. The
  canvas background is a fixed near-black regardless of theme — same "it's a
  lit screen" reasoning as the rest of the design system.
- Window is a fixed 6s scroll (`WINDOW_MS`); `now` is pinned to the right
  edge, history ages off to the left. This is a live-input view, not a
  playback view — there's no "future" to show approaching, so new events are
  born at the live edge rather than approaching a fixed playhead.

## Sheet (`sheet.html`)

### Data model

```
TRACKS[i] = {
  id, ch (MIDI channel 1-4), color, muted,
  bars,   // 1-4, independent per track (polymetric — tracks are not
          // required to loop at the same length; deliberate, not a gap)
  page,   // 0-based index into that track's own bars, which bar is
          // currently shown/edited for this track
  steps,  // fixed-length array, MAX_BARS*BAR_STEPS = 64 slots, always
          // allocated regardless of `bars` — shrinking `bars` hides the
          // tail steps, it never deletes them (non-destructive)
}
steps[i] = { notes: [{ midi, vel, len }] }  // zero or more simultaneous
                                             // notes — a step is a chord,
                                             // not a single pitch
```

`len` lives on the *note*, not the step or the track — stretching one voice
of a chord never touches its neighbors. Resolution is always 1/16 per step
(`BAR_STEPS = 16`); "bars" controls pattern *length*, not grid fineness.
Quantize (1/4, 1/8, 1/16) is a count of steps-per-quantize-unit against that
same fixed 16-steps-per-bar, so it doesn't need to know about `bars` at all.

### Why per-track bars, and why one page at a time

Each track keeps its own `bars` (1-4) and loops independently — a 1-bar bass
pattern can sit under a 4-bar evolving chord track. This means there is no
single global transport position; the playback engine keeps one free-running
`masterStep` counter and each track reads its own position as
`masterStep % (track.bars * 16)`.

Because independent per-track length makes a single shared "show me the
whole timeline" grid meaningless (tracks are different lengths and not
phase-locked to each other), the sequencer shows **one bar at a time** per
track — a "page". The step grid is always exactly 16 DOM columns; switching
pages re-renders those same 16 cells against a different slice of `steps`
(`storageIndex = page*16 + visibleColumn`). This is also why the grid
doesn't need horizontal scrolling — 16 columns always fits.

The playhead only lights up a column when the track's actual playing step
falls inside the page currently being viewed; otherwise no column is
highlighted for that track (it's still playing, just on a page you're not
looking at).

### Editing a note

Three ways in, all converging on the same `steps[i].notes` array:

1. **Click a grid cell** (`toggleCell`) — add/remove a note at that pitch/step
   in the current page.
2. **Drag a note's own cell vertically** (`startCellPress`) — sets velocity
   (1-127), visualized as the cell's fill brightness (`--vel-pct`). A plain
   click (no vertical movement past a small threshold) still toggles; this
   is a deliberate click-vs-drag disambiguation on the same gesture.
3. **Drag a note's own tail-cell handle horizontally** (`startResize`) —
   stretches that one note's `len`, clamped so it can't run into the next
   note on the same pitch, *and* clamped to the current bar (a note can't be
   manually stretched across a page boundary).
4. **Record live** (`seqNoteOn` / `seqNoteOff`, armed + a MIDI/keyboard note
   fires) — captures hold duration, see next.

### Recording captures hold duration as note length

A recorded note is no longer always `len:1` regardless of how long the key
was held — that was the one thing explicitly identified as wrong. Now:

- `seqNoteOn`: on note-on while armed, quantizes to a step, writes the note
  at `len:1`, and stashes `{trackId, stepIndex, startedAt}` in a
  `liveRecordings` map keyed by pitch.
- `seqNoteOff`: on release, looks up that pitch's recording, computes
  `elapsed / stepMs` → a step count, and sets the note's final `len` to that
  (minimum 1). Snap-on-release, not a live-growing visual during the hold —
  simpler, and the end result (the note is however long you held it) is the
  same.
- Clamped to the remaining steps **in the current bar** — same boundary rule
  as manual stretch, since a note living across a bar boundary would be
  invisible/unreachable from the one-page-at-a-time grid.

### Transport

Tempo comes from the shared navbar metronome (`getBpm()`), not a separate
Sheet-local control. One scheduler (`setInterval` at the 16th-note rate).
Each tick increments the shared `masterStep` and, per track, resolves that
track's own current step from it, sends any notes active there, and
schedules their note-off after `len` steps' worth of real time. Stop resets
`masterStep` to 0 for every track at once (tracks re-synchronize on stop/
restart, even though they can drift apart while playing — expected behavior
of polymetric sequencing, not a bug). There is no MIDI-out text log anymore —
notes go to the selected output device directly; nothing to read on screen.

## Looper (`looper.html`)

Boss RC-5 inspired, but with two explicit controls per track instead of one
footswitch that cycles rec→play→overdub→play — a tap-cycle is fine on a
pedal you operate by feel, but ambiguous as an on-screen button, so Looper
uses a dedicated **Play/Pause** and a dedicated **Overdub** button per track.

### Per-track state machine

```
empty --(Play/Pause)--> recording --(Play/Pause)--> playing
playing --(Overdub)--> overdubbing --(Overdub)--> playing
playing/overdubbing --(Play/Pause)--> paused --(Play/Pause)--> playing
(any state) --(Clear)--> empty
```

- **Play/Pause on empty**: starts recording (`recordStartAt`), with no
  predefined length — like a real looper, the first pass defines the loop.
- **Play/Pause while recording**: closes the loop. `loopLenMs = now -
  recordStartAt`; playback starts immediately, phase-aligned so elapsed-time
  0 is exactly where recording stopped.
- **Play/Pause while playing/overdubbing**: pauses. Resuming shifts
  `loopStartAt` forward by however long it was paused, so the loop resumes
  at the same position rather than jumping — pausing a modulo-based clock
  has to adjust the epoch, not just stop reading it.
- **Overdub** only does anything while playing; it arms capturing new events
  on top of the existing ones, still looping underneath. Pressing it again
  stops capturing and keeps the merged result.
- Events (`{midi, vel, onAt, dur}`) are timestamps relative to that track's
  own loop, not to any shared clock — each track's `loopLenMs` is whatever it
  happened to be when that track was closed, so tracks are independent
  lengths by construction (same "polymetric" idea as Sheet's per-track bars,
  arrived at for the same reason: a live looper has no business forcing every
  track to the same length).

### Playback

One `requestAnimationFrame` loop drives every track's own position
independently: `elapsed = (now - loopStartAt) % loopLenMs`. On each frame, an
event is triggered if its `onAt` timestamp was crossed since the last frame
(handling wraparound at the loop boundary). This is deliberately not
quantized to the shared metronome — notes land wherever they were actually
played, like a real pedal.

### What's shared with Sheet, and what isn't

Both apps have 4 colored tracks with MIDI channels and mute — that part is
identical in spirit. Where they differ is the editing model: Sheet is
after-the-fact, quantized, step-grid editing of something that doesn't have
to be played in real time; Looper is live capture of actual performance
timing with no grid at all. Trying to unify them into one data model would
have made both worse, so they don't share one — `TRACKS` is a different
shape in each file.

## Known simplifications (deliberate, not yet-done)

- No undo. No save/load/persistence — closing the tab loses everything
  except the metronome's BPM (which is the one thing persisted, in
  `localStorage`).
- Sheet: a note can't span a bar-page boundary (manual edit or recorded).
  Sheet: no live-growing visual while a note is being recorded; length is
  applied on release. Sheet: no "this track is playing on a different page"
  indicator.
- Looper: held-across-the-wrap-point notes during overdub get a best-effort
  duration fix-up (`+= loopLenMs` if negative), not rigorously tested against
  every edge case.
- Per-track independent length (both apps) means tracks can drift relative
  to each other during playback; only Stop (Sheet) or Clear (Looper)
  resets a given track. This is intentional, not a bug to fix later.
