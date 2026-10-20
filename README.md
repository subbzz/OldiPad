# Old iPad HTML5 apps (iOS 12.5.7)

A YouTube app for an iPad that can't install the App Store app, built as an HTML5
Home Screen web app. The Mac does the YouTube work (yt-dlp, Google sign-in);
the iPad only shows pages and plays video.

| App | Code |
| --- | --- |
| YouTube | [`apps/youtube.html`](apps/youtube.html), [`apps/js/youtube.js`](apps/js/youtube.js), [`apps/js/yt-lib.js`](apps/js/yt-lib.js), [`apps/css/youtube.css`](apps/css/youtube.css) |
| Launcher / WhatsApp helper | [`apps/index.html`](apps/index.html), [`apps/whatsapp.html`](apps/whatsapp.html), [`apps/css/app.css`](apps/css/app.css) |
| Mac server | [`scripts/server.py`](scripts/server.py), [`scripts/yt_backend.py`](scripts/yt_backend.py), [`scripts/google_account.py`](scripts/google_account.py) |

## What the YouTube app does

- Home with topic chips, Shorts (swipe up/down), Subscriptions, and You tabs
- Search with suggestions and recent searches
- Watch page: HD playback (HLS up to 1080p) with automatic fallback to 360p,
  resume where you left off, autoplay Up next, mini player, picture in picture,
  description, channel pages
- With Google sign-in: like/dislike, subscribe, your subscriptions feed, liked
  videos, your playlists, save to playlist, read and post comments
- On the iPad only: watch history and Watch later (YouTube's API doesn't expose
  your real history or Watch later list)

## Run it

You need Python 3.10+ and Node (`brew install python@3.12 node`). Then:

```bash
./serve.sh
```

`serve.sh` creates `.venv`, keeps yt-dlp up to date (YouTube breaks old
versions every few weeks), writes the Home Screen profile, and starts the server
on port 8080. Leave it running.

## Put it on the iPad

1. Mac and iPad on the same Wi-Fi, `./serve.sh` running.
2. On the iPad, open **Safari** and go to `http://<your-mac>.local:8080/apps/youtube.html`
   (`serve.sh` prints the exact address).
3. Share → **Add to Home Screen**. Open it from the Home Screen and sign in there.
   The Home Screen app keeps its own sign-in, separate from Safari.

Or install every icon at once over USB: `.venv/bin/python scripts/install_to_ipad.py`,
then on the iPad open **Settings → Profile Downloaded → Install**.

## Google sign-in (one-time setup on the Mac)

The iPad's Safari is too old for Google's sign-in page, so sign-in uses Google's
"TV and limited input" flow: the iPad shows a code, and you enter it at
google.com/device on your phone. Tokens stay on the Mac in `config/` (gitignored).

1. Go to <https://console.cloud.google.com/>, create a project, and enable
   **YouTube Data API v3** (APIs & Services → Library).
2. APIs & Services → **OAuth consent screen**: choose External, fill in the app
   name and your email, add the scope `.../auth/youtube`, and add your Google
   account as a test user. Then click **Publish app**. If you leave it in
   "Testing", Google signs you out every 7 days. Google will show a "not
   verified" warning at sign-in; for your own account, tap Continue.
3. APIs & Services → Credentials → **Create credentials → OAuth client ID**,
   type **TVs and Limited Input devices**. Download the JSON.
4. Save it as `config/google_oauth.json` in this folder and restart `./serve.sh`.
5. In the app: You → **Sign in**, then follow the code on screen.

The API has a free daily quota (10,000 units). Normal use stays far below it:
search and playback don't use it, and a like or subscribe costs 50 units.

## Without the Mac

The YouTube app needs `serve.sh`. `scripts/pack_standalone.py` builds the Launcher and
WhatsApp pages as single files for AirDrop/Files; its `YouTube.html` only links to the Mac.

## Remove unused App Store apps

On the iPad: press and hold → **X** → **Delete App**, or **Settings > General > iPad Storage**.
