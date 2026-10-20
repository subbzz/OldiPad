#!/usr/bin/env python3
"""Serve apps/ the way GitHub Pages does, for testing on the Mac before publishing.

The iPad doesn't need this: it uses the GitHub Pages copy (see README).
"""
from __future__ import annotations

import hashlib
import sys
import urllib.parse
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

APPS = Path(__file__).resolve().parents[1] / "apps"


def appcache_manifest() -> bytes:
    """cache.appcache with a revision line from the cached files, as the deploy adds one."""
    text = (APPS / "cache.appcache").read_text(encoding="utf-8")
    digest = hashlib.sha1()
    for line in text.splitlines()[1:]:
        line = line.strip()
        if line.endswith(":"):
            break
        if line and not line.startswith("#") and (APPS / line).is_file():
            digest.update((APPS / line).read_bytes())
    lines = text.splitlines()
    lines.insert(1, "# rev " + digest.hexdigest()[:12])
    return ("\n".join(lines) + "\n").encode("utf-8")


class Handler(SimpleHTTPRequestHandler):
    extensions_map = dict(SimpleHTTPRequestHandler.extensions_map)
    extensions_map[".mobileconfig"] = "application/x-apple-aspen-config"
    extensions_map[".appcache"] = "text/cache-manifest"

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, directory=str(APPS), **kwargs)

    def end_headers(self) -> None:
        path = urllib.parse.urlparse(self.path).path
        if path.endswith((".html", ".js", ".css", ".appcache", "/")):
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def list_directory(self, path: Any) -> None:
        self.send_error(404)
        return None

    def do_GET(self) -> None:
        if urllib.parse.urlparse(self.path).path == "/cache.appcache":
            body = appcache_manifest()
            self.send_response(200)
            self.send_header("Content-Type", "text/cache-manifest")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()


def main() -> None:
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    httpd = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    print("Serving apps/ on http://localhost:%s/" % port, flush=True)
    httpd.serve_forever()


if __name__ == "__main__":
    main()
