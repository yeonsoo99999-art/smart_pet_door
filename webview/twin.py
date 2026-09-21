"""Digital twin of the Scratch-to-Open cat door.

Mirrors the firmware: a leaky-integrator gauge fed by piezo peaks, an SG90
sweeping a R45 arm, and a flap lifted by a fixed-length string.
"""
import csv
import math
import os
import threading
import time
from collections import deque
from datetime import datetime

NUM_LEDS = 8
GAUGE_MAX = 200
TICK_MS = 20            # one sample window, same as the sketch
WINDOW_MS = 21          # the firmware's measured window; rates are derived from it
HW_STALE_MS = 150       # firmware prints every window while open; silence means closed

# One tap adds TAP_RISE; the refractory stops one strike counting twice and caps a
# continuous scratch at ~12.5 taps/s. Difficulty is decay alone, so what a mode asks
# for is a tapping *rate*, not a harder hit.
TAP_RISE = 40
TAP_REFRACTORY_MS = 80
TARGET = 100

DIFFICULTY = {
    "kitten": {"target": TARGET, "decay": 0.8},
    "adult":  {"target": TARGET, "decay": 2.1},
    "grumpy": {"target": TARGET, "decay": 4.2},
}


def min_tap_rate(decay):
    'Taps per second below which the gauge can never reach the target.'
    return decay * (1000.0 / WINDOW_MS) / TAP_RISE
# Index order shared with the firmware: serial '1'..'3' select these.
DIFF_ORDER = ["kitten", "adult", "grumpy"]

ARM_R = 45              # arm axis at (100, 200) mm, y up from base


def flap_rise(angle_deg):
    """Arm tip rise for a servo angle; the string is fixed so the flap follows."""
    return ARM_R * (1 - math.cos(math.radians(angle_deg)))


class Twin:
    def __init__(self, log_path=None):
        self.lock = threading.Lock()
        self.log_path = log_path

        self.difficulty = "adult"
        self.exhibit = True
        self.scratch_amp = 80
        self.noise_floor = 25
        self.cooldown_ms = 1000
        self.last_tap = 0.0

        self.source = "none"        # none | serial | sim
        self.port = None
        self.beam_blocked = False

        self.peak = 0
        self.hits = 0
        self.gauge = 0.0
        self.hw_gauge = None
        self.servo_target = 0
        self.servo_angle = 0.0
        self.state = "idle"
        self.state_since = time.monotonic()
        self.hw_servo = None
        self.hw_seen = 0.0
        self.hw_beam_seen = None
        self.board_resets = 0
        self._force = False

        self.open_count = 0
        self.events = deque(maxlen=200)
        self.history = deque(maxlen=900)

        self._pending = []
        self._last_tick = time.monotonic()
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    # ---- inputs -------------------------------------------------------

    def feed(self, peak, servo=None, gauge=None):
        with self.lock:
            self._pending.append(int(peak))
            if servo is not None:
                self._set_hw_servo(int(servo))
            if gauge is not None:
                self.hw_gauge = float(gauge)

    def hw_open_event(self):
        with self.lock:
            self._set_hw_servo(180)

    def difficulty_code(self):
        """Serial byte that puts the board on the mode the UI shows."""
        with self.lock:
            return str(DIFF_ORDER.index(self.difficulty) + 1).encode()

    def amp_code(self):
        with self.lock:
            return b"a%d\n" % self.scratch_amp

    def note_mode(self, idx, target=None, amp=None):
        """The board reported its mode; follow it so both ends agree."""
        with self.lock:
            if 0 <= idx < len(DIFF_ORDER):
                self.difficulty = DIFF_ORDER[idx]
            if amp:
                self.scratch_amp = int(amp)

    def note_boot(self, resets):
        with self.lock:
            self.board_resets = resets
            self.hw_servo = 0

    def force_open(self):
        with self.lock:
            self._force = True

    def hw_beam_blocked(self):
        with self.lock:
            self.beam_blocked = True
            self.hw_beam_seen = time.monotonic()

    def set_source(self, source, port=None):
        with self.lock:
            self.source = source
            self.port = port
            if source != "serial":
                self.hw_servo = None
                self.hw_gauge = None
                self.board_resets = 0

    def update_settings(self, data):
        with self.lock:
            if data.get("difficulty") in DIFFICULTY:
                self.difficulty = data["difficulty"]
            for key in ("scratch_amp", "noise_floor", "cooldown_ms"):
                if key in data:
                    setattr(self, key, max(1, int(data[key])))
            if "exhibit" in data:
                self.exhibit = bool(data["exhibit"])
            if "beam_blocked" in data:
                self.beam_blocked = bool(data["beam_blocked"])

    def reset_count(self):
        with self.lock:
            self.open_count = 0
            self.events.clear()

    # ---- internals ----------------------------------------------------

    def _set_hw_servo(self, angle):
        prev = self.hw_servo
        self.hw_servo = angle
        self.hw_seen = time.monotonic()
        if angle > 0 and not prev:
            self.gauge = max(self.gauge, float(DIFFICULTY[self.difficulty]["target"]))
            self._record_open()

    def _record_open(self):
        self.open_count += 1
        ev = {
            "t": datetime.now().isoformat(timespec="seconds"),
            "difficulty": self.difficulty,
            "peak": self.peak,
            "source": self.source,
        }
        self.events.appendleft(ev)
        if not self.log_path:
            return
        try:
            new = not os.path.exists(self.log_path)
            with open(self.log_path, "a", newline="", encoding="utf-8") as f:
                w = csv.writer(f)
                if new:
                    w.writerow(["time", "difficulty", "peak", "source"])
                w.writerow([ev["t"], ev["difficulty"], ev["peak"], ev["source"]])
        except OSError:
            pass

    def _sweep_ms(self):
        return 1000 if self.exhibit else 2000

    def _hold_ms(self):
        return 4000 if self.exhibit else 3000

    def _run(self):
        while not self._stop.is_set():
            time.sleep(TICK_MS / 1000)
            with self.lock:
                self._tick()

    def _tick(self):
        now = time.monotonic()
        dt_ms = (now - self._last_tick) * 1000
        self._last_tick = now

        peak = max(self._pending) if self._pending else 0
        self._pending.clear()
        self.peak = peak

        cfg = DIFFICULTY[self.difficulty]
        moving = self.state in ("opening", "open", "closing")
        tapped = peak >= self.scratch_amp and (now - self.last_tap) * 1000 >= TAP_REFRACTORY_MS
        if tapped:
            self.last_tap = now
        if self.hw_gauge is not None and self.source == "serial":
            self.gauge = self.hw_gauge
            self.hits = 0
        elif moving:
            self.hits = 0
        else:
            self.hits = TAP_RISE if tapped else 0
            self.gauge += self.hits - cfg["decay"]
            self.gauge = max(0.0, min(float(GAUGE_MAX), self.gauge))

        if self.hw_beam_seen and now - self.hw_beam_seen > 0.6:
            self.beam_blocked = False
            self.hw_beam_seen = None

        if self.hw_servo is not None:
            if self.hw_servo > 0 and now - self.hw_seen > HW_STALE_MS / 1000:
                self.hw_servo = 0
            self.servo_target = self.hw_servo
            self._follow_hardware(now)
        else:
            self._autonomous(now, cfg)

        step = 180 * dt_ms / self._sweep_ms()
        if self.servo_angle < self.servo_target:
            self.servo_angle = min(self.servo_target, self.servo_angle + step)
        elif self.servo_angle > self.servo_target:
            self.servo_angle = max(self.servo_target, self.servo_angle - step)

        self.history.append((round(time.time(), 3), peak, round(self.gauge, 1)))

    def _follow_hardware(self, now):
        target = self.servo_target
        if target > 0 and self.servo_angle < target:
            new = "opening"
        elif target > 0:
            new = "open" if self.state in ("opening", "open") else "closing"
        elif self.servo_angle > 0:
            new = "closing"
        else:
            new = "scratching" if self.gauge > 0 else "idle"
        if new != self.state:
            if self.state == "closing" and new in ("idle", "scratching"):
                self.gauge = 0.0
                new = "idle"
            self._go(new, now)

    def _autonomous(self, now, cfg):
        elapsed = (now - self.state_since) * 1000
        s = self.state

        if s in ("idle", "scratching", "cooldown"):
            ready = s != "cooldown" or elapsed >= self.cooldown_ms
            want = "scratching" if self.gauge > 0 else "idle"
            if (self.gauge >= cfg["target"] or self._force) and ready:
                self._force = False
                self.gauge = max(self.gauge, float(cfg["target"]))
                self.servo_target = 180
                self._record_open()
                self._go("opening", now)
            elif s == "cooldown":
                if ready:
                    self._go(want, now)
            elif want != s:
                self._go(want, now)
        elif s == "opening":
            if self.servo_angle >= 180:
                self._go("open", now)
        elif s == "open":
            if elapsed >= self._hold_ms() and not self.beam_blocked:
                self.servo_target = 0
                self._go("closing", now)
        elif s == "closing":
            if self.servo_angle <= 0:
                self.gauge = 0.0
                self._go("cooldown", now)

    def _go(self, state, now):
        self.state = state
        self.state_since = now

    # ---- output -------------------------------------------------------

    def snapshot(self):
        with self.lock:
            cfg = DIFFICULTY[self.difficulty]
            lit = min(NUM_LEDS, int(self.gauge * NUM_LEDS / cfg["target"]))
            return {
                "t": time.time(),
                "peak": self.peak,
                "hits": self.hits,
                "gauge": round(self.gauge, 1),
                "target": cfg["target"],
                "decay": cfg["decay"],
                "lit": lit,
                "angle": round(self.servo_angle, 1),
                "servo_target": self.servo_target,
                "rise": round(flap_rise(self.servo_angle), 2),
                "state": self.state,
                "source": self.source,
                "port": self.port,
                "hw_servo": self.hw_servo,
                "beam_blocked": self.beam_blocked,
                "difficulty": self.difficulty,
                "exhibit": self.exhibit,
                "scratch_amp": self.scratch_amp,
                "noise_floor": self.noise_floor,
                "tap_rise": TAP_RISE,
                "min_rate": round(min_tap_rate(cfg["decay"]), 1),
                "open_taps": round(TARGET / (TAP_RISE / 2.0)),
                "cooldown_ms": self.cooldown_ms,
                "open_count": self.open_count,
                "board_resets": self.board_resets,
            }

    def recent_events(self):
        with self.lock:
            return list(self.events)

    def recent_history(self):
        with self.lock:
            return list(self.history)
