#!/usr/bin/env python3
"""Copy HTML5 app files onto the iPad Media/Downloads folder over USB."""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VENV_CLI = ROOT / ".venv" / "bin" / "pymobiledevice3"
REMOTE = "Downloads"


def run(args: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run(args, cwd=str(ROOT), text=True, capture_output=True)


def pmd(*args: str) -> subprocess.CompletedProcess:
    return run([str(VENV_CLI), "afc", *args])


def main() -> None:
    if not VENV_CLI.exists():
        raise SystemExit("Missing %s" % VENV_CLI)
    # Only the self-contained pages work when opened from Files; YouTube needs serve.sh.
    files = [
        ROOT / "standalone" / "YouTube.html",
        ROOT / "standalone" / "WhatsApp.html",
        ROOT / "standalone" / "Launcher.html",
    ]
    for path in files:
        if not path.exists():
            raise SystemExit("Missing %s (run scripts/pack_standalone.py first)" % path)
    listed = pmd("ls", "Downloads")
    if listed.returncode != 0:
        sys.stderr.write(listed.stderr or listed.stdout)
        raise SystemExit("Could not reach the iPad over USB. Unlock it and tap Trust.")
    for path in files:
        remote = REMOTE + "/" + path.name
        pushed = pmd("push", str(path), remote)
        if pushed.returncode != 0:
            sys.stderr.write(pushed.stderr or pushed.stdout)
            raise SystemExit("Failed to copy %s" % path.name)
        print("Copied", path.name, "->", remote)
    print("HTML5 files are on the iPad in Downloads")


if __name__ == "__main__":
    main()
