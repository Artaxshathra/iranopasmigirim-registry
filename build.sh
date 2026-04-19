#!/usr/bin/env bash
set -euo pipefail

DIST="dist"
EXT="extension"

rm -rf "$DIST"
mkdir -p "$DIST"

# --- Chrome ---
echo "Building Chrome extension..."
cd "$EXT"
zip -r "../$DIST/inrtv-chrome.zip" \
  manifest.json utils.js background.js content.js inject.js \
  popup.html popup.js popup.css \
  player.html player.js player.css \
  lib/ icons/ _locales/
cd ..

# --- Firefox (swap service_worker → scripts, add gecko id) ---
echo "Building Firefox extension..."
FF="$DIST/_firefox"
mkdir -p "$FF"
cp -r "$EXT"/* "$FF/"

node -e "
var fs = require('fs');
var m = JSON.parse(fs.readFileSync('$FF/manifest.json', 'utf8'));
m.background = { scripts: ['background.js'] };
m.browser_specific_settings = { gecko: { id: 'inrtv@extension', strict_min_version: '128.0' } };
fs.writeFileSync('$FF/manifest.json', JSON.stringify(m, null, 2));
"

cd "$FF"
zip -r "../inrtv-firefox.zip" .
cd ../..
rm -rf "$FF"

echo ""
echo "Done:"
echo "  $DIST/inrtv-chrome.zip"
echo "  $DIST/inrtv-firefox.zip"
