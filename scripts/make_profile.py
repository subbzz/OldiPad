#!/usr/bin/env python3
"""Write an unsigned iOS web-clip profile pointing at the published apps."""
from __future__ import annotations

import argparse
import plistlib
import re
import subprocess
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ICONS = ROOT / "apps" / "icons"
OUT = ROOT / "apps" / "home-screen.mobileconfig"


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


def default_site() -> str:
    """The GitHub Pages address of this repo, e.g. https://subbzz.github.io/OldiPad."""
    try:
        remote = subprocess.run(
            ["git", "-C", str(ROOT), "remote", "get-url", "origin"], text=True, capture_output=True, check=True
        ).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        remote = ""
    match = re.search(r"github\.com[:/]([^/]+)/([^/]+?)(?:\.git)?$", remote)
    if not match:
        raise SystemExit("No GitHub remote found; pass --site-url https://USER.github.io/REPO")
    return "https://%s.github.io/%s" % (match.group(1).lower(), match.group(2))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--site-url", default="", help="where apps/ is published (default: this repo's GitHub Pages)")
    parser.add_argument("--out", default=str(OUT), help="profile file to write")
    args = parser.parse_args()
    site = (args.site_url or default_site()).rstrip("/")
    out = Path(args.out)

    youtube_url = site + "/youtube.html"
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
            site + "/",
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

    out.parent.mkdir(parents=True, exist_ok=True)
    # iOS expects XML plist; plistlib writes bytes icons as <data>
    xml = plistlib.dumps(payload, fmt=plistlib.FMT_XML)
    out.write_bytes(xml)
    print("Wrote", out, "for", site + "/")


if __name__ == "__main__":
    main()
