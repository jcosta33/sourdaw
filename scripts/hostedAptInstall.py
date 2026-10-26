#!/usr/bin/env python3
"""Run one hosted root package install until its entire systemd cgroup drains."""

import os
from pathlib import Path
import re
import shlex
import signal
import subprocess
import sys
import time
import uuid


PROPERTIES = (
    "Id", "Description", "InvocationID", "LoadState", "ActiveState", "SubState",
    "Result", "ExecMainCode", "ExecMainStatus", "ControlGroup", "Type",
    "ExitType", "RemainAfterExit", "CollectMode", "KillMode", "RuntimeMaxUSec",
)
POLL_SECONDS = 0.05
STOP_GRACE_SECONDS = 15
cancelled = 0


def on_signal(signum, _frame):
    global cancelled
    cancelled = signum


for received_signal in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
    signal.signal(received_signal, on_signal)


class Unproven(Exception):
    pass


def command(*args, timeout=15, env=None):
    return subprocess.run(args, text=True, capture_output=True, timeout=timeout, env=env, check=False)


def manager(*args):
    result = command("systemctl", *args)
    if result.returncode:
        raise Unproven(f"systemctl {' '.join(args[:2])} failed: {result.stderr.strip()}")
    return result.stdout


def observe(unit, description, invocation=None):
    output = manager("show", unit, "--no-pager", "--property=" + ",".join(PROPERTIES))
    fields = dict(line.split("=", 1) for line in output.splitlines() if "=" in line)
    if fields.get("Id") != unit or fields.get("Description") != description:
        raise Unproven("owned unit identity changed or disappeared")
    current = fields.get("InvocationID", "")
    if not re.fullmatch(r"[a-fA-F0-9]{32}", current) or (invocation and current != invocation):
        raise Unproven("owned unit invocation changed or disappeared")
    expected = {
        "LoadState": "loaded", "Type": "exec", "ExitType": "cgroup",
        "RemainAfterExit": "yes", "CollectMode": "inactive", "KillMode": "control-group",
    }
    if any(fields.get(key) != value for key, value in expected.items()):
        raise Unproven("owned unit lost required lifetime properties")
    if fields.get("RuntimeMaxUSec") in (None, "", "infinity"):
        raise Unproven("owned unit lost its manager deadline")
    return fields


def drained(fields, unit):
    group = fields.get("ControlGroup")
    if group == "":
        return "empty-ControlGroup"
    if group != f"/system.slice/{unit}":
        raise Unproven("owned unit reported an unexpected cgroup")
    events = Path("/sys/fs/cgroup") / group.lstrip("/") / "cgroup.events"
    try:
        values = dict(line.split(" ", 1) for line in events.read_text().splitlines())
    except (OSError, ValueError) as error:
        raise Unproven(f"owned cgroup status unavailable: {error}") from error
    if values.get("populated") == "0":
        return "populated=0"
    if values.get("populated") == "1":
        return None
    raise Unproven("owned cgroup populated status unknown")


def package_state(status_file, environment):
    status = Path(status_file)
    if not status.is_absolute() or status.name != "status" or not status.is_file():
        return "unknown"
    try:
        with status.open("rb"):
            pass
        pending = any(name.name.isdigit() for name in (status.parent / "updates").iterdir())
    except OSError:
        return "unknown"
    try:
        audit = command("dpkg", f"--admindir={status.parent}", "--audit", env=environment)
    except (OSError, subprocess.TimeoutExpired):
        return "unknown"
    if audit.returncode or audit.stderr.strip():
        return "unknown"
    return "dirty" if pending or audit.stdout.strip() else "clean"


def version_ok():
    try:
        result = command("systemctl", "--version")
        version = re.search(r"^systemd (\d+)\b", result.stdout)
        return result.returncode == 0 and version is not None and int(version.group(1)) >= 255
    except (OSError, subprocess.TimeoutExpired):
        return False


def report_log(path):
    try:
        output = path.read_text()
    except OSError as error:
        raise Unproven(f"installer output unavailable: {error}") from error
    if output:
        sys.stderr.write(output)


def run(deadline, work, status_file, payload):
    if not re.fullmatch(r"[1-9][0-9]*[smh]", deadline):
        raise Unproven("invalid hosted deadline")
    if not payload:
        raise Unproven("missing installer command")

    environment = {key: os.environ[key] for key in ("PATH", "APT_CONFIG", "DEBIAN_FRONTEND") if key in os.environ}
    environment.setdefault("PATH", "/usr/sbin:/usr/bin:/sbin:/bin")
    environment.setdefault("DEBIAN_FRONTEND", "noninteractive")
    before = package_state(status_file, environment)
    print(f"aptWithoutMicrosoftFeed: phase=before package-state={before}", file=sys.stderr, flush=True)
    if before == "unknown":
        (work / "retain").touch(mode=0o600)
    if before != "clean":
        return 2
    if os.geteuid() != 0 or sys.platform != "linux" or not Path("/sys/fs/cgroup/cgroup.controllers").is_file():
        raise Unproven("hosted mode requires root Linux with cgroup v2")
    if not version_ok():
        raise Unproven("hosted mode requires systemd 255 or newer")

    unit = f"sourdaw-apt-{uuid.uuid4()}.service"
    description = f"Sourdaw hosted apt {unit}"
    print(f"aptWithoutMicrosoftFeed: controller-pid={os.getpid()}", file=sys.stderr, flush=True)
    print(f"aptWithoutMicrosoftFeed: command={shlex.join(payload)}", file=sys.stderr, flush=True)
    log = work / "installer.log"
    log.touch(mode=0o600)
    args = [
        "systemd-run", "--quiet", f"--unit={unit}", f"--description={description}",
        "--expand-environment=no", f"--working-directory={os.getcwd()}",
        "--property=Type=exec", "--property=ExitType=cgroup",
        "--property=RemainAfterExit=yes", "--property=CollectMode=inactive",
        "--property=KillMode=control-group", "--property=SendSIGKILL=yes",
        "--property=TimeoutStopSec=15s", f"--property=RuntimeMaxSec={deadline}",
        "--property=Restart=no", f"--property=StandardOutput=append:{log}",
        f"--property=StandardError=append:{log}",
        *(f"--setenv={key}={value}" for key, value in environment.items()),
        "--", "/usr/bin/env", "--", *payload,
    ]
    started_at = time.monotonic()
    started = command(*args, timeout=30, env=environment)
    if started.returncode:
        raise Unproven(f"systemd-run refused the owned unit: {started.stderr.strip()}")

    invocation = None
    term_sent_at = None
    kill_sent = False
    deadline_seconds = int(deadline[:-1]) * {"s": 1, "m": 60, "h": 3600}[deadline[-1]]
    observation_limit = started_at + deadline_seconds + STOP_GRACE_SECONDS + 30
    while True:
        if time.monotonic() >= observation_limit:
            raise Unproven("owned unit did not reach a drained terminal state by its bounded observation limit")
        fields = observe(unit, description, invocation)
        invocation = fields["InvocationID"]
        if cancelled and term_sent_at is None:
            observe(unit, description, invocation)
            manager("kill", "--kill-whom=all", "--signal=TERM", unit)
            term_sent_at = time.monotonic()
        witness = drained(fields, unit)
        terminal = fields.get("ActiveState") == "failed" or (
            fields.get("ActiveState") == "active" and fields.get("SubState") == "exited"
        )
        if terminal and witness:
            break
        if term_sent_at is not None and not kill_sent and time.monotonic() - term_sent_at >= STOP_GRACE_SECONDS:
            observe(unit, description, invocation)
            manager("kill", "--kill-whom=all", "--signal=KILL", unit)
            kill_sent = True
        time.sleep(POLL_SECONDS)

    report_log(log)
    result = fields.get("Result", "")
    code = fields.get("ExecMainCode", "")
    main_status = fields.get("ExecMainStatus", "")
    print(
        f"aptWithoutMicrosoftFeed: unit={unit} invocation={invocation} result={result} "
        f"main={code}/{main_status} containment=drained witness={witness}",
        file=sys.stderr, flush=True,
    )
    after = package_state(status_file, environment)
    print(f"aptWithoutMicrosoftFeed: phase=after package-state={after}", file=sys.stderr, flush=True)
    if after == "unknown":
        (work / "retain").touch(mode=0o600)
    observe(unit, description, invocation)
    try:
        if fields["ActiveState"] == "failed":
            manager("reset-failed", unit)
        else:
            manager("stop", unit)
    except Unproven as error:
        (work / "retain").touch(mode=0o600)
        print(f"aptWithoutMicrosoftFeed: unit cleanup failed after drain: {error}", file=sys.stderr)
    if cancelled:
        return 128 + cancelled
    if result == "timeout":
        return 124
    if code != "1" or not main_status.isdecimal() or result not in ("success", "exit-code"):
        return 2
    payload_status = int(main_status)
    if payload_status:
        return payload_status
    return 0 if after == "clean" and result == "success" else 2


def main():
    if len(sys.argv) < 6 or sys.argv[4] != "--":
        print("aptWithoutMicrosoftFeed: invalid hosted invocation", file=sys.stderr)
        return 2
    deadline, directory, status_file = sys.argv[1:4]
    work = Path(directory)
    try:
        return run(deadline, work, status_file, sys.argv[5:])
    except (OSError, subprocess.TimeoutExpired, Unproven) as error:
        (work / "retain").touch(mode=0o600)
        print(f"aptWithoutMicrosoftFeed: containment=unknown: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
