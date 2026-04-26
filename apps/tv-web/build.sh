#!/usr/bin/env bash
# Build all TV-app packages from this project root.
#
# Outputs:
#   dist/inrtv-tizen.wgt   — Samsung TV widget package (unsigned)
#   dist/inrtv-webos.ipk   — LG TV package (added in Step 4)
#
# The .wgt is a zip with config.xml at the root next to the web assets.
# Tizen Studio signs it with your author + distributor certificates at
# install time; this script intentionally does not bundle a signing step
# so the build is reproducible without secrets.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
DIST="$ROOT/dist"
STAGE="$DIST/_stage"

# Reproducible: same input → same bytes. SOURCE_DATE_EPOCH pins zip mtimes.
export SOURCE_DATE_EPOCH="${SOURCE_DATE_EPOCH:-$(git -C "$ROOT" log -1 --format=%ct 2>/dev/null || echo 0)}"

echo "==> Verifying inputs"
test -f "$ROOT/index.html"     || { echo "missing index.html"; exit 1; }
test -f "$ROOT/lib/hls.min.js" || { echo "missing lib/hls.min.js (run bootstrap.sh)"; exit 1; }
test -f "$ROOT/icon.png"       || node "$ROOT/make-icon.js"
test -f "$ROOT/config.xml"     || { echo "missing config.xml"; exit 1; }

echo "==> Cleaning $DIST"
rm -rf "$DIST"
mkdir -p "$STAGE/tizen"

echo "==> Staging Tizen package"
# config.xml MUST sit at the root of the zip — Tizen will reject the .wgt
# otherwise. Copy only the files the runtime needs, never node_modules,
# tests, or build scripts.
cp "$ROOT/config.xml"   "$STAGE/tizen/"
cp "$ROOT/index.html"   "$STAGE/tizen/"
cp "$ROOT/player.js"    "$STAGE/tizen/"
cp "$ROOT/player.css"   "$STAGE/tizen/"
cp "$ROOT/icon.png"     "$STAGE/tizen/"
cp -r "$ROOT/lib"       "$STAGE/tizen/"
cp -r "$ROOT/_locales"  "$STAGE/tizen/"

echo "==> Packing inrtv-tizen.wgt"
# -X strips extra file attributes that vary across systems (uid/gid).
# cd into the stage dir so the zip has clean relative paths, not stage/...
( cd "$STAGE/tizen" && zip -qrX "$DIST/inrtv-tizen.wgt" . )

echo "==> Cleaning stage"
rm -rf "$STAGE"

echo
echo "Built: $DIST/inrtv-tizen.wgt"
ls -lh "$DIST/inrtv-tizen.wgt"
