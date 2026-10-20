#!/usr/bin/env python3
"""Install the home-screen web-clip profile on a USB-connected iPad."""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PROFILE = ROOT / "apps" / "home-screen.mobileconfig"
VENV = ROOT / ".venv"


def run(cmd: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, cwd=str(ROOT), text=True, capture_output=True)


def ensure_venv() -> Path:
    py = VENV / "bin" / "python3"
    if not py.exists():
        created = run([sys.executable, "-m", "venv", str(VENV)])
        if created.returncode != 0:
            raise SystemExit(created.stderr or created.stdout or "venv failed")
    pip = VENV / "bin" / "pip"
    installed = run([str(pip), "install", "--disable-pip-version-check", "pymobiledevice3"])
    if installed.returncode != 0:
        raise SystemExit(installed.stderr or installed.stdout or "pip install failed")
    return VENV / "bin" / "pymobiledevice3"


def main() -> None:
    generated = run([sys.executable, str(ROOT / "scripts" / "make_profile.py"), *sys.argv[1:]])
    if generated.returncode != 0:
        raise SystemExit(generated.stderr or generated.stdout or "make_profile.py failed")
    print(generated.stdout)
    if not PROFILE.exists():
        raise SystemExit("Missing %s" % PROFILE)

    cli = ensure_venv()
    info = run([str(cli), "lockdown", "info"])
    if info.returncode != 0:
        sys.stderr.write(info.stderr or info.stdout or "")
        raise SystemExit(
            "Could not talk to the iPad over USB. Unlock it, tap Trust This Computer, and keep the cable plugged in."
        )
    print(info.stdout)

    installed = run([str(cli), "profile", "install", str(PROFILE)])
    sys.stdout.write(installed.stdout or "")
    sys.stderr.write(installed.stderr or "")
    if installed.returncode != 0:
        raise SystemExit(
            "The profile was not installed automatically. On the iPad open Settings — if you see Profile Downloaded, tap Install."
        )
    print("Installed. Unlock the iPad and look on the Home Screen for YouTube, WhatsApp, Gmail, Maps, ABC News, and BOM Weather.")
    print("If icons are missing, open Settings > General > Profiles (or Profile Downloaded) and tap Install.")


if __name__ == "__main__":
    main()
