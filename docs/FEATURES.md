# Keybench — Features

Keybench is a no-build, browser-based MIDI workstation with three focused
apps sharing one clock, virtual piano, MIDI device manager, and visual system.

## Shared

- Virtual 88-key piano with touch, mouse, computer-keyboard, and MIDI input.
- MIDI input/output selection and quick connection.
- Persistent BPM metronome: `K` toggles it and `Shift+K` sets tempo by tap.
- Mobile-friendly controls, safe-area handling, and responsive settings sheets.

## Live

- Displays played notes in a six-second rolling note chart.
- Detects held-note chords and recognises common melodic and arpeggio patterns.
- Shows a compact chord readout in the lower-right corner.
- Keeps input instructions in the top-right help popover to leave the screen
  clear while playing.

## Sheet

- Four-track, polymetric 16th-note sequencer with one editable bar per page.
- Full-width timeline columns distinguish quarter, eighth, and sixteenth notes.
- Draw, stretch, select, move, and velocity-edit notes; record note lengths live.
- Fixed vertical playhead remains visible while scrolling the piano roll.
- `R` records, Space plays/pauses, `M` mutes, and `C`, Delete, or Backspace
  clears the selected track.

## Loop

- Four independent MIDI loop tracks with play/pause, overdub, mute, and clear.

### Voltage

- A 16-step voltage sequencer: every step independently tunes one octave below or above the selected C3–C5 key, with Ionian through Locrian mode selection and scale-degree progression buttons.
- Per-step mute switches and current-step indicator lights; sends MIDI on channel 1.
- With the metronome running, first recording arms on beat 1 and closes at the
  end of the current bar rather than abruptly mid-bar.
- Shows live and completed loop length in bars.
- Select a track by tapping it or pressing `1`–`4`; `R` records, `O` toggles
  overdub, `Z` undoes the last overdub, `M` mutes, and Space plays/pauses.
- Boss RC-5-inspired high-contrast performance controls with large square
  touch targets.

## Help and settings

Each app has a top-right `?` button for contextual keyboard help and a gear
button that opens MIDI settings as an overlay rather than replacing the app.
