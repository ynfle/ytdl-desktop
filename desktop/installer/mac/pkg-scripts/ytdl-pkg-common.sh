#!/bin/bash
# Shared helpers for the YTDL Desktop macOS package.
#
# The package payload is installed under Library/YTDL Desktop/staged, not on top of
# the live app. postinstall then copies those files into the existing .app.
# The .app folder itself is not deleted, so a Dock pin keeps the same bundle.

# Bundle identity. Must match electron-builder appId and productName.
YTDL_BUNDLE_ID="com.ytdl.desktop"
YTDL_APP_NAME="YTDL Desktop.app"
YTDL_LOG_FILE="/tmp/ytdl-desktop-installer.log"

# Live app to update, when one is already installed.
YTDL_FOUND_APP=""
# New copy written by the package, under the staging install location.
YTDL_STAGED_APP=""

# Writes one line to install.log (stdout), /tmp, and the system log.
ytdl_log() {
  local line="[ytdl-pkg] $*"
  printf '%s\n' "$line"
  printf '%s\n' "$line" >> "$YTDL_LOG_FILE" 2>/dev/null || true
  if command -v logger >/dev/null 2>&1; then
    logger -t ytdl-pkg "$line" || true
  fi
}

# Prints CFBundleIdentifier, or an empty string.
ytdl_bundle_id() {
  local app="$1"
  /usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$app/Contents/Info.plist" 2>/dev/null || true
}

# Returns 0 when Contents/MacOS contains a non-empty executable.
ytdl_app_has_binary() {
  local macos="$1/Contents/MacOS"
  local file
  if [ ! -d "$macos" ]; then
    return 1
  fi
  for file in "$macos"/*; do
    if [ -f "$file" ] && [ -s "$file" ]; then
      return 0
    fi
  done
  return 1
}

# Returns 0 when this path is the staged copy, not the app the user launches.
ytdl_is_staged_path() {
  case "$1" in
    */Library/YTDL\ Desktop/staged/*|*/Library/YTDL\ Desktop/staged)
      return 0
      ;;
  esac
  return 1
}

# Remember candidate in YTDL_FOUND_APP when it is our real (non-staged) app.
ytdl_consider_app() {
  local candidate="$1"
  local bundle_id
  ytdl_log "checking '$candidate'"
  if ytdl_is_staged_path "$candidate"; then
    ytdl_log "  staged copy, ignored"
    return 1
  fi
  if [ ! -d "$candidate" ]; then
    ytdl_log "  not present"
    return 1
  fi
  bundle_id="$(ytdl_bundle_id "$candidate")"
  ytdl_log "  bundle id '${bundle_id:-<none>}'"
  if [ "$bundle_id" = "$YTDL_BUNDLE_ID" ]; then
    YTDL_FOUND_APP="$candidate"
    ytdl_log "  this is the installed app"
    return 0
  fi
  return 1
}

# Sets YTDL_FOUND_APP to the app the Dock is most likely pointing at.
ytdl_find_existing_app() {
  local home base hit app_path mdfind_list
  YTDL_FOUND_APP=""

  if ytdl_consider_app "/Applications/$YTDL_APP_NAME"; then
    return 0
  fi

  for home in /Users/*; do
    base="$(basename "$home")"
    case "$base" in
      Shared|Guest|.localized) continue ;;
    esac
    if ytdl_consider_app "$home/Applications/$YTDL_APP_NAME"; then
      return 0
    fi
  done

  if ! command -v mdfind >/dev/null 2>&1; then
    ytdl_log "mdfind is not available; skipped Spotlight search"
    ytdl_log "no existing app found"
    return 1
  fi

  mdfind_list="$(mktemp "${TMPDIR:-/tmp}/ytdl-mdfind.XXXXXX")"
  mdfind "kMDItemCFBundleIdentifier == '$YTDL_BUNDLE_ID'" > "$mdfind_list" 2>/dev/null || true
  while IFS= read -r hit; do
    [ -n "$hit" ] || continue
    app_path="$hit"
    while [ -n "$app_path" ] && [ "$app_path" != "/" ]; do
      case "$app_path" in
        *.app) break ;;
      esac
      app_path="$(dirname "$app_path")"
    done
    case "$app_path" in
      *.app) ;;
      *) continue ;;
    esac
    if ytdl_consider_app "$app_path"; then
      rm -f "$mdfind_list"
      return 0
    fi
  done < "$mdfind_list"
  rm -f "$mdfind_list"
  ytdl_log "no existing app found"
  return 1
}

# Sets YTDL_STAGED_APP to the payload the package just wrote.
ytdl_find_staged_app() {
  local dest="${1:-}"
  local volume="${2:-}"
  local home candidate
  YTDL_STAGED_APP=""
  ytdl_log "looking for staged app. dest='$dest' volume='$volume'"

  for candidate in \
    "$dest/$YTDL_APP_NAME" \
    "$dest/YTDL Desktop.app" \
    "${volume%/}/Library/YTDL Desktop/staged/$YTDL_APP_NAME" \
    "/Library/YTDL Desktop/staged/$YTDL_APP_NAME"
  do
    if [ -n "$candidate" ] && [ -d "$candidate/Contents" ]; then
      YTDL_STAGED_APP="$candidate"
      ytdl_log "staged app is '$YTDL_STAGED_APP'"
      return 0
    fi
  done

  for home in /Users/*; do
    candidate="$home/Library/YTDL Desktop/staged/$YTDL_APP_NAME"
    if [ -d "$candidate/Contents" ]; then
      YTDL_STAGED_APP="$candidate"
      ytdl_log "staged app is '$YTDL_STAGED_APP'"
      return 0
    fi
  done

  ytdl_log "staged app was not found"
  return 1
}

# Where a first install should go when nothing is installed yet.
ytdl_first_install_target() {
  local staged="$1"
  case "$staged" in
    /Users/*)
      printf '%s\n' "$(printf '%s\n' "$staged" | sed -E 's|^(/Users/[^/]+)/.*|\1|')/Applications/$YTDL_APP_NAME"
      ;;
    *)
      printf '%s\n' "/Applications/$YTDL_APP_NAME"
      ;;
  esac
}

# Ask the running app to quit so its files can be replaced.
ytdl_quit_app() {
  local i
  ytdl_log "asking $YTDL_BUNDLE_ID to quit"
  osascript -e "tell application id \"$YTDL_BUNDLE_ID\" to quit" >/dev/null 2>&1 || true
  i=0
  while [ "$i" -lt 20 ]; do
    if ! pgrep -x "YTDL Desktop" >/dev/null 2>&1; then
      ytdl_log "app is not running"
      return 0
    fi
    sleep 0.5
    i=$((i + 1))
  done
  ytdl_log "app is still running after quit request"
  return 1
}

# Replace the files inside an existing .app. The .app directory is kept.
ytdl_replace_app_contents() {
  local staged="$1"
  local live="$2"
  local backup owner
  ytdl_quit_app || true
  owner="$(stat -f '%u:%g' "$live" 2>/dev/null || true)"
  ytdl_log "replacing contents of '$live' (owner ${owner:-unknown}) from '$staged'"
  backup="$(mktemp -d "${TMPDIR:-/tmp}/ytdl-contents.XXXXXX")"
  if mv "$live/Contents" "$backup/Contents"; then
    if ditto "$staged/Contents" "$live/Contents"; then
      rm -rf "$backup"
      if [ -n "$owner" ]; then
        chown -R "$owner" "$live" || ytdl_log "chown of '$live' to '$owner' failed"
      fi
      ytdl_log "contents replaced; the .app folder was not removed"
      return 0
    fi
    ytdl_log "copy failed; restoring the previous Contents"
    rm -rf "$live/Contents"
    mv "$backup/Contents" "$live/Contents" || ytdl_log "restore of Contents failed"
    rm -rf "$backup"
    return 1
  fi
  ytdl_log "could not move Contents aside; copying over the existing files"
  rm -rf "$backup"
  if ! ditto "$staged/Contents" "$live/Contents"; then
    ytdl_log "copy over existing Contents failed"
    return 1
  fi
  if [ -n "$owner" ]; then
    chown -R "$owner" "$live" || ytdl_log "chown of '$live' to '$owner' failed"
  fi
  return 0
}

# Tell Launch Services about the updated bundle without restarting the Dock.
ytdl_register_app() {
  local app="$1"
  local lsregister="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"
  if [ -x "$lsregister" ]; then
    ytdl_log "registering '$app' with Launch Services"
    "$lsregister" -f "$app" || ytdl_log "lsregister failed"
  fi
}

# Copy the staged payload onto the real app, then delete the staged copy.
ytdl_publish_staged_app() {
  local dest="${1:-}"
  local volume="${2:-}"
  local target staged_parent
  if ! ytdl_find_staged_app "$dest" "$volume"; then
    ytdl_log "nothing to publish"
    return 1
  fi
  if ! ytdl_app_has_binary "$YTDL_STAGED_APP"; then
    ytdl_log "staged app has no executable: '$YTDL_STAGED_APP'"
    return 1
  fi

  if ytdl_find_existing_app; then
    target="$YTDL_FOUND_APP"
    ytdl_log "updating existing app at '$target'"
    if ! ytdl_replace_app_contents "$YTDL_STAGED_APP" "$target"; then
      return 1
    fi
  else
    target="$(ytdl_first_install_target "$YTDL_STAGED_APP")"
    ytdl_log "first install: copying app to '$target'"
    if [ -e "$target" ] && [ "$(ytdl_bundle_id "$target")" != "$YTDL_BUNDLE_ID" ]; then
      ytdl_log "refusing to replace unrelated item at '$target'"
      return 1
    fi
    mkdir -p "$(dirname "$target")"
    rm -rf "$target"
    if ! ditto "$YTDL_STAGED_APP" "$target"; then
      ytdl_log "copy to '$target' failed"
      return 1
    fi
    case "$target" in
      /Users/*)
        chown -R "$(printf '%s\n' "$target" | sed -E 's|^/Users/([^/]+)/.*|\1|')" "$target" \
          || ytdl_log "chown of new app failed"
        ;;
    esac
  fi

  if ! ytdl_app_has_binary "$target"; then
    ytdl_log "app at '$target' has no executable after publish"
    return 1
  fi

  ytdl_register_app "$target"
  staged_parent="$(dirname "$YTDL_STAGED_APP")"
  if [ "$staged_parent" != "$(dirname "$target")" ]; then
    ytdl_log "removing staged copy '$staged_parent'"
    rm -rf "$staged_parent"
  else
    ytdl_log "staged copy is the installed app; not removing it"
  fi
  ytdl_log "publish finished at '$target'"
  return 0
}
