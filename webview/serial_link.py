"""Serial reader for the cat door sketches.

Accepts both line formats:
  piezo_servo.ino  ->  "peak,servo"
  catdoor.ino      ->  "peak gauge", "OPEN,<mode>", "blocked"
"""
import threading

import serial
from serial.tools import list_ports


def available_ports():
    return [{"device": p.device, "description": p.description} for p in list_ports.comports()]


class SerialLink:
    def __init__(self, twin):
        self.twin = twin
        self._ser = None
        self._thread = None
        self._stop = threading.Event()
        self.error = None
        self.lines = 0
        self.headers = 0

    @property
    def connected(self):
        return self._ser is not None and self._ser.is_open

    def open(self, port, baud=115200):
        self.close()
        self.error = None
        self._ser = serial.Serial(port, baud, timeout=0.2)
        self.headers = 0
        self._stop.clear()
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()
        self.twin.set_source("serial", port)

    def close(self):
        self._stop.set()
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=1)
        if self._ser:
            try:
                self._ser.close()
            except serial.SerialException:
                pass
        self._ser = None
        if self.twin.source == "serial":
            self.twin.set_source("none")

    def write(self, data):
        if not self.connected:
            return False
        try:
            self._ser.write(data)
            return True
        except (serial.SerialException, OSError) as e:
            self.error = str(e)
            return False

    def _loop(self):
        while not self._stop.is_set():
            try:
                raw = self._ser.readline()
            except (serial.SerialException, OSError) as e:
                self.error = str(e)
                self.twin.set_source("none")
                self._ser = None
                return
            if not raw:
                continue
            line = raw.decode("ascii", "ignore").strip()
            if line:
                self.lines += 1
                self._parse(line)

    def _parse(self, line):
        if line.startswith("peak"):
            # header line: the board (re)booted; the first one follows the DTR reset on connect
            self.headers += 1
            self.twin.note_boot(self.headers - 1)
            self.write(self.twin.difficulty_code())   # a reset board starts on its own default
            self.write(self.twin.amp_code())
            return
        if line.startswith("mode"):
            # mode,<index>,<target>,<scratch_amp>
            parts = line.split(",")
            try:
                self.twin.note_mode(int(parts[1]), amp=int(parts[3]) if len(parts) > 3 else None)
            except (IndexError, ValueError):
                pass
            return
        if line.startswith("OPEN"):
            self.twin.hw_open_event()
            return
        if line == "blocked":
            self.twin.hw_beam_blocked()
            return

        sep = "," if "," in line else " "
        parts = line.split(sep)
        try:
            nums = [int(float(p)) for p in parts if p.strip()]
        except ValueError:
            return
        if not nums:
            return

        peak = nums[0]
        if len(nums) < 2:
            self.twin.feed(peak)
        elif sep == ",":
            # piezo_servo.ino: peak,servo[,gauge]
            self.twin.feed(peak, servo=nums[1], gauge=nums[2] if len(nums) > 2 else None)
        else:
            self.twin.feed(peak, gauge=nums[1])
