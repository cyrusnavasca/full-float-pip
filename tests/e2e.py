#!/usr/bin/env python3
"""End-to-end check of the native PiP app against real YouTube.

Drives the built binary over the Chrome native-messaging protocol, reads the
FV_DEBUG page probes from stderr, and checks the three regressions:
  1. PiP starts where the tab was, and reports its position back on close
  2. the picture is visible without a resize
  3. no ads play
Usage: swift build -c release --package-path native-app && python3 tests/e2e.py
"""
import json, os, re, struct, subprocess, sys, threading, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BINARY = os.path.join(ROOT, "native-app/.build/release/FloatVideo")
# Long public video that serves pre-roll ads to logged-out sessions.
URL = "https://www.youtube.com/watch?v=qpLFWwo7tL0&t=1s"
START = 312.0
RUN_SECONDS = 16


def frame(msg):
    b = json.dumps(msg).encode()
    return struct.pack("<I", len(b)) + b


def read_messages(stream, out):
    while (head := stream.read(4)) and len(head) == 4:
        out.append(json.loads(stream.read(struct.unpack("<I", head)[0])))


def run():
    p = subprocess.Popen([BINARY, "--native-messaging"], stdin=subprocess.PIPE,
                         stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                         env={**os.environ, "FV_DEBUG": "1"})
    replies, log = [], []
    threading.Thread(target=read_messages, args=(p.stdout, replies), daemon=True).start()
    threading.Thread(target=lambda: log.extend(l.decode(errors="replace") for l in p.stderr),
                     daemon=True).start()
    p.stdin.write(frame({"action": "open", "url": URL, "videoSrc": "", "embedUrl": "",
                         "title": "e2e", "site": "youtube", "width": 640, "height": 360,
                         "currentTime": START}))
    p.stdin.flush()
    time.sleep(RUN_SECONDS - 4)
    p.stdin.write(frame({"action": "moveToCorner"}))
    p.stdin.flush()
    time.sleep(4)
    p.stdin.write(frame({"action": "close"}))
    p.stdin.flush()
    time.sleep(1.5)
    p.stdin.close()
    p.wait(timeout=10)
    probes = [json.loads(m.group(1)) for l in log if (m := re.search(r"(?<!UI)PROBE (\{.*\})", l))]
    ui = [json.loads(m.group(1)) for l in log if (m := re.search(r"UIPROBE (\{.*\})", l))]
    return probes, replies, log, (ui[-1] if ui else {})


def main():
    probes, replies, log, ui = run()
    if not probes:
        print("".join(log[-30:]))
        sys.exit("FAIL: no probes logged (page never loaded?)")
    content = [p for p in probes if not p["ad"]]
    closed = [r for r in replies if r.get("status") == "closed"]
    moved = next((r for r in replies if r.get("status") == "moved"), {})
    checks = {
        "picture visible at end (no resize needed)":
            probes[-1]["w"] > 0 and probes[-1]["h"] > 0,
        "starts at the tab's position":
            bool(content) and content[0]["ct"] >= START - 2,
        "close reports the PiP position":
            bool(closed) and closed[-1].get("currentTime", 0) >= START,
        "no ad played": not any(p["ad"] for p in probes),
        "ad slots stripped from player response": all(p["adSlots"] == 0 for p in probes),
        "corners show diagonal resize cursors":
            ui.get("cursors", {}).get("bottomLeft") == "resizeNESW"
            and ui.get("cursors", {}).get("bottomRight") == "resizeNWSE"
            and ui.get("cursors", {}).get("topLeft") == "resizeNWSE"
            and ui.get("cursors", {}).get("topRight") == "resizeNESW",
        "edges show straight resize cursors":
            ui.get("cursors", {}).get("right") == "resizeLeftRight",
        "title bar shows the grab cursor": ui.get("cursors", {}).get("titleBar") == "openHand",
        "progress bar shows the pointing cursor": ui.get("cursors", {}).get("progressBar") == "pointingHand",
        "video area leaves the cursor to the page": ui.get("cursors", {}).get("center") == "page",
        "hovering the progress bar shows that timestamp":
            ui.get("hoverLabel") not in (None, "", "0:00") and ui.get("hoverLabel") == ui.get("expectedLabel"),
        "move to corner puts the PiP at the bottom-left of the screen":
            bool(moved) and moved["x"] == moved["screenX"] + 24 and moved["y"] == moved["screenY"] + 24,
    }
    print("moved:", moved)
    print("probes:", [(p["w"], p["h"], round(p["ct"]), p["ad"], p["adSlots"]) for p in probes])
    print("closed:", closed)
    print("ui:", ui)
    for name, ok in checks.items():
        print(("PASS " if ok else "FAIL ") + name)
    sys.exit(0 if all(checks.values()) else 1)


if __name__ == "__main__":
    main()
