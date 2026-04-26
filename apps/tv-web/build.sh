#!/usr/bin/env bash
# Build all TV-app packages from src/.
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
SRC="$ROOT/src"
DIST="$ROOT/dist"
STAGE="$DIST/_stage"

# Reproducible: same input → same bytes. SOURCE_DATE_EPOCH pins zip mtimes.
export SOURCE_DATE_EPOCH="${SOURCE_DATE_EPOCH:-$(git -C "$ROOT" log -1 --format=%ct 2>/dev/null || echo 0)}"

echo "==> Verifying inputs"
test -f "$SRC/index.html"           || { echo "missing src/index.html"; exit 1; }
test -f "$SRC/lib/hls.min.js"       || { echo "missing src/lib/hls.min.js (run bootstrap.sh)"; exit 1; }
test -f "$SRC/icon.png"             || node "$ROOT/platform/tizen/make-icon.js"
test -f "$ROOT/platform/tizen/config.xml" || { echo "missing platform/tizen/config.xml"; exit 1; }

echo "==> Cleaning $DIST"
rm -rf "$DIST"
mkdir -p "$STAGE/tizen"

echo "==> Staging Tizen package"
# config.xml MUST sit at the root of the zip — Tizen will reject the .wgt
# otherwise. The web assets keep their src/ structure relative to root.
cp "$ROOT/platform/tizen/config.xml" "$STAGE/tizen/config.xml"
cp -r "$SRC"/* "$STAGE/tizen/"

echo "==> Packing inrtv-tizen.wgt"
# -X strips extra file attributes that vary across systems (uid/gid).
# cd into the stage dir so the zip has clean relative paths, not stage/...
( cd "$STAGE/tizen" && zip -qrX "$DIST/inrtv-tizen.wgt" . )

echo "==> Cleaning stage"
rm -rf "$STAGE"

echo
echo "Built: $DIST/inrtv-tizen.wgt"
ls -lh "$DIST/inrtv-tizen.wgt"
