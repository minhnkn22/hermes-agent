#!/usr/bin/env python3
"""Install or remove the per-user launchd service for the agent job supervisor."""

from __future__ import annotations

import argparse
import os
from pathlib import Path
import plistlib
import secrets
import socket
import subprocess
import sys
import time

from agent_job_policy import allowed_roots_value


LABEL = "com.atum.agent-job-supervisor"
PLIST_PATH = Path.home() / "Library" / "LaunchAgents" / f"{LABEL}.plist"
STATE_DIR = Path.home() / ".local" / "state" / "agent-job-supervisor"
SUPERVISOR = Path(__file__).resolve().with_name("agent_job_supervisor.py")
IMPLEMENT_TOKEN_PATH = STATE_DIR / "implement.token"


def _run(*args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(args, text=True, capture_output=True, check=check)


def install() -> None:
    PLIST_PATH.parent.mkdir(parents=True, exist_ok=True)
    STATE_DIR.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(STATE_DIR, 0o700)
    if not IMPLEMENT_TOKEN_PATH.is_file() or not IMPLEMENT_TOKEN_PATH.read_text(encoding="utf-8").strip():
        IMPLEMENT_TOKEN_PATH.write_text(secrets.token_urlsafe(48) + "\n", encoding="utf-8")
    os.chmod(IMPLEMENT_TOKEN_PATH, 0o600)
    for name in ("supervisor.stdout.log", "supervisor.stderr.log"):
        path = STATE_DIR / name
        if path.is_file() and path.stat().st_size > 1024 * 1024:
            rotated = path.with_suffix(path.suffix + ".1")
            if rotated.exists():
                rotated.unlink()
            path.replace(rotated)
    environment = {
        "HOME": str(Path.home()),
        "USER": Path.home().name,
        "LOGNAME": Path.home().name,
        "SHELL": os.environ.get("SHELL", "/bin/zsh"),
        "TMPDIR": os.environ.get("TMPDIR", "/tmp"),
        "__CF_USER_TEXT_ENCODING": os.environ.get("__CF_USER_TEXT_ENCODING", "0x1F5:0x0:0x0"),
        "LANG": os.environ.get("LANG", "en_US.UTF-8"),
        "PATH": "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
        "AGENT_JOB_STATE_DIR": str(STATE_DIR),
        "AGENT_JOB_ALLOW_IMPLEMENT": "1",
        "AGENT_JOB_IMPLEMENT_TOKEN_FILE": str(IMPLEMENT_TOKEN_PATH),
        "AGENT_JOB_ALLOWED_ROOTS": os.environ.get(
            "AGENT_JOB_ALLOWED_ROOTS", allowed_roots_value(),
        ),
        "AGENT_JOB_CLAUDE_BIN": os.environ.get("AGENT_JOB_CLAUDE_BIN", str(Path.home() / ".local/bin/claude")),
        "AGENT_JOB_KIMI_BIN": os.environ.get("AGENT_JOB_KIMI_BIN", str(Path.home() / ".kimi-code/bin/kimi")),
        "AGENT_JOB_CODEX_BIN": os.environ.get("AGENT_JOB_CODEX_BIN", "/opt/homebrew/bin/codex"),
    }
    if os.environ.get("AGENT_JOB_PROFILE_ENV"):
        environment["AGENT_JOB_PROFILE_ENV"] = os.environ["AGENT_JOB_PROFILE_ENV"]
    payload = {
        "Label": LABEL,
        "ProgramArguments": [sys.executable, str(SUPERVISOR), "serve"],
        "RunAtLoad": True,
        "KeepAlive": {"SuccessfulExit": False},
        "ThrottleInterval": 5,
        "ProcessType": "Background",
        "Umask": 0o077,
        "EnvironmentVariables": environment,
        "StandardOutPath": str(STATE_DIR / "supervisor.stdout.log"),
        "StandardErrorPath": str(STATE_DIR / "supervisor.stderr.log"),
    }
    with PLIST_PATH.open("wb") as handle:
        plistlib.dump(payload, handle, sort_keys=True)
    os.chmod(PLIST_PATH, 0o600)
    domain = f"gui/{os.getuid()}"
    _run("launchctl", "bootout", domain, str(PLIST_PATH), check=False)
    _run("launchctl", "bootstrap", domain, str(PLIST_PATH))
    _run("launchctl", "kickstart", "-k", f"{domain}/{LABEL}")
    socket_path = STATE_DIR / "supervisor.sock"
    for _ in range(100):
        try:
            with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
                client.settimeout(.2)
                client.connect(str(socket_path))
                client.sendall(b'{"action":"ping"}\n')
                if b'"ok":true' not in client.recv(4096):
                    raise OSError("supervisor ping failed")
            break
        except OSError:
            time.sleep(.05)
    else:
        raise RuntimeError(f"{LABEL} did not become ready at {socket_path}")
    print(f"Installed and started {LABEL}")


def uninstall() -> None:
    domain = f"gui/{os.getuid()}"
    _run("launchctl", "bootout", domain, str(PLIST_PATH), check=False)
    if PLIST_PATH.exists():
        PLIST_PATH.unlink()
    print(f"Removed {LABEL}; durable job history remains in {STATE_DIR}")


def status() -> int:
    result = _run("launchctl", "print", f"gui/{os.getuid()}/{LABEL}", check=False)
    output = result.stdout or result.stderr
    print(output.strip())
    return result.returncode


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("install", "uninstall", "status"))
    args = parser.parse_args()
    if args.action == "install":
        install()
        return 0
    if args.action == "uninstall":
        uninstall()
        return 0
    return status()


if __name__ == "__main__":
    raise SystemExit(main())
