#!/usr/bin/env python3
"""Fake package transaction; every write and control belongs to a private root."""
import json
import os
from pathlib import Path
import signal
import subprocess
import sys

root = Path(sys.argv[1]).resolve(strict=True)
mode = sys.argv[2]

def event(name, **details):
    record = json.dumps({"event": name, "pid": os.getpid(), **details}) + "\n"
    descriptor = os.open(root / "events.jsonl", os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o600)
    os.write(descriptor, record.encode())
    os.close(descriptor)

if mode == "worker":
    signal.signal(signal.SIGTERM, signal.SIG_IGN)
    control = os.open(root / "control", os.O_RDWR)
    cgroup = Path("/proc/self/cgroup").read_text() if sys.platform == "linux" else "unavailable-on-macos"
    event("child-ready", sid=os.getsid(0), pgid=os.getpgrp(), cgroup=cgroup)
    (root / "db" / "updates" / "0000").write_text("unpacked fake-package\n")
    event("unpack-start")
    os.write(int(sys.argv[3]), b"R")
    os.close(int(sys.argv[3]))
    command = os.read(control, 1)
    event("control-received", command=command.decode())
    if command == b"F":
        (root / "db" / "updates" / "0000").unlink()
        event("configured")
        sys.exit(0)
    sys.exit(100)

event("installer-start", apt_config=os.environ.get("APT_CONFIG"))
read_ready, write_ready = os.pipe()
child = subprocess.Popen([sys.executable, __file__, str(root), "worker", str(write_ready)],
                         start_new_session=True, pass_fds=(write_ready,))
os.close(write_ready)
if os.read(read_ready, 1) != b"R":
    sys.exit(70)
os.close(read_ready)
print("fixture unpack acknowledged", flush=True)
event("parent-ready", child=child.pid)
if mode == "early-exit":
    event("parent-exit")
    sys.exit(0)
status = child.wait()
event("parent-exit", status=status)
sys.exit(status if status >= 0 else 128 - status)
