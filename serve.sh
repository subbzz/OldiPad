#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
PORT="${PORT:-8080}"
VENV="$ROOT/.venv"

# yt-dlp needs Python 3.10+; macOS's built-in python3 is 3.9.
pick_python() {
  local py
  for py in python3.13 python3.12 python3.11 python3.10 python3; do
    if command -v "$py" >/dev/null 2>&1 &&
      "$py" -c 'import sys; sys.exit(sys.version_info < (3, 10))' 2>/dev/null; then
      command -v "$py"
      return
    fi
  done
  echo "Python 3.10 or newer is required (brew install python@3.12)." >&2
  exit 1
}

if [ -x "$VENV/bin/python3" ] &&
  ! "$VENV/bin/python3" -c 'import sys; sys.exit(sys.version_info < (3, 10))' 2>/dev/null; then
  OLD="$VENV-py$("$VENV/bin/python3" -c 'import sys; print("%d%d" % sys.version_info[:2])')"
  echo "Moving old Python venv aside to $OLD"
  mv "$VENV" "$OLD"
fi
if [ ! -x "$VENV/bin/python3" ]; then
  "$(pick_python)" -m venv "$VENV"
fi
PY="$VENV/bin/python3"

# YouTube changes often; keep yt-dlp current (skipped quietly when offline).
"$PY" -m pip install --disable-pip-version-check -q -U -r "$ROOT/requirements.txt" ||
  echo "Could not update yt-dlp (offline?). Using the installed copy."
if ! command -v deno >/dev/null 2>&1 && ! command -v node >/dev/null 2>&1; then
  echo "Warning: install node (brew install node) or deno, or most YouTube videos will not play." >&2
fi

"$PY" "$ROOT/scripts/make_icons.py"

lan_ip() {
  local ip
  ip="$(ipconfig getifaddr en0 2>/dev/null || true)"
  if [ -z "$ip" ]; then
    ip="$(ipconfig getifaddr en1 2>/dev/null || true)"
  fi
  printf '%s' "${ip:-127.0.0.1}"
}

IP="$(lan_ip)"
HOST="$(scutil --get LocalHostName 2>/dev/null || echo MacBook-Pro)"
# The .local name survives the router handing the Mac a new IP address.
BASE="http://${HOST}.local:${PORT}"

"$PY" "$ROOT/scripts/make_profile.py" --base-url "$BASE"

cat <<EOF

Old iPad HTML5 server

On the iPad, open Safari and go to:
  ${BASE}/apps/youtube.html
  (or http://${IP}:${PORT}/apps/youtube.html)

Then Share → Add to Home Screen, and sign in from the Home Screen app.
Home Screen icons for every app at once: ${BASE}/profiles/home-screen.mobileconfig

Keep this Mac and the iPad on the same Wi-Fi. Press Ctrl+C to stop.

EOF

cd "$ROOT"
exec "$PY" "$ROOT/scripts/server.py" "$PORT"
