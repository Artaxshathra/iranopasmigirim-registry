#!/usr/bin/env bash
set -euo pipefail

# Run from the directory this script lives in
cd "$(dirname "$0")"

DIST="dist"
SRC="src"

rm -rf "$DIST"
mkdir -p "$DIST"

# Deterministic timestamp: last git commit (fallback to fixed epoch if not a repo)
if SOURCE_DATE_EPOCH=$(git log -1 --pretty=%ct 2>/dev/null); then :; else SOURCE_DATE_EPOCH=1704067200; fi
export SOURCE_DATE_EPOCH
STAMP=$(date -u -d "@$SOURCE_DATE_EPOCH" +"%Y%m%d%H%M.%S" 2>/dev/null || date -u -r "$SOURCE_DATE_EPOCH" +"%Y%m%d%H%M.%S")

# Normalize mtimes of everything inside a staging dir so zip output is byte-identical.
normalize() {
  find "$1" -exec touch -t "$STAMP" {} +
}

# --- Chrome ---
echo "Building Chrome extension..."
CHROME="$DIST/_chrome"
mkdir -p "$CHROME"
cp -r "$SRC"/* "$CHROME/"
cp LICENSE "$CHROME/"
normalize "$CHROME"
cd "$CHROME"
zip -rX "../inrtv-chrome.zip" \
  manifest.json LICENSE \
  popup.html popup.js popup.css \
  player.html player.js player.css \
  lib/ icons/ _locales/ \
  -x "*.DS_Store"
cd ../..
rm -rf "$CHROME"

# --- Firefox (add gecko id) ---
echo "Building Firefox extension..."
FF="$DIST/_firefox"
mkdir -p "$FF"
cp -r "$SRC"/* "$FF/"
cp LICENSE "$FF/"

node -e "
var fs = require('fs');
var m = JSON.parse(fs.readFileSync('$FF/manifest.json', 'utf8'));
m.browser_specific_settings = { gecko: { id: 'inrtv@extension', strict_min_version: '128.0' } };
fs.writeFileSync('$FF/manifest.json', JSON.stringify(m, null, 2));
"

normalize "$FF"
cd "$FF"
zip -rX "../inrtv-firefox.zip" \
  manifest.json LICENSE \
  popup.html popup.js popup.css \
  player.html player.js player.css \
  lib/ icons/ _locales/ \
  -x "*.DS_Store"
cd ../..
rm -rf "$FF"

echo ""
echo "Done:"
echo "  extensions/inrtv/$DIST/inrtv-chrome.zip"
echo "  extensions/inrtv/$DIST/inrtv-firefox.zip"
