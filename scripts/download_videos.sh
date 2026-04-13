#!/bin/zsh
# Run with cwd = your data directory (same folder as channels.txt / the app’s data folder).
# channels.txt and downloaded.txt are read/written relative to cwd; video files go under videos/.

# Check for ytrec command - download recommended videos
if [[ "$1" == "ytrec" ]]; then
    # Validate count argument exists and is a positive integer
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

mkdir -p videos

# Existing channel download logic
while IFS= read -r channel_identifier; do
    [ -z "$channel_identifier" ] && continue
    yt-dlp \
        --playlist-items 1-10 \
        --download-archive downloaded.txt \
        --ignore-errors \
        --remote-components ejs:github \
        -f 'bestvideo[height<=720]+bestaudio/best[height<=720]' \
        --write-thumbnail \
        --embed-thumbnail \
        --convert-thumbnails jpg \
        -t mp4 \
        -o "videos/%(uploader)s/%(title)s.%(ext)s" \
        --restrict-filenames \
        "https://www.youtube.com/$channel_identifier/videos"
done <channels.txt
