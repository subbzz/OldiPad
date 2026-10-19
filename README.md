# Old iPad apps (iOS 12.5.7)

Safari still works on this iPad. The App Store does not. Use these pages as home-screen apps for YouTube, WhatsApp, and a few Australian sites.

Mac and iPad must be on the **same Wi-Fi**.

## 1. Remove unwanted apps

Do this on the iPad. Nothing here uninstalls apps over USB.

1. Press and hold an icon until the icons jiggle.
2. Tap the **X**, then **Delete App**.
3. Or go to **Settings > General > iPad Storage**, pick a large unused app, and delete it.

Delete the old **YouTube** and **WhatsApp** apps if they no longer open. The web clips below replace them.

Leave **Safari**, **Settings**, and **Photos**. Some Apple apps cannot be deleted.

## 2. Start the server on the Mac

```bash
./serve.sh
```

It prints a URL like `http://192.168.x.x:8080`. Open that URL in **Safari** on the iPad (not Chrome).

## 3. Install the home-screen apps

**Option A — configuration profile (all icons at once)**

1. On the iPad, tap **Install home screen apps** on the launcher, or open `http://MAC_IP:8080/profiles/home-screen.mobileconfig`.
2. Tap **Allow**, then go to **Settings** and tap **Profile Downloaded**.
3. Tap **Install**. An unsigned-profile warning is normal. The profile is removable later in **Settings > General > Profiles**.

YouTube and WhatsApp icons open the real websites even when this Mac is off. The **Launcher** icon needs the Mac server running.

**Option B — Add to Home Screen (one app at a time)**

1. Open the app page in Safari.
2. Tap the Share button (square with an arrow).
3. Tap **Add to Home Screen**.
4. Tap **Add**.

## YouTube

Opens `m.youtube.com`, which Google still recommends when the native app cannot update. You can also search or paste a video link on the YouTube page in this project.

## WhatsApp

Opens official WhatsApp Web. The native iPad app needs iPadOS 15.1+. WhatsApp currently lists Safari as macOS-only, so iOS 12 may show **browser not supported**.

On the iPad:

1. Open the WhatsApp icon (or `https://web.whatsapp.com`).
2. If the page looks wrong, tap and hold the reload button, then **Request Desktop Website**.
3. On your phone, open WhatsApp > **Linked devices** (or Settings > WhatsApp Web) and scan the QR code.

If WhatsApp still blocks Safari, use **Gmail** on the launcher for mail. This project does not use an unofficial WhatsApp client.

## Extra launcher tiles

Gmail, Google Maps, ABC News, and BOM Weather. Those are ordinary website links.
