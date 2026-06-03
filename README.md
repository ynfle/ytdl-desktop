# ytdl-desktop

Electron desktop UI for a local [**yt-dlp**](https://github.com/yt-dlp/yt-dlp) workflow: channel sync, **ytrec** recommended feed, library playback, and PiP-style floating player. Unofficial; not affiliated with yt-dlp.

Aside from one frontend design pass with **Opus 4.6**, this repository was developed entirely with **Composer 2** from [Cursor](https://cursor.com).

## Repository layout

| Path | Purpose |
|------|---------|
| [`desktop/`](desktop/) | Electron app (electron-vite, React, TypeScript) |
| [`scripts/download_videos.sh`](scripts/download_videos.sh) | Shell mirror of in-app YouTube download flags (run from your **data** directory) |
| [`scripts/download_podcasts.sh`](scripts/download_podcasts.sh) | Shell mirror of in-app podcast download flags (run from your **data** directory) |
| [`examples/channels.example.txt`](examples/channels.example.txt) | Template for `channels.txt` (copy to your data folder; do not commit real lists) |
| [`examples/podcasts.example.txt`](examples/podcasts.example.txt) | Template for `podcasts.txt` (copy to your data folder; do not commit real lists) |

## Data directory

The app stores **`channels.txt`**, **`playlists.txt`**, **`podcasts.txt`**, archive logs, and all downloaded media under a single **data root**.

- **Development:** default data root is the **parent of `desktop/`** (usually this repo root when you open `desktop/` inside the clone).
- **Packaged app:** the default may point inside the app bundle; use **Settings → Choose folder…** to pick a writable folder (e.g. `~/Videos/ytdl-data`).
- **Shell scripts:** list files and archive logs are read relative to the shell’s **current working directory**, not the script path. Video and podcast files are written under **`videos/`**.

```bash
cd /path/to/your-data
bash /path/to/ytdl-desktop/scripts/download_videos.sh
# ytrec example:
bash /path/to/ytdl-desktop/scripts/download_videos.sh ytrec 5
# podcast example:
bash /path/to/ytdl-desktop/scripts/download_podcasts.sh
```

## Media layout (`videos/`)

At the data root:

- `channels.txt`, `playlists.txt`, `podcasts.txt` — subscription lists
- `downloaded.txt`, `podcast-downloaded.txt` — yt-dlp archive logs
- `videos/<uploader>/…` — channel sync downloads  
- `videos/rec/<channel>/…` — ytrec downloads  
- `videos/podcasts/<feed-hash>/…` — podcast RSS episode downloads

Older libraries may still have uploader folders or `rec/` **at the data root**; the app still groups those until you move them under `videos/`.

**Migrating an old data folder:** create `videos/`, move each uploader directory into `videos/`, and run `mv rec videos/rec` if you had a root-level `rec/` tree. Keep `channels.txt` and `downloaded.txt` at the data root.

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
