# Scratch-to-Open · Web View

Flask dashboard that mirrors the cat door as a digital twin. It reads the
`peak,servo` stream from `piezo_servo.ino`, animates the flap, servo arm and
LED gauge, and keeps a request log.

```
pip install -r webview/requirements.txt

python webview/app.py --port COM3   # open the serial port at start
python webview/app.py               # pick the port in the UI, or simulate
```

Then open http://127.0.0.1:5000.

## Serial formats

| Sketch            | Line                | Handling                                |
|-------------------|---------------------|-----------------------------------------|
| piezo_servo.ino   | `peak,servo`        | flap follows the reported servo angle   |
| catdoor.ino       | `peak gauge`        | gauge taken from hardware               |
| catdoor.ino       | `OPEN,<mode>`       | open cycle, meow                        |
| piezo_servo.ino   | `mode,i,target,amp` | board confirming difficulty + threshold |
| catdoor.ino       | `blocked`           | IR beam flag                            |

`piezo_servo.ino` goes silent once the flap is closed, so a 180° reading older
than 150 ms is treated as closed.

## Simulation

Without hardware, press **Simulate** and drag on the scratch pad. Pointer speed
becomes the piezo peak. A single knock lights one pixel and drains; only a
sustained scratch fills the gauge. Difficulty follows the build book: the
target changes little, the per-window decay is what makes it hard.

Open events are appended to `data/requests.csv`.

## Difficulty

The cat personality sits in the top bar and drives both ends. Picking one sends
`1`, `2` or `3` to the board, which runs the same judge the twin does, so the
physical door really does change. Each tap adds a fixed amount and the gauge
decays continuously, so **what a mode asks for is tapping speed, not force**:

| Mode | Minimum rate | Comfortable rate | Taps to open |
|---|---|---|---|
| Kitten | 1.0 /s | 2 /s | 4 |
| Adult | 2.5 /s | 5 /s | 5 |
| Grumpy | 5.0 /s | 10 /s | 5 |

Below the minimum the gauge can never reach the target, so one stray knock never
opens the door. A sustained scratch hits the ~12.5 taps/s ceiling and opens any
mode. The threshold slider sends `a<n>` to the board; both settings are re-sent
whenever the board reboots, so a brown-out cannot desync the two ends.

## Sound

Each cat personality has its own meow, picked by the active difficulty:

| Mode | File | Character |
|---|---|---|
| Kitten | `meow_kitten.wav` | high soft squeak, ~1960 Hz |
| Adult | `meow_adult.wav` | a cat asking to go out, ~610 Hz |
| Grumpy | `meow_grumpy.wav` | low demanding yowl, ~245 Hz |

Sources and licences are in `static/sound/CREDITS.md`. Browsers block audio until the
page is touched, so the speaker button turns orange with a "click once" tooltip until
then; its first press only unlocks audio, later presses mute and unmute. If the files are
missing, a synthesized meow is used instead.

## Cat coats

The cat behind the door can be black, orange tabby, Siamese, mackerel tabby,
white or calico. Pick it from the selector in the twin card, or pass
`?coat=orange` in the URL. Coats are painted procedurally at load time, so no
image assets are needed.
