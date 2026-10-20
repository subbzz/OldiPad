"""Google sign-in (OAuth device flow) and YouTube Data API calls, run on the Mac.

The iPad never sees Google tokens. It gets a random session key after sign-in,
and the server keeps the refresh token in config/google_token.json (mode 600).
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import secrets
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

from yt_backend import TTLCache

ROOT = Path(__file__).resolve().parents[1]
CONFIG = ROOT / "config"
CLIENT_FILE = CONFIG / "google_oauth.json"
TOKEN_FILE = CONFIG / "google_token.json"
SCOPE = "https://www.googleapis.com/auth/youtube"
API = "https://www.googleapis.com/youtube/v3/"
RSS = "https://www.youtube.com/feeds/videos.xml?channel_id="
NS = {
    "a": "http://www.w3.org/2005/Atom",
    "yt": "http://www.youtube.com/xml/schemas/2015",
    "media": "http://search.yahoo.com/mrss/",
}


class NotSignedIn(Exception):
    pass


class ApiError(Exception):
    def __init__(self, status: int, reason: str, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.reason = reason


def _post_form(url: str, fields: dict) -> tuple[int, dict]:
    body = urllib.parse.urlencode(fields).encode("ascii")
    req = urllib.request.Request(url, data=body, method="POST")
    req.add_header("Content-Type", "application/x-www-form-urlencoded")
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return resp.status, json.loads(resp.read() or b"{}")
    except urllib.error.HTTPError as exc:
        try:
            return exc.code, json.loads(exc.read() or b"{}")
        except ValueError:
            return exc.code, {}


def _hash(session: str) -> str:
    return hashlib.sha256(session.encode("utf-8")).hexdigest()


def _thumb(snippet: dict, *sizes: str) -> str:
    thumbs = snippet.get("thumbnails") or {}
    for size in sizes + ("high", "medium", "default"):
        if thumbs.get(size, {}).get("url"):
            return thumbs[size]["url"]
    return ""


def _duration(iso: str) -> int:
    total, num = 0, ""
    for ch in (iso or "").replace("PT", "").replace("P", ""):
        if ch.isdigit():
            num += ch
        elif num:
            total += int(num) * {"H": 3600, "M": 60, "S": 1, "D": 86400}.get(ch, 0)
            num = ""
    return total


class Account:
    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._flows: dict[str, dict] = {}
        self._cache = TTLCache(64)
        self._state = self._load()

    # ---- storage -------------------------------------------------------

    def _client(self) -> dict:
        try:
            data = json.loads(CLIENT_FILE.read_text())
        except (OSError, ValueError):
            return {}
        # Accept the JSON Google Cloud downloads ({"installed": {...}}) or a flat file.
        for value in data.values():
            if isinstance(value, dict) and value.get("client_id"):
                data = value
                break
        if data.get("client_id") and data.get("client_secret"):
            return {"client_id": data["client_id"], "client_secret": data["client_secret"]}
        return {}

    def _load(self) -> dict:
        try:
            return json.loads(TOKEN_FILE.read_text())
        except (OSError, ValueError):
            return {}

    def _save(self) -> None:
        CONFIG.mkdir(parents=True, exist_ok=True)
        tmp = TOKEN_FILE.with_suffix(".tmp")
        fd = os.open(str(tmp), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w") as fh:
            json.dump(self._state, fh)
        os.replace(tmp, TOKEN_FILE)

    def _clear(self) -> None:
        self._state = {}
        self._cache = TTLCache(64)
        try:
            TOKEN_FILE.unlink()
        except OSError:
            pass

    # ---- sign-in -------------------------------------------------------

    def configured(self) -> bool:
        return bool(self._client())

    def status(self, session: str) -> dict:
        signed_in = self.check(session)
        return {
            "configured": self.configured(),
            "signedIn": signed_in,
            "profile": self._state.get("profile") if signed_in else None,
        }

    def check(self, session: str) -> bool:
        if not session or not self._state.get("refresh_token"):
            return False
        wanted = _hash(session)
        return any(hmac.compare_digest(wanted, h) for h in self._state.get("sessions", []))

    def start(self) -> dict:
        client = self._client()
        if not client:
            raise ApiError(503, "notConfigured", "Google sign-in is not set up on the Mac yet.")
        status, data = _post_form(
            "https://oauth2.googleapis.com/device/code",
            {"client_id": client["client_id"], "scope": SCOPE},
        )
        if status != 200 or not data.get("device_code"):
            raise ApiError(502, data.get("error", "deviceCode"), data.get("error_description") or "Google refused the request.")
        flow = secrets.token_urlsafe(16)
        with self._lock:
            now = time.time()
            self._flows = {k: v for k, v in self._flows.items() if v["expires"] > now}
            self._flows[flow] = {
                "device_code": data["device_code"],
                "interval": int(data.get("interval") or 5),
                "expires": now + int(data.get("expires_in") or 900),
                "next": now,
            }
        return {
            "flow": flow,
            "code": data["user_code"],
            "url": data.get("verification_url") or data.get("verification_uri") or "https://www.google.com/device",
            "interval": int(data.get("interval") or 5),
            "expiresIn": int(data.get("expires_in") or 900),
        }

    def poll(self, flow_id: str) -> dict:
        with self._lock:
            flow = self._flows.get(flow_id)
        if not flow or flow["expires"] < time.time():
            return {"status": "expired"}
        if time.time() < flow["next"]:
            return {"status": "pending", "interval": flow["interval"]}
        client = self._client()
        status, data = _post_form(
            "https://oauth2.googleapis.com/token",
            {
                "client_id": client.get("client_id", ""),
                "client_secret": client.get("client_secret", ""),
                "device_code": flow["device_code"],
                "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
            },
        )
        error = data.get("error")
        if error in ("authorization_pending", "slow_down"):
            if error == "slow_down":
                flow["interval"] += 5
            flow["next"] = time.time() + flow["interval"]
            return {"status": "pending", "interval": flow["interval"]}
        with self._lock:
            self._flows.pop(flow_id, None)
        if error == "access_denied":
            return {"status": "denied"}
        if status != 200 or not data.get("access_token"):
            return {"status": "error", "message": data.get("error_description") or error or "Sign-in failed"}

        session = secrets.token_urlsafe(32)
        with self._lock:
            previous = self._state if self._state.get("refresh_token") else {}
            self._state = {
                "refresh_token": data.get("refresh_token") or previous.get("refresh_token", ""),
                "access_token": data["access_token"],
                "expires_at": time.time() + int(data.get("expires_in") or 3600) - 60,
                # Keep other devices signed in when the same account signs in again.
                "sessions": (previous.get("sessions", []) + [_hash(session)])[-10:],
                "profile": None,
            }
            self._cache = TTLCache(64)
            try:
                self._state["profile"] = self._profile()
            except Exception:
                self._state["profile"] = {"name": "You", "avatar": "", "channelId": ""}
            self._save()
        return {"status": "done", "session": session, "profile": self._state["profile"]}

    def sign_out(self) -> None:
        with self._lock:
            token = self._state.get("refresh_token")
            self._clear()
        if token:
            _post_form("https://oauth2.googleapis.com/revoke", {"token": token})

    def _access_token(self, force: bool = False) -> str:
        with self._lock:
            if not self._state.get("refresh_token"):
                raise NotSignedIn()
            if not force and self._state.get("access_token") and self._state.get("expires_at", 0) > time.time():
                return self._state["access_token"]
            client = self._client()
            status, data = _post_form(
                "https://oauth2.googleapis.com/token",
                {
                    "client_id": client.get("client_id", ""),
                    "client_secret": client.get("client_secret", ""),
                    "refresh_token": self._state["refresh_token"],
                    "grant_type": "refresh_token",
                },
            )
            if data.get("error") == "invalid_grant":
                self._clear()
                raise NotSignedIn()
            if status != 200 or not data.get("access_token"):
                raise ApiError(502, "refresh", data.get("error_description") or "Could not refresh Google sign-in")
            self._state["access_token"] = data["access_token"]
            self._state["expires_at"] = time.time() + int(data.get("expires_in") or 3600) - 60
            self._save()
            return data["access_token"]

    # ---- YouTube Data API ---------------------------------------------

    def _api(self, method: str, path: str, params: dict | None = None, body: Any = None, retry: bool = True) -> dict:
        url = API + path + ("?" + urllib.parse.urlencode(params) if params else "")
        data = json.dumps(body).encode("utf-8") if body is not None else None
        req = urllib.request.Request(url, data=data, method=method)
        req.add_header("Authorization", "Bearer " + self._access_token(force=not retry))
        if data is not None:
            req.add_header("Content-Type", "application/json")
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                raw = resp.read()
                return json.loads(raw) if raw else {}
        except urllib.error.HTTPError as exc:
            if exc.code == 401 and retry:
                return self._api(method, path, params, body, retry=False)
            try:
                err = json.loads(exc.read() or b"{}").get("error", {})
            except ValueError:
                err = {}
            reason = ((err.get("errors") or [{}])[0]).get("reason", "")
            raise ApiError(exc.code, reason, err.get("message") or str(exc)) from None

    def _profile(self) -> dict:
        data = self._api("GET", "channels", {"part": "snippet", "mine": "true"})
        items = data.get("items") or []
        if not items:
            return {"name": "You", "avatar": "", "channelId": ""}
        snip = items[0]["snippet"]
        return {"name": snip.get("title") or "You", "avatar": _thumb(snip, "default"), "channelId": items[0]["id"]}

    def subscriptions(self) -> list[dict]:
        def run() -> list[dict]:
            out, token = [], ""
            for _ in range(6):
                params = {"part": "snippet", "mine": "true", "maxResults": 50, "order": "relevance"}
                if token:
                    params["pageToken"] = token
                data = self._api("GET", "subscriptions", params)
                for item in data.get("items") or []:
                    snip = item["snippet"]
                    out.append(
                        {
                            "channelId": snip["resourceId"]["channelId"],
                            "title": snip.get("title") or "",
                            "avatar": _thumb(snip, "default"),
                        }
                    )
                token = data.get("nextPageToken") or ""
                if not token:
                    break
            return out

        return self._cache.get_or_compute("subs", 1800, run)

    def _channel_uploads(self, channel: dict) -> list[dict]:
        try:
            req = urllib.request.Request(RSS + channel["channelId"], headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=10) as resp:
                root = ET.fromstring(resp.read())
            out = []
            for entry in root.findall("a:entry", NS)[:8]:
                stats = entry.find("media:group/media:community/media:statistics", NS)
                link = entry.find("a:link", NS)
                out.append(
                    {
                        "id": entry.findtext("yt:videoId", "", NS),
                        "title": entry.findtext("a:title", "", NS),
                        "author": channel["title"],
                        "channelId": channel["channelId"],
                        "avatar": channel["avatar"],
                        "views": int(stats.get("views", 0)) if stats is not None else 0,
                        "published": entry.findtext("a:published", "", NS),
                        "short": link is not None and "/shorts/" in (link.get("href") or ""),
                        "duration": 0,
                    }
                )
            return out
        except Exception:
            pass
        # RSS unavailable: fall back to the channel's uploads playlist (1 quota unit).
        data = self._api(
            "GET",
            "playlistItems",
            {"part": "snippet", "playlistId": "UU" + channel["channelId"][2:], "maxResults": 8},
        )
        return [
            {
                "id": item["snippet"]["resourceId"].get("videoId", ""),
                "title": item["snippet"].get("title") or "",
                "author": channel["title"],
                "channelId": channel["channelId"],
                "avatar": channel["avatar"],
                "views": 0,
                "published": item["snippet"].get("publishedAt") or "",
                "short": False,
                "duration": 0,
            }
            for item in data.get("items") or []
        ]

    def feed(self) -> dict:
        def run() -> dict:
            subs = self.subscriptions()
            videos: list[dict] = []
            with ThreadPoolExecutor(max_workers=8) as pool:
                for chunk in pool.map(self._safe_uploads, subs[:80]):
                    videos.extend(chunk)
            videos = [v for v in videos if v["id"]]
            videos.sort(key=lambda v: v["published"], reverse=True)
            return {"channels": subs, "videos": videos[:80]}

        return self._cache.get_or_compute("feed", 600, run)

    def _safe_uploads(self, channel: dict) -> list[dict]:
        try:
            return self._channel_uploads(channel)
        except Exception:
            return []

    def _video_cards(self, items: list) -> list[dict]:
        out = []
        for item in items:
            snip = item.get("snippet") or {}
            if item.get("kind") == "youtube#video":
                vid = item.get("id") or ""
            else:
                vid = (item.get("contentDetails") or {}).get("videoId") or (snip.get("resourceId") or {}).get("videoId", "")
            if not vid or snip.get("title") in ("Private video", "Deleted video"):
                continue
            out.append(
                {
                    "id": vid,
                    "title": snip.get("title") or "Video",
                    "author": snip.get("videoOwnerChannelTitle") or snip.get("channelTitle") or "",
                    "channelId": snip.get("videoOwnerChannelId") or snip.get("channelId") or "",
                    "views": int((item.get("statistics") or {}).get("viewCount") or 0),
                    "duration": _duration((item.get("contentDetails") or {}).get("duration", "")),
                }
            )
        return out

    def liked(self) -> list[dict]:
        def run() -> list[dict]:
            data = self._api(
                "GET",
                "videos",
                {"part": "snippet,contentDetails,statistics", "myRating": "like", "maxResults": 50},
            )
            return self._video_cards(data.get("items") or [])

        return self._cache.get_or_compute("liked", 300, run)

    def playlists(self) -> list[dict]:
        def run() -> list[dict]:
            data = self._api("GET", "playlists", {"part": "snippet,contentDetails", "mine": "true", "maxResults": 50})
            return [
                {
                    "id": item["id"],
                    "title": item["snippet"].get("title") or "Playlist",
                    "count": int((item.get("contentDetails") or {}).get("itemCount") or 0),
                    "thumb": _thumb(item["snippet"], "medium"),
                }
                for item in data.get("items") or []
            ]

        return self._cache.get_or_compute("playlists", 300, run)

    def playlist_items(self, playlist_id: str) -> dict:
        data = self._api("GET", "playlistItems", {"part": "snippet,contentDetails", "playlistId": playlist_id, "maxResults": 50})
        title = ""
        for pl in self.playlists():
            if pl["id"] == playlist_id:
                title = pl["title"]
        return {"id": playlist_id, "title": title or "Playlist", "videos": self._video_cards(data.get("items") or [])}

    def video_state(self, video_id: str, channel_id: str) -> dict:
        rating = "none"
        if video_id:
            data = self._api("GET", "videos/getRating", {"id": video_id})
            if data.get("items"):
                rating = data["items"][0].get("rating") or "none"
        subscribed = False
        avatar = ""
        if channel_id:
            subscribed = bool(self._subscription_id(channel_id))
            avatar = self.channel_avatar(channel_id)
        return {"rating": rating, "subscribed": subscribed, "avatar": avatar}

    def channel_avatar(self, channel_id: str) -> str:
        def run() -> str:
            data = self._api("GET", "channels", {"part": "snippet", "id": channel_id})
            items = data.get("items") or []
            return _thumb(items[0]["snippet"], "default") if items else ""

        return self._cache.get_or_compute("avatar:" + channel_id, 86400, run) or ""

    def _subscription_id(self, channel_id: str) -> str:
        data = self._api("GET", "subscriptions", {"part": "id", "mine": "true", "forChannelId": channel_id})
        items = data.get("items") or []
        return items[0]["id"] if items else ""

    def rate(self, video_id: str, rating: str) -> None:
        self._api("POST", "videos/rate", {"id": video_id, "rating": rating})
        self._cache.drop("liked")

    def subscribe(self, channel_id: str, on: bool) -> None:
        if on:
            body = {"snippet": {"resourceId": {"kind": "youtube#channel", "channelId": channel_id}}}
            try:
                self._api("POST", "subscriptions", {"part": "snippet"}, body)
            except ApiError as exc:
                if exc.reason != "subscriptionDuplicate":
                    raise
        else:
            sub_id = self._subscription_id(channel_id)
            if sub_id:
                self._api("DELETE", "subscriptions", {"id": sub_id})
        self._cache.drop("subs")
        self._cache.drop("feed")

    def save(self, video_id: str, playlist_id: str) -> None:
        body = {"snippet": {"playlistId": playlist_id, "resourceId": {"kind": "youtube#video", "videoId": video_id}}}
        self._api("POST", "playlistItems", {"part": "snippet"}, body)
        self._cache.drop("playlists")

    def create_playlist(self, title: str) -> dict:
        body = {"snippet": {"title": title[:150]}, "status": {"privacyStatus": "private"}}
        data = self._api("POST", "playlists", {"part": "snippet,status"}, body)
        self._cache.drop("playlists")
        return {"id": data.get("id", ""), "title": title}

    def comments(self, video_id: str, page: str) -> dict:
        params = {
            "part": "snippet",
            "videoId": video_id,
            "maxResults": 20,
            "order": "relevance",
            "textFormat": "plainText",
        }
        if page:
            params["pageToken"] = page
        try:
            data = self._api("GET", "commentThreads", params)
        except ApiError as exc:
            if exc.reason == "commentsDisabled":
                return {"disabled": True, "comments": [], "next": ""}
            raise
        out = []
        for item in data.get("items") or []:
            top = item["snippet"]["topLevelComment"]["snippet"]
            out.append(
                {
                    "author": top.get("authorDisplayName") or "",
                    "avatar": top.get("authorProfileImageUrl") or "",
                    "text": top.get("textDisplay") or "",
                    "likes": int(top.get("likeCount") or 0),
                    "published": top.get("publishedAt") or "",
                    "replies": int(item["snippet"].get("totalReplyCount") or 0),
                }
            )
        return {"disabled": False, "comments": out, "next": data.get("nextPageToken") or ""}

    def add_comment(self, video_id: str, text: str) -> dict:
        body = {"snippet": {"videoId": video_id, "topLevelComment": {"snippet": {"textOriginal": text[:10000]}}}}
        data = self._api("POST", "commentThreads", {"part": "snippet"}, body)
        top = data["snippet"]["topLevelComment"]["snippet"]
        return {
            "author": top.get("authorDisplayName") or "",
            "avatar": top.get("authorProfileImageUrl") or "",
            "text": top.get("textDisplay") or text,
            "likes": 0,
            "published": top.get("publishedAt") or "",
            "replies": 0,
        }
