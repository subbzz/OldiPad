"""yt-dlp lookups (search, channels, playlists, Shorts, playback) with caching."""
from __future__ import annotations

import json
import re
import threading
import time
import urllib.parse
import urllib.request
from typing import Any, Callable

import yt_dlp

VIDEO_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")
CHANNEL_ID = re.compile(r"^UC[A-Za-z0-9_-]{22}$")
PLAYLIST_ID = re.compile(r"^[A-Za-z0-9_-]{2,64}$")

# Which yt-dlp player clients to try, in order. YouTube changes these often
# (October 2026: tv_simply's 360p MP4 downloads from the Mac, web_safari is the
# one that exposes HLS up to 1080p, which iOS Safari plays natively).
MP4_CLIENTS = [["tv_simply"], ["default"], ["android_vr"]]
HLS_CLIENTS = [["web_safari"], ["ios"]]
IPAD_UA = (
    "Mozilla/5.0 (iPad; CPU OS 12_5_7 like Mac OS X) AppleWebKit/605.1.15 "
    "(KHTML, like Gecko) Version/12.1.2 Mobile/15E148 Safari/604.1"
)


class TTLCache:
    """Small thread-safe cache; get_or_compute runs fn once per key even under concurrent requests."""

    def __init__(self, max_items: int = 256) -> None:
        self._data: dict[str, tuple[float, Any]] = {}
        self._locks: dict[str, threading.Lock] = {}
        self._lock = threading.Lock()
        self._max = max_items

    def get(self, key: str) -> Any:
        with self._lock:
            hit = self._data.get(key)
            if hit and hit[0] > time.time():
                return hit[1]
            self._data.pop(key, None)
            return None

    def put(self, key: str, value: Any, ttl: float) -> None:
        with self._lock:
            if len(self._data) >= self._max:
                oldest = min(self._data, key=lambda k: self._data[k][0])
                self._data.pop(oldest, None)
            self._data[key] = (time.time() + ttl, value)

    def drop(self, key: str) -> None:
        with self._lock:
            self._data.pop(key, None)

    def get_or_compute(self, key: str, ttl: float, fn: Callable[[], Any]) -> Any:
        value = self.get(key)
        if value is not None:
            return value
        with self._lock:
            key_lock = self._locks.setdefault(key, threading.Lock())
        with key_lock:
            value = self.get(key)
            if value is None:
                value = fn()
                self.put(key, value, ttl)
            return value


cache = TTLCache()


def _ydl(opts: dict) -> yt_dlp.YoutubeDL:
    base = {
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
        "noplaylist": True,
        # yt-dlp needs a JS runtime to unlock most formats; use whichever is installed.
        "js_runtimes": {"deno": {}, "node": {}},
    }
    base.update(opts)
    return yt_dlp.YoutubeDL(base)


def _flat(url: str, limit: int) -> dict:
    with _ydl({"extract_flat": "in_playlist", "noplaylist": False, "playlistend": limit}) as ydl:
        return ydl.extract_info(url, download=False) or {}


def _channel_id(entry: dict) -> str:
    cid = entry.get("channel_id") or ""
    if not cid:
        match = re.search(r"/channel/(UC[A-Za-z0-9_-]{22})", entry.get("channel_url") or "")
        cid = match.group(1) if match else ""
    return cid


def _card(entry: dict, author: str = "", channel_id: str = "") -> dict | None:
    vid = entry.get("id") or ""
    if not VIDEO_ID.match(vid):
        return None
    return {
        "id": vid,
        "title": entry.get("title") or "Video",
        "author": entry.get("channel") or entry.get("uploader") or author,
        "channelId": _channel_id(entry) or channel_id,
        "duration": int(entry.get("duration") or 0),
        "views": int(entry.get("view_count") or 0),
        "live": entry.get("live_status") == "is_live",
        "short": "/shorts/" in (entry.get("url") or ""),
    }


def _cards(entries: list, author: str = "", channel_id: str = "") -> list[dict]:
    out = []
    for entry in entries or []:
        card = _card(entry or {}, author, channel_id)
        if card:
            out.append(card)
    return out


def search(query: str, limit: int = 24) -> list[dict]:
    query = query.strip()[:120]

    def run() -> list[dict]:
        info = _flat("ytsearch%d:%s" % (limit, query), limit)
        return [c for c in _cards(info.get("entries")) if not c["short"]]

    return cache.get_or_compute("search:" + query.lower(), 600, run)


def suggest(query: str) -> list[str]:
    query = query.strip()[:100]
    if not query:
        return []

    def run() -> list[str]:
        url = "https://suggestqueries.google.com/complete/search?" + urllib.parse.urlencode(
            {"client": "firefox", "ds": "yt", "q": query}
        )
        req = urllib.request.Request(url, headers={"User-Agent": IPAD_UA})
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read().decode("utf-8", "replace"))
        return [s for s in data[1] if isinstance(s, str)][:10]

    return cache.get_or_compute("suggest:" + query.lower(), 3600, run)


def channel(channel_id: str) -> dict:
    def run() -> dict:
        info = _flat("https://www.youtube.com/channel/%s/videos" % channel_id, 30)
        avatar = ""
        for thumb in info.get("thumbnails") or []:
            if thumb.get("id") in ("avatar_uncropped", "avatar"):
                avatar = thumb.get("url") or ""
        name = info.get("channel") or info.get("uploader") or ""
        return {
            "id": channel_id,
            "title": name,
            "avatar": avatar,
            "followers": int(info.get("channel_follower_count") or 0),
            "description": (info.get("description") or "")[:600],
            "videos": _cards(info.get("entries"), name, channel_id),
        }

    return cache.get_or_compute("channel:" + channel_id, 900, run)


def channel_shorts(channel_id: str, limit: int = 6) -> list[dict]:
    def run() -> list[dict]:
        info = _flat("https://www.youtube.com/channel/%s/shorts" % channel_id, limit)
        name = info.get("channel") or info.get("uploader") or ""
        cards = _cards(info.get("entries"), name, channel_id)
        for card in cards:
            card["short"] = True
        return cards

    return cache.get_or_compute("cshorts:" + channel_id, 1200, run)


def shorts(topic: str) -> list[dict]:
    tag = re.sub(r"[^a-z0-9]", "", topic.lower())

    def run() -> list[dict]:
        out: list[dict] = []
        seen: set[str] = set()
        for name in ([tag + "shorts"] if tag else []) + ["shorts"]:
            try:
                info = _flat("https://www.youtube.com/hashtag/%s" % name, 40)
            except Exception:
                continue
            for card in _cards(info.get("entries")):
                if card["short"] and card["id"] not in seen:
                    seen.add(card["id"])
                    out.append(card)
        return out

    return cache.get_or_compute("shorts:" + tag, 1200, run)


def playlist(playlist_id: str) -> dict:
    def run() -> dict:
        info = _flat("https://www.youtube.com/playlist?list=%s" % playlist_id, 100)
        return {"id": playlist_id, "title": info.get("title") or "Playlist", "videos": _cards(info.get("entries"))}

    return cache.get_or_compute("playlist:" + playlist_id, 900, run)


def _expires(url: str) -> float:
    match = re.search(r"[?&/]expire[=/](\d+)", url or "")
    return float(match.group(1)) if match else time.time() + 3 * 3600


def _extract(video_id: str, clients: list) -> dict:
    # "b/bv*/ba" always matches something, so missing formats never raise; we pick streams ourselves.
    opts = {"extractor_args": {"youtube": {"player_client": clients}}, "format": "b/bv*/ba"}
    with _ydl(opts) as ydl:
        return ydl.extract_info("https://www.youtube.com/watch?v=%s" % video_id, download=False)


def _muxed(fmt: dict) -> bool:
    return fmt.get("vcodec") not in (None, "none") and fmt.get("acodec") not in (None, "none")


def _hls_streams(info: dict) -> dict:
    """{"master": url, "sd": url-of-~360p-variant} from a yt-dlp result, or {}."""
    master, sd, sd_height = "", "", 0
    for fmt in info.get("formats") or []:
        if fmt.get("protocol") != "m3u8_native" or not _muxed(fmt):
            continue
        master = master or fmt.get("manifest_url") or ""
        height = int(fmt.get("height") or 0)
        if fmt.get("url") and height <= 360 and height > sd_height:
            sd, sd_height = fmt["url"], height
    return {"master": master, "sd": sd or master} if master else {}


def _fetchable(url: str, headers: dict) -> bool:
    req = urllib.request.Request(url, headers=headers)
    req.add_header("Range", "bytes=0-0")
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return resp.status in (200, 206)
    except Exception:
        return False


def _resolve(video_id: str) -> dict:
    last = "no playable stream"
    meta: dict = {}
    mp4, headers = "", {}
    for clients in MP4_CLIENTS:
        try:
            info = _extract(video_id, clients)
        except Exception as exc:
            last = str(exc)
            continue
        meta = meta or info
        streams = _hls_streams(info)
        if streams:
            _remember_hls(video_id, streams)
        for fmt in info.get("formats") or []:
            if fmt.get("format_id") == "18" and fmt.get("protocol") == "https" and fmt.get("url"):
                fmt_headers = dict(fmt.get("http_headers") or info.get("http_headers") or {})
                # Some clients hand out URLs that 403 from this Mac; check before trusting one.
                if _fetchable(fmt["url"], fmt_headers):
                    mp4, headers = fmt["url"], fmt_headers
        if mp4:
            break
    if not meta:
        raise RuntimeError(last)
    upload = meta.get("upload_date") or ""
    # YouTube is retiring the 360p MP4; when it's missing, the page plays HLS instead.
    return {
        "id": video_id,
        "title": meta.get("title") or "Video",
        "author": meta.get("channel") or meta.get("uploader") or "",
        "channelId": meta.get("channel_id") or "",
        "description": meta.get("description") or "",
        "views": int(meta.get("view_count") or 0),
        "likes": int(meta.get("like_count") or 0),
        "uploadDate": ("%s-%s-%s" % (upload[:4], upload[4:6], upload[6:8])) if len(upload) == 8 else "",
        "duration": int(meta.get("duration") or 0),
        "live": bool(meta.get("is_live")),
        "mp4": mp4,
        "headers": headers,
        "expires": _expires(mp4),
    }


def video(video_id: str, fresh: bool = False) -> dict:
    """Metadata plus the MP4 URL (if any); cached until shortly before YouTube's signed URL expires."""
    key = "video:" + video_id
    if fresh:
        cache.drop(key)
    hit = cache.get(key)
    if hit is not None:
        return hit
    info = cache.get_or_compute(key, 3600, lambda: _resolve(video_id))
    ttl = max(60.0, min(3 * 3600.0, info["expires"] - time.time() - 300))
    cache.put(key, info, ttl)
    return info


def _remember_hls(video_id: str, streams: dict) -> None:
    ttl = max(60.0, min(3 * 3600.0, _expires(streams["master"]) - time.time() - 300))
    cache.put("hls:" + video_id, streams, ttl)


def hls(video_id: str) -> dict:
    """{"master", "sd"} HLS playlist URLs, or {} when YouTube offers none for this video."""
    def run() -> dict:
        for clients in HLS_CLIENTS:
            try:
                streams = _hls_streams(_extract(video_id, clients))
            except Exception:
                continue
            if streams:
                return streams
        return {"none": True}  # cache the miss so we don't retry every play

    streams = cache.get_or_compute("hls:" + video_id, 1800, run)
    if streams.get("master"):
        _remember_hls(video_id, streams)
        return streams
    return {}


def public_info(info: dict) -> dict:
    """Video metadata safe to send to the browser (no signed URLs or headers)."""
    skip = ("mp4", "headers", "expires")
    out = {k: v for k, v in info.items() if k not in skip}
    known = cache.get("hls:" + info["id"])
    # None = not looked up yet; the page treats that as "HD probably available".
    out["hd"] = None if known is None else bool(known.get("master"))
    return out


def prefetch(video_id: str, hd: bool = True) -> None:
    def run() -> None:
        try:
            if hd:
                hls(video_id)
            video(video_id)
        except Exception:
            pass

    threading.Thread(target=run, daemon=True).start()
