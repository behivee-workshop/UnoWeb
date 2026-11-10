// Uno R4: merges DIN MIDI (Serial1, hw UART) with USB MIDI (Serial, native USB-CDC).
// Needs Arduino's "MIDI Library" (Library Manager -> search "MIDI" by Forty Seven Effects).
//
// R4 has no class-compliant USB-MIDI yet (core gap, not a hardware limit), so the
// USB side is a raw serial MIDI stream. On the computer, run "Hairless MIDI<->Serial
// Bridge" (or ttymidi on Linux) pointed at this board's port to expose it as a real
// virtual MIDI port any DAW can see.
#include <MIDI.h>

MIDI_CREATE_INSTANCE(decltype(Serial1), Serial1, MIDIdin); // DIN jacks, D0/D1
MIDI_CREATE_INSTANCE(decltype(Serial), Serial, MIDIusb);   // USB-CDC bridge

void setup() {
  MIDIdin.begin(MIDI_CHANNEL_OMNI);
  MIDIdin.turnThruOff();
  MIDIusb.begin(MIDI_CHANNEL_OMNI);
  MIDIusb.turnThruOff();
}

void loop() {
  if (MIDIdin.read()) {
    MIDIusb.send(MIDIdin.getType(), MIDIdin.getData1(), MIDIdin.getData2(), MIDIdin.getChannel());
  }
  if (MIDIusb.read()) {
    MIDIdin.send(MIDIusb.getType(), MIDIusb.getData1(), MIDIusb.getData2(), MIDIusb.getChannel());
  }
}
