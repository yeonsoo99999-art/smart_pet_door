import argparse
import json
import os
import time

from flask import Flask, Response, jsonify, render_template, request

from serial_link import SerialLink, available_ports
from twin import Twin

BASE = os.path.dirname(os.path.abspath(__file__))
LOG_PATH = os.path.join(BASE, "data", "requests.csv")
os.makedirs(os.path.dirname(LOG_PATH), exist_ok=True)

app = Flask(__name__)
twin = Twin(log_path=LOG_PATH)
link = SerialLink(twin)


@app.route("/")
def index():
    return render_template("index.html")


@app.get("/api/state")
def state():
    return jsonify(twin.snapshot())


@app.get("/api/stream")
def stream():
    def gen():
        while True:
            yield f"data: {json.dumps(twin.snapshot())}\n\n"
            time.sleep(0.05)
    return Response(gen(), mimetype="text/event-stream",
                    headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.get("/api/history")
def history():
    return jsonify(twin.recent_history())


@app.get("/api/events")
def events():
    return jsonify(twin.recent_events())


@app.delete("/api/events")
def clear_events():
    twin.reset_count()
    return jsonify(ok=True)


@app.get("/api/ports")
def ports():
    return jsonify(ports=available_ports(), connected=link.connected,
                   port=twin.port if link.connected else None, error=link.error)


@app.post("/api/connect")
def connect():
    body = request.get_json(silent=True) or {}
    port = body.get("port")
    if not port:
        return jsonify(ok=False, error="port required"), 400
    try:
        link.open(port, int(body.get("baud", 115200)))
    except Exception as e:  # pyserial raises several types here
        return jsonify(ok=False, error=str(e)), 400
    return jsonify(ok=True, port=port)


@app.post("/api/disconnect")
def disconnect():
    link.close()
    return jsonify(ok=True)


@app.post("/api/sim")
def sim():
    body = request.get_json(silent=True) or {}
    if link.connected:
        return jsonify(ok=False, error="serial active"), 409
    if body.get("enable", True):
        twin.set_source("sim")
    else:
        twin.set_source("none")
    return jsonify(ok=True)


@app.post("/api/test_open")
def test_open():
    if link.connected:
        ok = link.write(b"o")
        return jsonify(ok=ok, error=link.error if not ok else None), (200 if ok else 500)
    if twin.source == "sim":
        twin.force_open()
        return jsonify(ok=True)
    return jsonify(ok=False, error="not connected"), 409


@app.post("/api/scratch")
def scratch():
    body = request.get_json(silent=True) or {}
    if twin.source != "sim":
        return jsonify(ok=False, error="sim mode off"), 409
    peak = max(0, min(1023, int(body.get("peak", 0))))
    twin.feed(peak)
    return jsonify(ok=True)


@app.post("/api/settings")
def settings():
    body = request.get_json(silent=True) or {}
    twin.update_settings(body)
    # The board runs the same leaky integrator, so keep its mode and threshold in step.
    if link.connected:
        if "difficulty" in body:
            link.write(twin.difficulty_code())
        if "scratch_amp" in body:
            link.write(twin.amp_code())
    return jsonify(twin.snapshot())


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--port", help="serial port to open at start (e.g. COM3)")
    p.add_argument("--baud", type=int, default=115200)
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--http", type=int, default=5000)
    args = p.parse_args()

    if args.port:
        try:
            link.open(args.port, args.baud)
        except Exception as e:
            print(f"serial: {e}")

    app.run(host=args.host, port=args.http, threaded=True, debug=False)


if __name__ == "__main__":
    main()
