#!/bin/zsh
# Run with cwd = your data directory (same folder as podcasts.txt / the app's data folder).
# podcasts.txt and podcast-downloaded.txt are read/written relative to cwd; episodes go under videos/podcasts/.
#
# Usage:
#   ./download_podcasts.sh

set -u

# Readable podcast basename (truncated title + short id tail); full title stays in .info.json.
YTDLP_PODCAST_TITLE_MAX_BYTES=50
YTDLP_PODCAST_ID_SUFFIX_CHARS=8
YTDLP_PODCAST_BASENAME="%(title).${YTDLP_PODCAST_TITLE_MAX_BYTES}B_%(id).${YTDLP_PODCAST_ID_SUFFIX_CHARS}s"

PODCAST_ARCHIVE="podcast-downloaded.txt"
PODCAST_LIST="podcasts.txt"
PODCAST_ROOT="videos/podcasts"

hash_feed_url() {
    local feed_url="$1"
    local digest=""

    if command -v shasum >/dev/null 2>&1; then
        digest="$(printf '%s' "$feed_url" | shasum -a 256 | awk '{print $1}')"
    elif command -v sha256sum >/dev/null 2>&1; then
        digest="$(printf '%s' "$feed_url" | sha256sum | awk '{print $1}')"
    elif command -v node >/dev/null 2>&1; then
        digest="$(node -e "process.stdout.write(require('node:crypto').createHash('sha256').update(process.argv[1].trim()).digest('hex'))" "$feed_url")"
    elif command -v bun >/dev/null 2>&1; then
        digest="$(bun -e "process.stdout.write(require('node:crypto').createHash('sha256').update(process.argv[1].trim()).digest('hex'))" "$feed_url")"
    elif command -v openssl >/dev/null 2>&1; then
        digest="$(printf '%s' "$feed_url" | openssl dgst -sha256 -r | awk '{print $1}')"
    else
        echo "Error: need shasum, sha256sum, openssl, node, or bun to hash podcast feed URLs" >&2
        return 1
    fi

    printf '%s' "${digest:0:16}"
}

download_podcasts() {
    if ! command -v yt-dlp >/dev/null 2>&1; then
        echo "Error: yt-dlp is not on PATH" >&2
        return 1
    fi

    mkdir -p "$PODCAST_ROOT"

    if [[ ! -f "$PODCAST_LIST" ]]; then
        echo "[ytdl] $PODCAST_LIST not found in $(pwd); nothing to download" >&2
        return 0
    fi

    local total=0
    local started=0
    local failed=0
    local -a failures=()

    while IFS= read -r feed_url || [[ -n "$feed_url" ]]; do
        feed_url="${feed_url#"${feed_url%%[![:space:]]*}"}"
        feed_url="${feed_url%"${feed_url##*[![:space:]]}"}"
        [[ -z "$feed_url" ]] && continue
        [[ "$feed_url" == \#* ]] && continue

        total=$((total + 1))

        local folder_id
        if ! folder_id="$(hash_feed_url "$feed_url")"; then
            failed=$((failed + 1))
            failures+=("hash failed: $feed_url")
            continue
        fi

        mkdir -p "$PODCAST_ROOT/$folder_id"
        started=$((started + 1))

        echo "" >&2
        echo "[ytdl] === podcast $started: ${feed_url:0:72} ===" >&2
        echo "[ytdl] output: $PODCAST_ROOT/$folder_id" >&2
        echo "[ytdl] archive: $PODCAST_ARCHIVE" >&2
        echo "[ytdl] write-thumbnail only (use desktop app sync for repair/embed)" >&2

        yt-dlp \
            --playlist-items 1-10 \
            --download-archive "$PODCAST_ARCHIVE" \
            --ignore-errors \
            --no-write-playlist-metafiles \
            --remote-components ejs:github \
            --write-info-json \
            --embed-metadata \
            --write-thumbnail \
            -f 'bestaudio/best' \
            -o "$PODCAST_ROOT/$folder_id/${YTDLP_PODCAST_BASENAME}.%(ext)s" \
            --restrict-filenames \
            "$feed_url"

        local code=$?
        if [[ "$code" -ne 0 ]]; then
            failed=$((failed + 1))
            failures+=("exit code $code: $feed_url")
            echo "[ytdl] warning: exit code $code for podcast feed" >&2
        fi
    done <"$PODCAST_LIST"

    echo "" >&2
    echo "[ytdl] podcasts.txt feeds: $total; attempted: $started; failed: $failed" >&2
    if [[ "$failed" -ne 0 ]]; then
        echo "[ytdl] failed podcast feeds:" >&2
        for failure in "${failures[@]}"; do
            echo "[ytdl] - $failure" >&2
        done
    fi

    if [[ "$failed" -ne 0 ]]; then
        return 1
    fi
}

if [[ -n "${1:-}" ]]; then
    echo "Usage: $0" >&2
    exit 1
fi

download_podcasts
