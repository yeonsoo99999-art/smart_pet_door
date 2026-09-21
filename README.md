# Smart Pet Door — Scratch-to-Open

A cat door that opens for a *request*, not a presence. Instead of a motion or
proximity sensor, a piezo disc listens to the door panel: the cat has to
scratch at a steady rate to "ask", and a leaky-integrator gauge decides when
the request is convincing enough to lift the flap.

One stray knock never opens the door — a single tap lights one pixel of the
gauge and drains away. Only sustained scratching fills the gauge to the
target. Difficulty ("cat personality") is set purely by the decay rate, so a
harder mode asks for *faster* tapping, not harder hits.

## What's in this repository

| Path | Contents |
|---|---|
| `piezo_servo/` | Arduino sketch: piezo sensing, tap judging, SG90 servo flap drive, MAX7219 8×8 gauge/animations |
| `webview/` | Flask web dashboard — a live 3D digital twin (Three.js) of the door with a scratch simulator, waveform view and request log |
| `doc/` | Laser-cutting DXF files for the MDF enclosure, plus build notes |
| `run.bat` | One-click launcher for the dashboard on Windows |

## Hardware

- Arduino Uno (or compatible)
- Piezo disc → `A0` (signal), GND
- SG90 servo → `D9` (signal), external 5 V supply, common GND
- MAX7219 8×8 LED matrix → `DIN D11`, `CS D10`, `CLK D13`, 5 V, GND
- Laser-cut MDF enclosure (see `doc/README.md` for sheets, parts and assembly)

## Installation

1. **Firmware** — open `piezo_servo/piezo_servo.ino` in the Arduino IDE and
   upload it to the board (115200 baud). On boot it runs a visible self-test:
   full matrix flash, gauge fill, and a servo sweep.

2. **Dashboard** — requires Python 3.10+.

   ```
   pip install -r webview/requirements.txt
   ```

## Usage

Start the dashboard:

```
python webview/app.py --port COM3   # open the serial port at start
python webview/app.py               # or pick the port in the UI
```

Then open http://127.0.0.1:5000. On Windows, `run.bat [COM port]` installs the
dependencies if needed, starts the server and opens the browser.

**No hardware?** Press **Simulate** and drag on the acrylic pad in the 3D view —
pointer speed becomes the piezo peak, and the digital twin runs the exact same
judging logic as the firmware.

Things to try:

- **Cat personality** (Kitten / Adult / Grumpy) changes the decay: minimum tap
  rates of about 1 / 2.5 / 5 taps per second. The setting is sent to the board
  over serial, so the physical door really changes too.
- **Scratch threshold** slider separates table knocks from real scratches.
- **Test servo** sends `o` to the board for a forced open cycle.
- Every successful request is logged with time, mode and peak value
  (`webview/data/requests.csv`).

Serial protocol, difficulty math and sound credits are documented in
`webview/README.md`.

## Author

**Yeonsoo Kang**
