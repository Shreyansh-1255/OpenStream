<div align="center">

# 🎬 OpenStream

**A fast, lightweight, backend-free movie & series browser powered by Cinemeta and Stremio addons.**

[![Live Demo](https://img.shields.io/badge/Live%20Demo-OpenStream-cda24e?style=for-the-badge&logo=vercel&logoColor=white)](https://openstream-tv.vercel.app/)
[![Deployed on Vercel](https://img.shields.io/badge/Deployed%20on-Vercel-000000?style=for-the-badge&logo=vercel&logoColor=white)](https://vercel.com)
[![No Backend](https://img.shields.io/badge/Backend-None-2ea44f?style=for-the-badge)](#-how-it-works)

### 🔗 [OpenStream-tv.vercel.app/](https://openstream-tv.vercel.app/)

</div>

---

## ✨ Features

- 🔍 **Discover & Search** – Browse Cinemeta catalogs by genre, or search movies, series and even cast/director names, with spelling suggestions.
- 🖼️ **Rich Title Pages** – Wide banner, description, rating, cast, seasons and episodes for every movie and series.
- 🔌 **Bring Your Own Addons** – Add any Stremio addon manifest URL in Settings. No addon is bundled.
- 🏷️ **Smart Stream Listing** – Results are parsed and labelled by quality (4K, Blu-ray, WEB-DL, WEBRip, HDTV, CAM, etc.), so you can pick the best source at a glance.
- 🧲 **Optional Torrent Links** – Hidden by default; enable in Settings to get copy-only magnet links.
- ⭐ **Watchlist** – Save titles locally in your browser, with **Export / Import database** for backup and moving between devices.
- 🌗 **Dark & Light Theme** – One tap to switch, remembered across visits.
- 📱 **Mobile-first Design** – Fully responsive, smooth on phones.
- 📨 **Rich Link Previews** – Share any title link on WhatsApp, Telegram, Discord or X and get a Stremio-style card with the **title, description and 16:9 background image**.

---

## 📨 Link Previews

Every movie or series page has a clean, shareable URL:

```
https://openstream-tv.vercel.app//t/movie/tt0120157
https://openstream-tv.vercel.app//t/series/tt0944947
```

Just copy the URL from the browser's address bar and send it. Messaging apps don't run JavaScript, so a small Vercel serverless function (`api/title.js`) fetches the title's metadata from Cinemeta and injects the Open Graph tags (`og:title`, `og:description`, `og:image`) into the page for crawlers. Normal visitors get the regular app.

> Other pages (search, catalogs, streams) use `#` routes, which servers can't see, so only title links produce a preview.

---

## 🧠 How It Works

OpenStream is a **static site**. There is no database and no server-side app logic.

| Part | What it does |
| --- | --- |
| `index.html`, `style.css`, `redesign.css` | UI and theming |
| `script.js` | Routing, Cinemeta calls, search, watchlist, addon handling |
| `parser.js` | Parses stream names into quality, codec, audio and source tags |
| `api/title.js` | Serverless function that builds link-preview tags |
| `vercel.json` | Routes `/t/:type/:id` to the function |

- **Metadata:** [Cinemeta](https://v3-cinemeta.strem.io) public API, called straight from the browser.
- **Streams:** Fetched from the addons *you* add in Settings.
- **Storage:** Watchlist and settings live in your browser's `localStorage`.

---

## 🚀 Deploy Your Own

1. **Fork** or clone this repository.
2. Go to [vercel.com](https://vercel.com) and sign in with GitHub.
3. Click **Add New → Project** and import the repo.
4. Leave the framework as **Other**, with no build command and no output directory.
5. Click **Deploy**. That's it. 🎉

> Link previews need a host that runs serverless functions and doesn't block crawlers (like Vercel). Hosts that challenge bots, such as some free shared hosts, will break previews.

### Run locally

```bash
npm i -g vercel
vercel dev
```

Then open `http://localhost:3000`.

---

## ⚙️ Usage

1. Open the app and tap the **⚙️ gear icon**.
2. Paste a Stremio addon **manifest URL** (`https://.../manifest.json`) and add it.
3. Search for a title, open it, and hit **Play** or pick an episode to see streams from your addons.

---

## ⚠️ Disclaimer

OpenStream does not host, store or distribute any media. It only displays metadata from Cinemeta and results returned by addons that the user adds. You are responsible for the addons you use and for complying with the laws in your region.

---

<div align="center">

Made with ❤️ by [Malik](https://github.com/Shreyansh-1255)

</div>
