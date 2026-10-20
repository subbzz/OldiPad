# Old iPad HTML5 apps (iOS 12.5.7)

A YouTube app for an iPad that can't install the App Store app, built as an HTML5
Home Screen web app. It runs entirely on the iPad: no Mac, no home server. The
files are published with GitHub Pages; after the first visit the iPad keeps its
own copy (offline cache) and only needs the internet for YouTube itself.

| App | Code |
| --- | --- |
| YouTube | [`apps/youtube.html`](apps/youtube.html), [`apps/js/youtube.js`](apps/js/youtube.js), [`apps/js/yt-google.js`](apps/js/yt-google.js), [`apps/js/yt-lib.js`](apps/js/yt-lib.js), [`apps/css/youtube.css`](apps/css/youtube.css) |
| Your Google keys | [`apps/js/config.js`](apps/js/config.js) |
| Launcher / WhatsApp helper | [`apps/index.html`](apps/index.html), [`apps/whatsapp.html`](apps/whatsapp.html) |
| Publishing | [`.github/workflows/pages.yml`](.github/workflows/pages.yml) |

## What the YouTube app does

- Home with topic chips, Shorts, Subscriptions, and You tabs; search with suggestions
- Videos play in YouTube's own player, with Up next/autoplay, resume where you
  left off, a mini player, channel pages, description, and comments
- Sign in with Google: like/dislike, subscribe, subscriptions feed, liked
  videos, your playlists, save to playlist, post comments
- Watch history and Watch later stay on the iPad (YouTube's API doesn't share
  your real ones)

Because playback uses YouTube's embedded player: YouTube picks the quality, ads
may play, and videos whose owners block embedding won't play (the app says so
and skips them).

## Google setup (one time, about 10 minutes)

The app talks to Google directly, so it needs a free Google Cloud project.

1. Go to <https://console.cloud.google.com/>, create a project, and enable
   **YouTube Data API v3** (APIs & Services → Library).
2. **API key** (for browsing without signing in): APIs & Services → Credentials →
   Create credentials → API key. Edit it:
   - Application restrictions → **Websites**: add `https://subbzz.github.io/*`
     (and `http://localhost:8080/*` if you want to test on the Mac).
   - API restrictions → **YouTube Data API v3** only.
3. **Sign-in client**: OAuth consent screen → External; add the scope
   `.../auth/youtube` and your Google account as a test user, then **Publish app**
   (in "Testing" Google signs you out every 7 days; the "not verified" warning
   at sign-in is expected, tap Continue). Then Credentials → Create credentials →
   OAuth client ID, type **TVs and Limited Input devices**.
4. Put the API key, client ID, and client secret in
   [`apps/js/config.js`](apps/js/config.js), commit, and push. Publishing them
   is OK: the key only works from your Pages address, and Google doesn't treat
   this client type's secret as secret.

Sign-in shows a code on the iPad; you enter it at google.com/device on your
phone (the iPad's Safari is too old for Google's sign-in page). Your sign-in
is stored on the iPad only.

The API's free allowance is 10,000 units a day. Searches cost 100 units, so
the app caches results for 3 hours; everything else costs 1 unit, and likes,
subscribes, and comments cost 50.

## Publish

Every push to `main` publishes `apps/` to `https://subbzz.github.io/OldiPad/`
(GitHub Actions). One-time: repo Settings → Pages → Source: **GitHub Actions**.

## Put it on the iPad

1. In Safari on the iPad, open `https://subbzz.github.io/OldiPad/youtube.html`.
2. Share → **Add to Home Screen**. Open it from the Home Screen and sign in
   there (Home Screen apps keep a separate sign-in from Safari).

Or add all the icons at once: open `https://subbzz.github.io/OldiPad/home-screen.mobileconfig`
in Safari, then Settings → Profile Downloaded → Install.

Updates arrive by themselves: the next time the app opens online it downloads
the new version and reloads.

## Test on the Mac (optional)

```bash
./serve.sh
```

Then open <http://localhost:8080/youtube.html>. The previous Mac-server version
(yt-dlp, HD streams, no ads) is in git history at commit `2de40d1`.

## Remove unused App Store apps

On the iPad: press and hold → **X** → **Delete App**, or **Settings > General > iPad Storage**.
