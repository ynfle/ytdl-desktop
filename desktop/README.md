# ytdl desktop

Electron UI for your local **yt-dlp** workflow: browse downloaded videos, run **channel** sync and **ytrec** (same flags as [`../scripts/download_videos.sh`](../scripts/download_videos.sh)), queue playback, and **Picture-in-Picture**. The **channels.txt** panel lists each subscription line and can **fetch display names from YouTube** (metadata-only `yt-dlp`, same `--remote-components` as downloads). Lookups run **in parallel** (up to 4 `yt-dlp` processes). Results are **cached on disk** under Electron **user data** as `channel-display-cache.json` (7-day TTL per entry, keyed by absolute data-folder path + `channels.txt` line). Channel **avatars** are downloaded from the `/about` tab metadata into `channel-logos/` next to that JSON and served over the same loopback media server as videos. Use **Refetch all (ignore cache)** to bypass the cache. On app load (and **Reload list**), the table is filled from **channels.txt** plus any **still-valid cache** entries—no `yt-dlp` until you click **Fetch names**.

## Prerequisites

- [Bun](https://bun.sh) or Node 20+ (Brew: `brew tap oven-sh/bun && brew install bun`)
- **`yt-dlp` on your PATH**
- For **ytrec**, the same cookie setup as your script (`--cookies-from-browser firefox`) — Firefox must be available to yt-dlp.

## Package managers

| Tool   | Notes |
|--------|--------|
| **npm** | Default; `npm install` / `npm run dev` |
| **pnpm** | Works; same scripts |
| **Bun** | `bun install` / `bun run dev`; fast installs, runs `package.json` scripts |
| **Yarn** | Works; same scripts |

**Bun** is not in core Homebrew; use `brew tap oven-sh/bun && brew install bun` if you want it. Bun is optional—npm works the same for this app.

## Data folder

By default the app uses the **parent of this package** as the data directory (so when `desktop/` lives inside the repo, that parent holds `channels.txt`, `downloaded.txt`, and **`videos/`** for downloaded files). Use **Choose folder…** to override (stored in app userData). For a **packaged** build, set the data folder explicitly if the default inside the app bundle is not where you want media.

The library scanner **skips** the nested `desktop/` app folder so it does not index `node_modules`. It still finds videos under **`videos/`** and supports legacy top-level uploader dirs and root-level **`rec/`**.

## Scripts

```bash
cd desktop
bun install   # or npm install
bun run dev   # or npm run dev
```

```bash
bun run build && bun run start
```

## Dev tips

- Logs stream into the **Log** panel during downloads.
- Only **one** sync job at a time (enforced in main process).

### Video playback

Local files are served to `<video>` via a **127.0.0.1 HTTP server** inside the app (random port, per-session secret, path allowlisted to the data folder). Chromium rejects custom URL schemes for media (*URL safety check*); plain `http://` avoids that and supports **Range** for MP4.

### `ELECTRON_RUN_AS_NODE`

If your shell or IDE sets **`ELECTRON_RUN_AS_NODE=1`**, `require('electron')` resolves to a path string and the app will crash. The **`dev`** and **`start`** scripts run with `env -u ELECTRON_RUN_AS_NODE` (macOS/Linux). If you launch Electron manually, use:

`env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron .`
