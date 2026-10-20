#!/usr/bin/env python3
"""Serve the HTML5 apps and the YouTube API they use (yt-dlp + Google sign-in) for iOS 12 Safari."""
from __future__ import annotations

import hashlib
import json
import sys
import urllib.error
import urllib.parse
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Callable

import yt_backend as yt
from google_account import Account, ApiError, NotSignedIn

ROOT = Path(__file__).resolve().parents[1]
APPS = ROOT / "apps"
PROFILE_PATH = "/profiles/home-screen.mobileconfig"
MAX_BODY = 64 * 1024
# Headers worth passing between Safari and googlevideo when proxying video bytes.
UPSTREAM_KEEP = ("Content-Type", "Content-Length", "Content-Range", "Last-Modified", "ETag")

account = Account()


class HttpError(Exception):
    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status


def _arg(qs: dict, name: str, limit: int = 200) -> str:
    return (qs.get(name) or [""])[0].strip()[:limit]


def _video_id(value: str) -> str:
    if not yt.VIDEO_ID.match(value or ""):
        raise HttpError(400, "bad video id")
    return value


def _channel_id(value: str) -> str:
    if not yt.CHANNEL_ID.match(value or ""):
        raise HttpError(400, "bad channel id")
    return value


def _playlist_id(value: str) -> str:
    if not yt.PLAYLIST_ID.match(value or ""):
        raise HttpError(400, "bad playlist id")
    return value


def appcache_manifest() -> bytes:
    """cache.appcache with a revision line derived from the cached files, so iPads update automatically."""
    text = (APPS / "cache.appcache").read_text(encoding="utf-8")
    digest = hashlib.sha1()
    section = "CACHE"
    for line in text.splitlines()[1:]:
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if line.endswith(":"):
            section = line[:-1]
            continue
        if section == "CACHE":
            try:
                digest.update((APPS / line).read_bytes())
            except OSError:
                pass
    lines = text.splitlines()
    lines.insert(1, "# rev " + digest.hexdigest()[:12])
    return ("\n".join(lines) + "\n").encode("utf-8")


class Handler(SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    extensions_map = dict(SimpleHTTPRequestHandler.extensions_map)
    extensions_map[".mobileconfig"] = "application/x-apple-aspen-config"
    extensions_map[".appcache"] = "text/cache-manifest"

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, directory=str(ROOT), **kwargs)

    # ---- static files --------------------------------------------------

    def end_headers(self) -> None:
        path = urllib.parse.urlparse(self.path).path
        if path.endswith((".html", ".js", ".css", ".appcache", "/")):
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def list_directory(self, path: Any) -> None:
        self.send_error(404)
        return None

    def _static_allowed(self, path: str) -> bool:
        return (path.startswith("/apps/") and ".." not in path) or path == PROFILE_PATH

    def _redirect(self, location: str) -> None:
        self.send_response(302)
        self.send_header("Location", location)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def _static(self, head: bool) -> None:
        path = urllib.parse.urlparse(self.path).path
        if path in ("/", "/apps", "/index.html"):
            self._redirect("/apps/")
            return
        if path == "/apps/cache.appcache":
            body = appcache_manifest()
            self.send_response(200)
            self.send_header("Content-Type", "text/cache-manifest")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            if not head:
                self.wfile.write(body)
            return
        if not self._static_allowed(path):
            self.send_error(404)
            return
        if head:
            super().do_HEAD()
        else:
            super().do_GET()

    # ---- dispatch ------------------------------------------------------

    def do_GET(self) -> None:
        self._dispatch("GET")

    def do_HEAD(self) -> None:
        self._dispatch("HEAD")

    def do_POST(self) -> None:
        self._dispatch("POST")

    def _dispatch(self, method: str) -> None:
        parsed = urllib.parse.urlparse(self.path)
        if not parsed.path.startswith("/api/"):
            if method == "POST":
                self.send_error(405)
            else:
                self._static(method == "HEAD")
            return
        qs = urllib.parse.parse_qs(parsed.query)
        if parsed.path == "/api/stream" and method in ("GET", "HEAD"):
            self._stream(qs, method == "HEAD")
            return
        if parsed.path == "/api/play" and method == "GET":
            self._play(qs)
            return
        routes = GET_ROUTES if method == "GET" else POST_ROUTES if method == "POST" else {}
        route = routes.get(parsed.path)
        if route is None:
            known = parsed.path in GET_ROUTES or parsed.path in POST_ROUTES
            self._json(405 if known else 404, {"error": "method not allowed" if known else "not found"})
            return
        needs_session, fn = route
        try:
            # Read the body first so a rejected POST doesn't leave bytes on the keep-alive connection.
            arg = self._body() if method == "POST" else qs
            session = self.headers.get("X-Session", "")
            if needs_session and not account.check(session):
                raise HttpError(401, "signed out")
            self._json(200, fn(arg, session))
        except HttpError as exc:
            self._json(exc.status, {"error": str(exc)})
        except NotSignedIn:
            self._json(401, {"error": "signed out"})
        except ApiError as exc:
            status = exc.status if 400 <= exc.status < 600 else 502
            self._json(status, {"error": str(exc), "reason": exc.reason})
        except Exception as exc:  # yt-dlp and network errors
            self._json(502, {"error": str(exc).replace("ERROR: ", "")[:300]})

    def _body(self) -> dict:
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        if length > MAX_BODY:
            self.close_connection = True
            raise HttpError(413, "too large")
        raw = self.rfile.read(length) if length else b"{}"
        try:
            data = json.loads(raw or b"{}")
        except ValueError:
            raise HttpError(400, "bad json") from None
        if not isinstance(data, dict):
            raise HttpError(400, "bad json")
        return data

    def _json(self, status: int, payload: Any) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    # ---- playback ------------------------------------------------------

    def _play(self, qs: dict) -> None:
        """One URL for <video src>: q=hd → HLS up to 1080p, sd → ~360p HLS, mp4 → the 360p MP4 proxy.

        Each level falls back to the next one that exists for this video.
        """
        quality = _arg(qs, "q") or "hd"
        try:
            video_id = _video_id(_arg(qs, "id"))
            streams = yt.hls(video_id) if quality in ("hd", "sd") else {}
            target = streams.get("master" if quality == "hd" else "sd", "")
            if not target and yt.video(video_id)["mp4"]:
                target = "/api/stream?id=" + video_id
            if not target and quality == "mp4":
                target = yt.hls(video_id).get("sd", "")
        except HttpError as exc:
            self._json(exc.status, {"error": str(exc)})
            return
        except Exception as exc:
            self._json(502, {"error": str(exc)[:300]})
            return
        if target:
            self._redirect(target)
        else:
            self._json(404, {"error": "no playable stream"})

    def _open_upstream(self, video_id: str, method: str) -> Any:
        for attempt in range(2):
            info = yt.video(video_id, fresh=attempt > 0)
            if not info["mp4"]:
                raise HttpError(404, "no mp4 stream")
            req = urllib.request.Request(info["mp4"], method=method)
            for name, value in info["headers"].items():
                if name.lower() not in ("sec-fetch-mode", "accept"):
                    req.add_header(name, value)
            if self.headers.get("Range"):
                req.add_header("Range", self.headers["Range"])
            try:
                return urllib.request.urlopen(req, timeout=30)
            except urllib.error.HTTPError as exc:
                # Signed URL went stale or was refused: look the video up again once.
                if exc.code in (403, 410) and attempt == 0:
                    continue
                raise HttpError(exc.code, "upstream %s" % exc.code) from None
        raise HttpError(502, "upstream refused")

    def _stream(self, qs: dict, head: bool) -> None:
        try:
            video_id = _video_id(_arg(qs, "id"))
            upstream = self._open_upstream(video_id, "HEAD" if head else "GET")
        except HttpError as exc:
            self._json(exc.status, {"error": str(exc)})
            return
        except Exception as exc:
            self._json(502, {"error": str(exc)[:300]})
            return
        with upstream:
            self.send_response(upstream.status)
            for name in UPSTREAM_KEEP:
                if upstream.headers.get(name):
                    self.send_header(name, upstream.headers[name])
            self.send_header("Accept-Ranges", "bytes")
            if not upstream.headers.get("Content-Length"):
                self.close_connection = True
            self.end_headers()
            if head:
                return
            try:
                while True:
                    chunk = upstream.read(64 * 1024)
                    if not chunk:
                        break
                    self.wfile.write(chunk)
            except (BrokenPipeError, ConnectionResetError):
                # Safari cancels range requests all the time while seeking.
                self.close_connection = True


# ---- API routes: fn(args, session) -> JSON ------------------------------


def api_search(qs: dict, _s: str) -> dict:
    q = _arg(qs, "q", 120)
    if not q:
        raise HttpError(400, "missing q")
    return {"results": yt.search(q)}


def api_suggest(qs: dict, _s: str) -> dict:
    try:
        return {"suggestions": yt.suggest(_arg(qs, "q", 100))}
    except Exception:
        return {"suggestions": []}


def api_video(qs: dict, _s: str) -> dict:
    return yt.public_info(yt.video(_video_id(_arg(qs, "id"))))


def api_prefetch(qs: dict, _s: str) -> dict:
    yt.prefetch(_video_id(_arg(qs, "id")), _arg(qs, "q") != "sd")
    return {"ok": True}


def api_related(qs: dict, _s: str) -> dict:
    video_id = _video_id(_arg(qs, "id"))
    q = _arg(qs, "q", 120)
    if not q:
        q = yt.public_info(yt.video(video_id))["title"]
    q = q.split("|")[0].strip()[:60] or q[:60]
    return {"results": [v for v in yt.search(q) if v["id"] != video_id]}


def api_channel(qs: dict, _s: str) -> dict:
    return yt.channel(_channel_id(_arg(qs, "id")))


def api_playlist(qs: dict, session: str) -> dict:
    playlist_id = _playlist_id(_arg(qs, "id", 64))
    if account.check(session):
        try:
            return account.playlist_items(playlist_id)
        except ApiError:
            pass
    return yt.playlist(playlist_id)


def api_shorts(qs: dict, session: str) -> dict:
    out: list[dict] = []
    if account.check(session):
        try:
            for channel in account.subscriptions()[:6]:
                try:
                    out.extend(yt.channel_shorts(channel["channelId"]))
                except Exception:
                    continue
        except (ApiError, NotSignedIn):
            pass
    seen = {v["id"] for v in out}
    out.extend(v for v in yt.shorts(_arg(qs, "topic", 40)) if v["id"] not in seen)
    return {"results": out}


def auth_status(_qs: dict, session: str) -> dict:
    return account.status(session)


def auth_start(_body: dict, _s: str) -> dict:
    return account.start()


def auth_poll(body: dict, _s: str) -> dict:
    return account.poll(str(body.get("flow") or ""))


def auth_signout(_body: dict, _s: str) -> dict:
    account.sign_out()
    return {"ok": True}


def me_feed(_qs: dict, _s: str) -> dict:
    return account.feed()


def me_subscriptions(_qs: dict, _s: str) -> dict:
    return {"channels": account.subscriptions()}


def me_liked(_qs: dict, _s: str) -> dict:
    return {"results": account.liked()}


def me_playlists(_qs: dict, _s: str) -> dict:
    return {"playlists": account.playlists()}


def me_state(qs: dict, _s: str) -> dict:
    video_id, channel = _arg(qs, "id"), _arg(qs, "channel", 40)
    if not video_id and not channel:
        raise HttpError(400, "missing id or channel")
    return account.video_state(_video_id(video_id) if video_id else "", _channel_id(channel) if channel else "")


def me_comments(qs: dict, _s: str) -> dict:
    return account.comments(_video_id(_arg(qs, "id")), _arg(qs, "page", 200))


def me_rate(body: dict, _s: str) -> dict:
    rating = str(body.get("rating") or "")
    if rating not in ("like", "dislike", "none"):
        raise HttpError(400, "bad rating")
    account.rate(_video_id(str(body.get("id") or "")), rating)
    return {"ok": True}


def me_subscribe(body: dict, _s: str) -> dict:
    account.subscribe(_channel_id(str(body.get("channelId") or "")), bool(body.get("on")))
    return {"ok": True}


def me_save(body: dict, _s: str) -> dict:
    account.save(_video_id(str(body.get("id") or "")), _playlist_id(str(body.get("playlistId") or "")))
    return {"ok": True}


def me_new_playlist(body: dict, _s: str) -> dict:
    title = str(body.get("title") or "").strip()
    if not title:
        raise HttpError(400, "missing title")
    return account.create_playlist(title)


def me_comment(body: dict, _s: str) -> dict:
    text = str(body.get("text") or "").strip()
    if not text:
        raise HttpError(400, "missing text")
    return account.add_comment(_video_id(str(body.get("id") or "")), text)


Route = tuple[bool, Callable[[Any, str], Any]]
GET_ROUTES: dict[str, Route] = {
    "/api/search": (False, api_search),
    "/api/suggest": (False, api_suggest),
    "/api/video": (False, api_video),
    "/api/prefetch": (False, api_prefetch),
    "/api/related": (False, api_related),
    "/api/channel": (False, api_channel),
    "/api/playlist": (False, api_playlist),
    "/api/shorts": (False, api_shorts),
    "/api/auth/status": (False, auth_status),
    "/api/me/feed": (True, me_feed),
    "/api/me/subscriptions": (True, me_subscriptions),
    "/api/me/liked": (True, me_liked),
    "/api/me/playlists": (True, me_playlists),
    "/api/me/state": (True, me_state),
    "/api/me/comments": (True, me_comments),
}
# POST bodies are JSON and account routes need the X-Session header. Browsers
# cannot send that header cross-site without CORS, which this server never grants.
POST_ROUTES: dict[str, Route] = {
    "/api/auth/start": (False, auth_start),
    "/api/auth/poll": (False, auth_poll),
    "/api/auth/signout": (True, auth_signout),
    "/api/me/rate": (True, me_rate),
    "/api/me/subscribe": (True, me_subscribe),
    "/api/me/save": (True, me_save),
    "/api/me/playlist": (True, me_new_playlist),
    "/api/me/comment": (True, me_comment),
}


def main() -> None:
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    httpd = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    httpd.daemon_threads = True
    print("Serving HTML5 apps on port %s" % port, flush=True)
    if not account.configured():
        print("Google sign-in is off: see README (config/google_oauth.json).", flush=True)
    httpd.serve_forever()


if __name__ == "__main__":
    main()
