// Scratch-to-Open test rig: piezo -> leaky-integrator gauge -> servo -> MAX7219 meter.
//
// Each tap raises the gauge by TAP_RISE, and every sample window subtracts a decay.
// What matters is therefore not how hard you hit, but how many taps per second.
// Difficulty is made by the decay, not the target (build-book rule): a larger
// decay means you must tap faster.
//
// Wiring: piezo signal -> A0
//         servo signal -> D9
//         servo VCC/GND -> external 5V; tie GND common with the Arduino.
//         MAX7219 8x8 matrix: DIN -> D11, CS -> D10, CLK -> D13, VCC 5V, GND
//
// The matrix is the persuasion gauge. While the door is closed it fills in
// proportion to the target (8 columns = open); while the door moves it shows the
// flap lifting; while open it shows a cat face.
//
// Output: peak,servo,gauge  (CSV) at 115200
// Input:  'o'    force one open cycle (servo self-test from the laptop)
//         'm'    light the whole matrix for 0.6 s (wiring check)
//         '1'    kitten   '2' adult   '3' grumpy
//         'a123' set the scratch threshold (SCRATCH_AMP) to 123; newline after digits.

#include <Servo.h>

const int PIN_PIEZO = A0;
const int PIN_SERVO = 9;
const int PIN_MX_DIN = 11;
const int PIN_MX_CS  = 10;
const int PIN_MX_CLK = 13;

const byte MX_INTENSITY = 8;        // 0..15; outdoor booth may want 12+
const bool MX_FLIP_X = false;       // flip if the bar fills from the wrong side
const bool MX_FLIP_Y = false;       // flip if the flap animation runs upside down

const int NOISE_FLOOR = 25;  // measure with no vibration and set accordingly

const int ANG_CLOSED = 0;
const int ANG_OPEN   = 80;              // sets the flap lift for the R45 arm
const unsigned long HOLD_MS     = 3000; // how long the door stays open
const unsigned long COOLDOWN_MS = 1000; // delay before reacting again after closing
const int SWEEP_MS  = 500;              // 0 -> ANG_OPEN travel time
const bool REST_DETACH = true;          // stop pulses when closed: no hum, no idle current

// Pulse limits. Cheap SG90 clones stall and overheat when driven to the default
// 544/2400 us extremes, so keep a margin and never command a mechanical stop.
const int PULSE_MIN_US = 600;
const int PULSE_MAX_US = 2300;

// ---- judging: tap-driven leaky integrator ------------------------------
// The window is fixed by sample count, not time. About 21 ms on an Uno.
const int SAMPLES = 200;
const int WINDOW_MS = 21;           // measured length of the window above
const int GAUGE_MAX = 200;
int scratchAmp = 80;                // a peak above this counts as one tap

// One tap = TAP_RISE. The refractory time stops a single strike counting twice;
// a continuous scratch lands one tap per refractory period, capping the tap rate
// at about 12.5 taps/s.
const int TAP_RISE = 40;
const int TAP_REFRACTORY_MS = 80;
const int DIFF_TARGET = 100;        // shared by all three modes; only decay differs

// Decay per window. The larger this is, the faster you must tap for the gauge to win.
// Minimum rate (taps/s) = decay x (1000/21) / TAP_RISE  ->  about 1 / 2.5 / 5 taps/s.
// Tapping at twice that rate opens any mode in about 5 taps.
const float DIFF_DECAY[3] = { 0.8, 2.1, 4.2 };
int diff = 1;                       // 0 kitten, 1 adult, 2 grumpy
float gauge = 0;
unsigned long lastTap = 0;

// Non-blocking sweep: the servo advances a few degrees per sample window, so the
// piezo keeps streaming while the flap moves.
const int STEP_DEG = max(1, (int)((long)(ANG_OPEN - ANG_CLOSED) * WINDOW_MS / SWEEP_MS));

Servo servo;

enum State { CLOSED, OPENING, OPEN, CLOSING };
State state = CLOSED;
int angle  = ANG_CLOSED;        // last angle written
int target = ANG_CLOSED;
unsigned long stateSince = 0;   // time of the last state transition

// ---- MAX7219, bit-banged (no library) ---------------------------------

void mxSend(byte reg, byte data) {
  digitalWrite(PIN_MX_CS, LOW);
  shiftOut(PIN_MX_DIN, PIN_MX_CLK, MSBFIRST, reg);
  shiftOut(PIN_MX_DIN, PIN_MX_CLK, MSBFIRST, data);
  digitalWrite(PIN_MX_CS, HIGH);
}

byte flipBits(byte b) {
  byte r = 0;
  for (int i = 0; i < 8; i++) if (b & (1 << i)) r |= 0x80 >> i;
  return r;
}

// rows[0] is the top row, bit 7 the leftmost column. Unchanged frames are not resent.
byte mxShown[8];
void mxFrame(const byte rows[8]) {
  if (memcmp(rows, mxShown, 8) == 0) return;
  memcpy(mxShown, rows, 8);
  for (int i = 0; i < 8; i++) {
    byte row = rows[MX_FLIP_Y ? 7 - i : i];
    mxSend(i + 1, MX_FLIP_X ? flipBits(row) : row);
  }
}

void mxInit() {
  pinMode(PIN_MX_DIN, OUTPUT);
  pinMode(PIN_MX_CS, OUTPUT);
  pinMode(PIN_MX_CLK, OUTPUT);
  digitalWrite(PIN_MX_CS, HIGH);
  mxSend(0x0F, 0);            // display test off
  mxSend(0x09, 0);            // no BCD decode
  mxSend(0x0B, 7);            // scan all 8 digits
  mxSend(0x0A, MX_INTENSITY);
  mxSend(0x0C, 1);            // normal operation
  memset(mxShown, 0xFF, 8);
  const byte blank[8] = {0, 0, 0, 0, 0, 0, 0, 0};
  mxFrame(blank);
}

void mxTest() {
  mxSend(0x0F, 1);
  delay(600);
  mxSend(0x0F, 0);
}

const byte CAT_FACE[8] = {
  0b10000001,
  0b11000011,
  0b11111111,
  0b10111101,
  0b11111111,
  0b11100111,
  0b01111110,
  0b00111100,
};

// closed door at rest: frame outline with the flap inside
const byte DOOR_CLOSED[8] = {
  0b11111111,
  0b10000001,
  0b10111101,
  0b10111101,
  0b10111101,
  0b10111101,
  0b10000001,
  0b11111111,
};

// gauge: columns fill from the left, all rows lit; the door glyph shows while empty
void drawMeter(float level) {
  int cols = constrain((int)(level + 0.5), 0, 8);
  if (cols == 0) { mxFrame(DOOR_CLOSED); return; }
  byte row = (byte)(0xFF << (8 - cols));
  byte rows[8];
  for (int i = 0; i < 8; i++) rows[i] = row;
  mxFrame(rows);
}

// door frame with the flap drawn from the top; the gap grows from the bottom as it lifts
void drawFlap(int deg) {
  int gap = constrain((long)deg * 6 / ANG_OPEN, 0, 6);   // rows revealed inside the frame
  byte rows[8];
  rows[0] = 0xFF;
  rows[7] = 0xFF;
  for (int i = 1; i < 7; i++) rows[i] = (i > 6 - gap) ? 0x81 : 0xFF;
  mxFrame(rows);
}

void drawFace(bool blink) {
  byte rows[8];
  memcpy(rows, CAT_FACE, 8);
  if (blink) rows[3] = 0b11111111;
  mxFrame(rows);
}

// ---- serial commands ---------------------------------------------------

void reportMode() {
  Serial.print("mode,");
  Serial.print(diff);
  Serial.print(',');
  Serial.print(DIFF_TARGET);
  Serial.print(',');
  Serial.println(scratchAmp);
}

// Returns true if a forced open was requested.
bool readCommands() {
  static char argCmd = 0;       // command still collecting digits
  static int  argVal = -1;
  bool force = false;

  while (Serial.available()) {
    char c = Serial.read();

    if (argCmd && c >= '0' && c <= '9') {         // digits belong to the pending command
      argVal = (argVal < 0 ? 0 : argVal) * 10 + (c - '0');
      continue;
    }
    if (argCmd) {                                  // any other byte ends it
      if (argCmd == 'a' && argVal > 0) { scratchAmp = constrain(argVal, 10, 1023); reportMode(); }
      argCmd = 0;
      argVal = -1;
    }

    if (c == 'a' || c == 'A') { argCmd = 'a'; continue; }
    if (c == 'o' || c == 'O') force = true;
    if (c == 'm' || c == 'M') mxTest();
    if (c >= '1' && c <= '3') { diff = c - '1'; gauge = 0; reportMode(); }
  }
  return force;
}

void setup() {
  Serial.begin(115200);
  Serial.println("peak,servo,gauge");
  servo.attach(PIN_SERVO, PULSE_MIN_US, PULSE_MAX_US);
  mxInit();
  mxTest();                                                   // every LED on: wiring check
  for (int c = 1; c <= 8; c++) { drawMeter(c); delay(60); }   // then the gauge fills once

  // Boot self-test: a visible sweep proves power and signal before any scratch.
  servo.write(ANG_CLOSED);
  delay(300);
  servo.write(ANG_OPEN / 2);
  delay(400);
  servo.write(ANG_CLOSED);
  delay(400);
  if (REST_DETACH) servo.detach();
  reportMode();
  stateSince = millis();
}

void loop() {
  // Take the peak amplitude over a fixed number of samples (one window).
  int peak = 0;
  for (int i = 0; i < SAMPLES; i++) {
    int v = analogRead(PIN_PIEZO);
    if (v > peak) peak = v;
  }

  bool force = readCommands();
  unsigned long now = millis();

  // Tap judgement. Ringing inside the refractory time counts as the same strike.
  bool tapped = false;
  if (peak >= scratchAmp && now - lastTap >= (unsigned long)TAP_REFRACTORY_MS) {
    lastTap = now;
    tapped = true;
  }

  // Rise vs decay. The gauge only accumulates while the door is closed.
  if (state == CLOSED) {
    gauge += (tapped ? TAP_RISE : 0) - DIFF_DECAY[diff];
    gauge = constrain(gauge, 0, (float)GAUGE_MAX);
  }

  switch (state) {
    case CLOSED:
      if ((gauge >= DIFF_TARGET && now - stateSince >= COOLDOWN_MS) || force) {
        if (!servo.attached()) servo.attach(PIN_SERVO, PULSE_MIN_US, PULSE_MAX_US);
        target = ANG_OPEN;
        state = OPENING;
        stateSince = now;
      }
      break;
    case OPENING:
      if (angle == target) { state = OPEN; stateSince = now; }
      break;
    case OPEN:
      if (now - stateSince >= HOLD_MS) { target = ANG_CLOSED; state = CLOSING; stateSince = now; }
      break;
    case CLOSING:
      if (angle == target) {
        state = CLOSED;
        stateSince = now;
        gauge = 0;
        if (REST_DETACH) servo.detach();
      }
      break;
  }

  // one step toward the target per window
  if (angle < target) {
    angle = min(target, angle + STEP_DEG);
    servo.write(angle);
  } else if (angle > target) {
    angle = max(target, angle - STEP_DEG);
    servo.write(angle);
  }

  // matrix
  switch (state) {
    case CLOSED:
      drawMeter(gauge * 8.0f / DIFF_TARGET);
      break;
    case OPENING:
    case CLOSING:
      drawFlap(angle);
      break;
    case OPEN:
      drawFace(((now - stateSince) / 150) % 12 == 11);   // occasional blink
      break;
  }

  if (peak > NOISE_FLOOR || gauge > 0 || state != CLOSED) {
    Serial.print(peak);
    Serial.print(',');
    Serial.print(angle);
    Serial.print(',');
    Serial.println((int)gauge);
  }
}
