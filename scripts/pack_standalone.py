#!/usr/bin/env python3
"""Build self-contained Launcher/WhatsApp files (inlined CSS and icons) for AirDrop / Files.

YouTube needs serve.sh running on the Mac, so the standalone YouTube.html only
links to the server copy.
"""
from __future__ import annotations

import argparse
import base64
import shutil
from pathlib import Path

from make_profile import default_base

ROOT = Path(__file__).resolve().parents[1]
APPS = ROOT / "apps"
OUT = ROOT / "standalone"
DESKTOP = Path.home() / "Desktop" / "Old iPad HTML5"

YOUTUBE_LINK = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>YouTube</title>
  <style>body{font-family:-apple-system,Helvetica,sans-serif;padding:24px;line-height:1.4}a{color:#065fd4}</style>
</head>
<body>
  <h1>YouTube</h1>
  <p>YouTube runs from the Mac. Start <code>./serve.sh</code> on the Mac, then open:</p>
  <p><a href="%(url)s">%(url)s</a></p>
  <p>Add that page to the Home Screen from Safari.</p>
</body>
</html>
"""


def data_uri(path: Path) -> str:
    return "data:image/png;base64," + base64.b64encode(path.read_bytes()).decode("ascii")


def inline_page(name: str, links: dict[str, str]) -> str:
    html = (APPS / name).read_text(encoding="utf-8")
    html = html.replace(' manifest="cache.appcache"', "")
    tag = '<link rel="stylesheet" href="css/app.css">'
    css = (APPS / "css" / "app.css").read_text(encoding="utf-8")
    html = html.replace(tag, "<style>\n" + css + "\n</style>")
    for old, new in links.items():
        html = html.replace('href="%s"' % old, 'href="%s"' % new)
    for png in (APPS / "icons").glob("*.png"):
        html = html.replace("icons/" + png.name, data_uri(png))
    return html


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="", help="http://HOST.local:PORT of serve.sh")
    base = (parser.parse_args().base_url or default_base()).rstrip("/")
    youtube = base + "/apps/youtube.html"

    OUT.mkdir(parents=True, exist_ok=True)
    files = {
        "Launcher.html": inline_page("index.html", {"youtube.html": youtube, "whatsapp.html": "WhatsApp.html"}),
        "WhatsApp.html": inline_page("whatsapp.html", {"index.html": "Launcher.html"}),
        "YouTube.html": YOUTUBE_LINK % {"url": youtube},
    }
    for name, html in files.items():
        (OUT / name).write_text(html, encoding="utf-8")
    print("Wrote", OUT)

    try:
        DESKTOP.mkdir(parents=True, exist_ok=True)
        for name in files:
            shutil.copy2(OUT / name, DESKTOP / name)
        print("Copied to", DESKTOP)
    except OSError as exc:
        print("Desktop copy skipped:", exc)


if __name__ == "__main__":
    main()
