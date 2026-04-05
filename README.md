# ytdl-desktop

Electron desktop UI for a local [**yt-dlp**](https://github.com/yt-dlp/yt-dlp) workflow: channel sync, **ytrec** recommended feed, library playback, and PiP-style floating player. Unofficial; not affiliated with yt-dlp.

## Repository layout

| Path | Purpose |
|------|---------|
| [`desktop/`](desktop/) | Electron app (electron-vite, React, TypeScript) |
| [`scripts/download_videos.sh`](scripts/download_videos.sh) | Shell mirror of in-app download flags (run from your **data** directory) |
| [`examples/channels.example.txt`](examples/channels.example.txt) | Template for `channels.txt` (copy to your data folder; do not commit real lists) |

## Data directory

The app stores **`channels.txt`**, **`downloaded.txt`**, and all downloaded media under a single **data root**.

- **Development:** default data root is the **parent of `desktop/`** (usually this repo root when you open `desktop/` inside the clone).
- **Packaged app:** the default may point inside the app bundle; use **Settings → Choose folder…** to pick a writable folder (e.g. `~/Videos/ytdl-data`).
- **Shell script:** `channels.txt` / `downloaded.txt` are read relative to the shell’s **current working directory**, not the script path. Video files are written under **`videos/`** (and **`videos/rec/`** for ytrec).

```bash
cd /path/to/your-data
bash /path/to/ytdl-desktop/scripts/download_videos.sh
# ytrec example:
bash /path/to/ytdl-desktop/scripts/download_videos.sh ytrec 5
```

## Media layout (`videos/`)

At the data root:

- `channels.txt`, `downloaded.txt` — subscription list and yt-dlp archive log  
- `videos/<uploader>/…` — channel sync downloads  
- `videos/rec/<channel>/…` — ytrec downloads  

Older libraries may still have uploader folders or `rec/` **at the data root**; the app still groups those until you move them under `videos/`.

## Desktop app (dev)

```bash
cd desktop
bun install   # or npm install
bun run dev   # or npm run dev
```

```bash
bun run build && bun run start
```

See [`desktop/README.md`](desktop/README.md) for prerequisites (`yt-dlp`, cookies for ytrec, `ELECTRON_RUN_AS_NODE`, etc.).

## Clone location

Prefer a **source-only** clone (e.g. `~/Projects/ytdl-desktop`) if your download archive is huge or lives elsewhere—point the app at that archive with **Choose folder…**. Using the repo root as both git checkout and data directory is fine for local use if `channels.txt`, `downloaded.txt`, and `videos/` stay gitignored.

## License

MIT — see [LICENSE](LICENSE).
