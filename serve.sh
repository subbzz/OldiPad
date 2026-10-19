#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
PORT="${PORT:-8080}"

python3 "$ROOT/scripts/make_icons.py"

lan_ip() {
  local ip
  ip="$(ipconfig getifaddr en0 2>/dev/null || true)"
  if [ -z "$ip" ]; then
    ip="$(ipconfig getifaddr en1 2>/dev/null || true)"
  fi
  if [ -z "$ip" ]; then
    ip="$(python3 - <<'PY'
import socket
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
try:
    s.connect(("8.8.8.8", 80))
    print(s.getsockname()[0])
except Exception:
    print("127.0.0.1")
finally:
    s.close()
PY
)"
  fi
  printf '%s' "$ip"
}

IP="$(lan_ip)"
BASE="http://${IP}:${PORT}"

python3 "$ROOT/scripts/make_profile.py" --base-url "$BASE"

cat <<EOF

Old iPad server

On the iPad, open Safari and go to:
  ${BASE}

Install home-screen icons:
  ${BASE}/profiles/home-screen.mobileconfig

Keep this Mac and the iPad on the same Wi-Fi. Press Ctrl+C to stop.

EOF

cd "$ROOT"
exec python3 - "$PORT" <<'PY'
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

PORT = int(sys.argv[1])


class Handler(SimpleHTTPRequestHandler):
    extensions_map = dict(SimpleHTTPRequestHandler.extensions_map)
    extensions_map[".mobileconfig"] = "application/x-apple-aspen-config"

    def end_headers(self):
        if self.path.endswith(".html") or self.path in ("/", "/apps/", "/apps"):
            self.send_header("Cache-Control", "no-cache")
        SimpleHTTPRequestHandler.end_headers(self)


httpd = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
print("Serving on port %s" % PORT, flush=True)
httpd.serve_forever()
PY
