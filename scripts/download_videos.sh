#!/bin/zsh
# Run with cwd = your data directory (same folder as channels.txt / playlists.txt / the app’s data folder).
# channels.txt, playlists.txt, and downloaded.txt are read/written relative to cwd; video files go under videos/.
#
# Usage:
#   ./download_videos.sh           — channels.txt (if present) then playlists.txt (if present)
#   ./download_videos.sh channels  — channels.txt only
#   ./download_videos.sh playlists — playlists.txt only
#   ./download_videos.sh ytrec N   — recommended feed (N videos)

YTDLP_COMMON=(
    --playlist-items 1-10
    --download-archive downloaded.txt
    --ignore-errors
    --no-write-playlist-metafiles
    --remote-components ejs:github
    --write-info-json
    --embed-metadata
    -f 'bestvideo[height<=720]+bestaudio/best[height<=720]'
    --write-thumbnail
    --embed-thumbnail
    --convert-thumbnails jpg
    -t mp4
    -o "videos/%(uploader)s/%(title)s.%(ext)s"
    --restrict-filenames
)

download_channels() {
    mkdir -p videos
    [[ -f channels.txt ]] || return 0
    while IFS= read -r channel_identifier; do
        [ -z "$channel_identifier" ] && continue
        yt-dlp "${YTDLP_COMMON[@]}" "https://www.youtube.com/$channel_identifier/videos"
    done <channels.txt
}

download_playlists() {
    mkdir -p videos
    [[ -f playlists.txt ]] || return 0
    while IFS= read -r playlist_url; do
        [[ -z "$playlist_url" ]] && continue
        [[ "$playlist_url" == \#* ]] && continue
        yt-dlp "${YTDLP_COMMON[@]}" "$playlist_url"
    done <playlists.txt
}

# ytrec
if [[ "$1" == "ytrec" ]]; then
    count="$2"
    if [[ -z "$count" ]] || ! [[ "$count" =~ ^[1-9][0-9]*$ ]]; then
        echo "Error: ytrec requires a positive integer count" >&2
        exit 1
    fi
    mkdir -p videos/rec
    echo "Downloading $count recommended videos..." >&2
    yt-dlp \
        --cookies-from-browser firefox \
        --remote-components ejs:github \
        --playlist-items 1-"$count" \
        --no-write-playlist-metafiles \
        --write-info-json \
        --embed-metadata \
        --write-thumbnail \
        --embed-thumbnail \
        --convert-thumbnails jpg \
        -t mp4 \
        --download-archive downloaded.txt \
        --ignore-errors \
        -f 'bestvideo[height<=720]+bestaudio/best[height<=720]' \
        -o "videos/rec/%(channel)s/%(title)s.%(ext)s" \
        --restrict-filenames \
        ":ytrec"
    echo "Completed downloading recommended videos" >&2
    exit 0
fi

if [[ "$1" == "channels" ]]; then
    download_channels
    exit 0
fi

if [[ "$1" == "playlists" ]]; then
    download_playlists
    exit 0
fi

if [[ -n "$1" ]]; then
    echo "Usage: $0 [channels|playlists|ytrec N]" >&2
    exit 1
fi

mkdir -p videos
download_channels
download_playlists
