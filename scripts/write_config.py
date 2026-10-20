#!/usr/bin/env python3
"""Fill apps/js/config.js from environment variables at publish time.

The GitHub workflow passes repository secrets in, so the keys never live in git.
Set them once with:  gh secret set YT_API_KEY / YT_CLIENT_ID / YT_CLIENT_SECRET
"""
from __future__ import annotations

import json
import os
import re
from pathlib import Path

CONFIG = Path(__file__).resolve().parents[1] / "apps" / "js" / "config.js"
FIELDS = {"apiKey": "YT_API_KEY", "clientId": "YT_CLIENT_ID", "clientSecret": "YT_CLIENT_SECRET"}


def main() -> None:
    text = CONFIG.read_text(encoding="utf-8")
    for field, env in FIELDS.items():
        value = os.environ.get(env, "").strip()
        if not value:
            print("%s not set; %s stays empty" % (env, field))
            continue
        text, count = re.subn(r"(\b%s:\s*)\"[^\"]*\"" % field, lambda m: m.group(1) + json.dumps(value), text)
        if count != 1:
            raise SystemExit("Could not find %s in %s" % (field, CONFIG))
        print("%s set" % field)
    CONFIG.write_text(text, encoding="utf-8")


if __name__ == "__main__":
    main()
