// Korda — Uno R4 Minima standalone drone instrument.
// Spec: https://claude.ai/code/artifact/d6953bd0-aa92-465c-ad59-c3ef798b8803
//
// Pins:
//   D2-D8   7 note buttons (INPUT_PULLUP, active low) -> scale degrees 1-7
//   D9/D10  rotary encoder CLK/DT
//   D11     rotary encoder SW (click = next menu screen)
//   D12/D13 octave down / octave up buttons
//   A0      reserved, unused on purpose -- the R4's DAC pin, kept open for
//           a possible future Mozzi audio-synthesis output
//   A1/A2   joystick X/Y (spring-return)
//   A4/A5   OLED (I2C, SSD1306 128x64 @ 0x3C)
//   Serial1 TX -> DIN MIDI out to synth (D0/D1 UART; RX unused, this
//           sketch only sends -- DIN<->USB merging lives elsewhere now,
//           e.g. the R3+MocoLUFA box, not this board)
//
// Always outputs exactly 3 notes (root, note2, note3). Idle (no flavor) is
// root+5th+octave; pushing a joystick direction swaps note2/note3 for that
// flavor's pair. Monophonic: one button held at a time. Settings (root,
// mode, velocity) reset to default every boot, nothing persisted.

#include <MIDI.h>
#include <Bounce2.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

MIDI_CREATE_INSTANCE(decltype(Serial1), Serial1, MIDIdin); // DIN jacks, D0/D1
Adafruit_SSD1306 display(128, 64, &Wire, -1);

// ---- Pins ----
const uint8_t NOTE_PINS[7] = {2, 3, 4, 5, 6, 7, 8};
const uint8_t ENC_CLK = 9, ENC_DT = 10, ENC_SW = 11;
const uint8_t OCT_DOWN_PIN = 12, OCT_UP_PIN = 13;
// A0 deliberately not used for anything -- reserved for a future Mozzi DAC audio output.
const uint8_t JOY_X_PIN = A1, JOY_Y_PIN = A2;

// Flip these if up/down or left/right come out backwards on your wiring.
const int8_t JOY_X_SIGN = 1;
const int8_t JOY_Y_SIGN = 1;
const int JOY_DEADZONE = 150;        // ADC counts from center before a direction registers
const long ENCODER_COUNTS_PER_CLICK = 2; // CLK-edge counting fires ~2x per detent on most EC11-style encoders

Bounce noteButtons[7];
Bounce octDownBtn, octUpBtn, encSwBtn;

// Hand-rolled quadrature step detection: PJRC's Encoder library leans on
// AVR-only direct-port-access macros that don't exist for the Renesas R4 at
// all (not just an unlisted interrupt pin) -- a dozen lines here beats
// fighting an incompatible library for a menu knob we only poll each loop.
uint8_t lastEncClk = HIGH;
long encCounts = 0;

void pollEncoderPins() {
  uint8_t clk = digitalRead(ENC_CLK);
  if (clk != lastEncClk) {
    encCounts += (digitalRead(ENC_DT) != clk) ? 1 : -1;
  }
  lastEncClk = clk;
}

// ---- Music tables ----
const int8_t MODE_INTERVALS[7][7] = {
  {0, 2, 4, 5, 7, 9, 11},  // Ionian
  {0, 2, 3, 5, 7, 9, 10},  // Dorian
  {0, 1, 3, 5, 7, 8, 10},  // Phrygian
  {0, 2, 4, 6, 7, 9, 11},  // Lydian
  {0, 2, 4, 5, 7, 9, 10},  // Mixolydian
  {0, 2, 3, 5, 7, 8, 10},  // Aeolian
  {0, 1, 3, 5, 6, 8, 10},  // Locrian
};
const char *MODE_NAMES[7] = {"Ionian", "Dorian", "Phrygian", "Lydian", "Mixolydian", "Aeolian", "Locrian"};

// Joystick direction -> {note2 offset, note3 offset} above the scale root.
// Index order matches enum Direction below (TOP excluded, it's a reset not a flavor).
enum Direction : int8_t { DIR_NONE = -1, DIR_TOP, DIR_W, DIR_E, DIR_NW, DIR_NE, DIR_S, DIR_SW, DIR_SE };
const int8_t FLAVOR_OFFSETS[7][2] = {
  {4, 7},    // W  major
  {3, 7},    // E  minor
  {2, 7},    // NW sus2
  {5, 7},    // NE sus4
  {3, 10},   // S  minor7
  {2, 14},   // SW add9
  {3, 6},    // SE diminished
};
const char *FLAVOR_NAMES[7] = {"Major", "Minor", "Sus2", "Sus4", "Min7", "Add9", "Dim"};
const int8_t IDLE_OFFSETS[2] = {7, 12}; // root + 5th + octave

// ---- Performance state ----
int8_t root = 48;          // MIDI note, menu range 48..60
int8_t mode = 0;           // index into MODE_INTERVALS, 0 = Ionian
uint8_t velocity = 90;      // menu range 50..120
int8_t octaveOffset = 0;   // -2..+2, steps of 12 semitones
int8_t heldButton = -1;    // 0..6, or -1 if nothing held
int8_t activeFlavor = -1;  // index into FLAVOR_OFFSETS, or -1 for idle
Direction lastJoySector = DIR_NONE;
int soundingNotes[3] = {-1, -1, -1};
int joyCenterX = 512, joyCenterY = 512;
long lastEncCounts = 0;

enum MenuScreen : uint8_t { SCR_PLAY, SCR_ROOT, SCR_MODE, SCR_VELOCITY };
MenuScreen screen = SCR_PLAY;

void setup() {
#ifdef KORDA_SELFTEST
  selfTest();
#endif
  for (uint8_t i = 0; i < 7; i++) {
    noteButtons[i].attach(NOTE_PINS[i], INPUT_PULLUP);
    noteButtons[i].interval(5);
  }
  octDownBtn.attach(OCT_DOWN_PIN, INPUT_PULLUP); octDownBtn.interval(5);
  octUpBtn.attach(OCT_UP_PIN, INPUT_PULLUP);     octUpBtn.interval(5);
  encSwBtn.attach(ENC_SW, INPUT_PULLUP);         encSwBtn.interval(5);
  pinMode(ENC_CLK, INPUT_PULLUP);
  pinMode(ENC_DT, INPUT_PULLUP);
  lastEncClk = digitalRead(ENC_CLK);

  MIDIdin.begin(MIDI_CHANNEL_OFF); // we only send, never read
  MIDIdin.turnThruOff();

  // Joystick rests wherever it rests, not necessarily exactly mid-scale.
  joyCenterX = analogRead(JOY_X_PIN);
  joyCenterY = analogRead(JOY_Y_PIN);

  Wire.begin();
  display.begin(SSD1306_SWITCHCAPVCC, 0x3C);
  display.clearDisplay();
  display.display();

  lastEncCounts = encCounts;
}

void loop() {
  readNoteButtons();
  readOctaveButtons();
  readJoystick();
  readEncoderMenu();
  updateOutput();
  updateDisplay();
}

void readNoteButtons() {
  for (uint8_t i = 0; i < 7; i++) {
    noteButtons[i].update();
    if (noteButtons[i].fell()) {
      heldButton = (heldButton == (int8_t)i) ? -1 : (int8_t)i;
    }
  }
}

void readOctaveButtons() {
  octDownBtn.update();
  octUpBtn.update();
  if (octDownBtn.fell()) octaveOffset = max(-2, octaveOffset - 1);
  if (octUpBtn.fell())   octaveOffset = min(2, octaveOffset + 1);
}

// Classifies the stick into one of 8 compass directions (or DIR_NONE inside
// the deadzone), then fires on a change of sector -- that's what "push"
// means here. Holding a sector does nothing twice; releasing to center or
// sliding straight to a different sector are the only transitions that matter.
void readJoystick() {
  int dx = JOY_X_SIGN * (analogRead(JOY_X_PIN) - joyCenterX);
  int dy = JOY_Y_SIGN * (analogRead(JOY_Y_PIN) - joyCenterY);

  Direction sector = DIR_NONE;
  if (abs(dx) > JOY_DEADZONE || abs(dy) > JOY_DEADZONE) {
    float angle = atan2((float)dy, (float)dx) * 180.0 / PI; // 90=up(TOP), 0=right(E)
    if (angle < 0) angle += 360;
    int wedge = ((int)round(angle / 45.0)) % 8; // 0=E,1=NE,2=TOP,3=NW,4=W,5=SW,6=S,7=SE
    const Direction WEDGE_TO_DIR[8] = {DIR_E, DIR_NE, DIR_TOP, DIR_NW, DIR_W, DIR_SW, DIR_S, DIR_SE};
    sector = WEDGE_TO_DIR[wedge];
  }

  if (sector != DIR_NONE && sector != lastJoySector) {
    if (sector == DIR_TOP) {
      activeFlavor = -1; // always a reset, not a flavor -- leans into the spring instead of fighting it
    } else {
      int8_t idx = sector - DIR_W; // DIR_W..DIR_SE map to 0..6, matching FLAVOR_OFFSETS
      activeFlavor = (activeFlavor == idx) ? -1 : idx;
    }
  }
  lastJoySector = sector;
}

void readEncoderMenu() {
  pollEncoderPins();
  long delta = (encCounts - lastEncCounts) / ENCODER_COUNTS_PER_CLICK;
  if (delta != 0) {
    lastEncCounts += delta * ENCODER_COUNTS_PER_CLICK; // keep sub-click remainder for next time
    switch (screen) {
      case SCR_ROOT:     root = constrain(root + delta, 48, 60); break;
      case SCR_MODE:      mode = ((mode + delta) % 7 + 7) % 7; break;
      case SCR_VELOCITY:  velocity = constrain((long)velocity + delta, 50, 120); break;
      case SCR_PLAY:      break; // nothing to rotate
    }
  }
  encSwBtn.update();
  if (encSwBtn.fell()) {
    screen = (MenuScreen)((screen + 1) % 4);
  }
}

// The one place that decides what should be sounding right now, and reconciles
// it against what's actually sounding -- Note Off only what's no longer
// needed, Note On only what's new, nothing retriggered for notes unchanged.
void updateOutput() {
  int target[3] = {-1, -1, -1};
  if (heldButton >= 0) {
    int scaleRoot = root + MODE_INTERVALS[mode][heldButton] + octaveOffset * 12;
    const int8_t *offsets = (activeFlavor < 0) ? IDLE_OFFSETS : FLAVOR_OFFSETS[activeFlavor];
    target[0] = scaleRoot;
    target[1] = scaleRoot + offsets[0];
    target[2] = scaleRoot + offsets[1];
  }

  for (uint8_t i = 0; i < 3; i++) {
    int note = soundingNotes[i];
    if (note >= 0 && !contains(target, note)) MIDIdin.sendNoteOff(note, 0, 1);
  }
  for (uint8_t i = 0; i < 3; i++) {
    int note = target[i];
    if (note >= 0 && !contains(soundingNotes, note)) MIDIdin.sendNoteOn(note, velocity, 1);
  }
  memcpy(soundingNotes, target, sizeof(target));
}

bool contains(const int set[3], int value) {
  return set[0] == value || set[1] == value || set[2] == value;
}

void noteName(int midiNote, char *out) {
  static const char *NAMES[12] = {"C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"};
  int octave = midiNote / 12 - 1;
  sprintf(out, "%s%d", NAMES[((midiNote % 12) + 12) % 12], octave);
}

void updateDisplay() {
  char buf[16];
  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);
  display.setCursor(0, 0);

  switch (screen) {
    case SCR_PLAY: {
      display.println("Play");
      display.setCursor(0, 20);
      if (heldButton >= 0) {
        noteName(root + MODE_INTERVALS[mode][heldButton] + octaveOffset * 12, buf);
        display.print("Note: "); display.println(buf);
      } else {
        display.println("Note: --");
      }
      display.print("Flavor: ");
      display.println(activeFlavor < 0 ? "Idle" : FLAVOR_NAMES[activeFlavor]);
      display.print("Octave: "); display.println(octaveOffset);
      break;
    }
    case SCR_ROOT:
      noteName(root, buf);
      display.println("Set Root");
      display.setCursor(0, 20);
      display.println(buf);
      break;
    case SCR_MODE:
      display.println("Set Mode");
      display.setCursor(0, 20);
      display.println(MODE_NAMES[mode]);
      break;
    case SCR_VELOCITY:
      display.println("Set Velocity");
      display.setCursor(0, 20);
      display.println(velocity);
      break;
  }
  display.display();
}

// ---- Self-check: pure logic only, no hardware. Compile with -DKORDA_SELFTEST
// (or uncomment the define) and watch Serial for PASS/FAIL before trusting
// a change to the tables or the direction/chord math above. ----
//#define KORDA_SELFTEST
#ifdef KORDA_SELFTEST
void selfTest() {
  Serial.begin(9600);
  while (!Serial) {}
  bool ok = true;

  // Default C3 major triad: root 48, idle flavor -> 48,55,60.
  ok &= check(48 + IDLE_OFFSETS[0] == 55, "idle 5th");
  ok &= check(48 + IDLE_OFFSETS[1] == 60, "idle octave");

  // Major flavor on the same root: 48,52,55 (root unchanged, 60 drops out, 52 appears).
  ok &= check(48 + FLAVOR_OFFSETS[0][0] == 52, "major 3rd");
  ok &= check(48 + FLAVOR_OFFSETS[0][1] == 55, "major 5th (shared with idle)");

  // Minor flavor only flattens the 3rd versus major; the 5th (55) stays identical.
  ok &= check(FLAVOR_OFFSETS[1][1] == FLAVOR_OFFSETS[0][1], "major/minor share the 5th");
  ok &= check(FLAVOR_OFFSETS[1][0] == FLAVOR_OFFSETS[0][0] - 1, "minor 3rd is major 3rd minus a semitone");

  // Mode tables: Aeolian (natural minor) must differ from Ionian only at degrees 3,6,7.
  for (uint8_t i = 0; i < 7; i++) {
    bool shouldDiffer = (i == 2 || i == 5 || i == 6);
    bool differs = MODE_INTERVALS[0][i] != MODE_INTERVALS[5][i];
    ok &= check(differs == shouldDiffer, "Ionian vs Aeolian degree");
  }

  // Direction wedges: cardinal angles must land on their own direction, not a diagonal neighbor.
  const Direction WEDGE_TO_DIR[8] = {DIR_E, DIR_NE, DIR_TOP, DIR_NW, DIR_W, DIR_SW, DIR_S, DIR_SE};
  ok &= check(WEDGE_TO_DIR[((int)round(90.0 / 45.0)) % 8] == DIR_TOP, "90 degrees is TOP");
  ok &= check(WEDGE_TO_DIR[((int)round(0.0 / 45.0)) % 8] == DIR_E, "0 degrees is E");
  ok &= check(WEDGE_TO_DIR[((int)round(180.0 / 45.0)) % 8] == DIR_W, "180 degrees is W");

  // Diff/reconcile: unchanged note must not appear in either off-list or on-list.
  int before[3] = {48, 55, 60};
  int after[3] = {48, 52, 55};
  ok &= check(!contains(after, 60), "60 drops out going idle->major");
  ok &= check(contains(after, 55) && contains(before, 55), "55 is shared, never retriggered");
  ok &= check(contains(after, 52) && !contains(before, 52), "52 is new");

  Serial.println(ok ? "KORDA SELFTEST: PASS" : "KORDA SELFTEST: FAIL");
}

bool check(bool cond, const char *label) {
  if (!cond) { Serial.print("FAIL: "); Serial.println(label); }
  return cond;
}
#endif
