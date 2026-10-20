#!/usr/bin/env python3
"""Write an unsigned iOS web-clip profile with the current LAN launcher URL."""
from __future__ import annotations

import argparse
import plistlib
import subprocess
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ICONS = ROOT / "apps" / "icons"
OUT = ROOT / "profiles" / "home-screen.mobileconfig"


def b64_png(name: str) -> bytes:
    return (ICONS / name).read_bytes()


def webclip(label: str, url: str, icon_name: str, ident: str) -> dict:
    return {
        "FullScreen": True,
        "Icon": b64_png(icon_name),
        "IsRemovable": True,
        "Label": label,
        "PayloadDescription": "Home screen web clip",
        "PayloadDisplayName": label,
        "PayloadIdentifier": ident,
        "PayloadType": "com.apple.webClip.managed",
        "PayloadUUID": str(uuid.uuid5(uuid.NAMESPACE_URL, ident)),
        "PayloadVersion": 1,
        "Precomposed": True,
        "URL": url,
    }


def default_base() -> str:
    """http://<this Mac>.local:8080, which keeps working when the Mac's IP changes."""
    try:
        host = subprocess.run(
            ["scutil", "--get", "LocalHostName"], text=True, capture_output=True, check=True
        ).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        host = "MacBook-Pro"
    return "http://%s.local:8080" % host


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="", help="http://HOST.local:PORT of serve.sh")
    args = parser.parse_args()
    base = (args.base_url or default_base()).rstrip("/")

    youtube_url = base + "/apps/youtube.html"
    clips = [
        webclip(
            "YouTube",
            youtube_url,
            "youtube.png",
            "com.oldipad.webclip.youtube",
        ),
        webclip(
            "WhatsApp",
            "https://web.whatsapp.com",
            "whatsapp.png",
            "com.oldipad.webclip.whatsapp",
        ),
        webclip(
            "Gmail",
            "https://mail.google.com",
            "gmail.png",
            "com.oldipad.webclip.gmail",
        ),
        webclip(
            "Maps",
            "https://maps.google.com",
            "maps.png",
            "com.oldipad.webclip.maps",
        ),
        webclip(
            "ABC News",
            "https://www.abc.net.au/news",
            "news.png",
            "com.oldipad.webclip.news",
        ),
        webclip(
            "BOM Weather",
            "https://www.bom.gov.au",
            "weather.png",
            "com.oldipad.webclip.weather",
        ),
    ]
    clips.insert(
        0,
        webclip(
            "Launcher",
            base + "/apps/",
            "launcher.png",
            "com.oldipad.webclip.launcher",
        ),
    )

    payload = {
        "PayloadContent": clips,
        "PayloadDisplayName": "Old iPad Apps",
        "PayloadDescription": "Home screen web apps for iOS 12.5.7",
        "PayloadIdentifier": "com.oldipad.webclips",
        "PayloadOrganization": "Old iPad",
        "PayloadRemovalDisallowed": False,
        "PayloadType": "Configuration",
        "PayloadUUID": str(uuid.uuid5(uuid.NAMESPACE_URL, "com.oldipad.webclips")),
        "PayloadVersion": 1,
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    # iOS expects XML plist; plistlib writes bytes icons as <data>
    xml = plistlib.dumps(payload, fmt=plistlib.FMT_XML)
    OUT.write_bytes(xml)
    print("Wrote", OUT, "launcher URL", base + "/apps/")


if __name__ == "__main__":
    main()
