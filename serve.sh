#!/bin/bash
# Test the apps on this Mac before publishing. The iPad uses the GitHub Pages
# copy and doesn't need this running.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
PORT="${PORT:-8080}"

python3 "$ROOT/scripts/make_icons.py"

cat <<EOF

Testing at http://localhost:${PORT}/youtube.html
Your API key must allow http://localhost:${PORT}/* for this (see README).
Press Ctrl+C to stop.

EOF

exec python3 "$ROOT/scripts/server.py" "$PORT"
