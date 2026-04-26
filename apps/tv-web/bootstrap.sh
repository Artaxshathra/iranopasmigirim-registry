#!/usr/bin/env bash
# Re-fetches the bundled hls.js and verifies its SHA-256.
# The TV app pins the SAME version as extensions/inrtv so a single audit covers
# both. Run after cloning if you want to regenerate src/lib/hls.min.js from
# scratch instead of trusting the tracked copy.

set -euo pipefail
cd "$(dirname "$0")"

HLS_VERSION="1.6.16"
HLS_SHA256="442f599c34f103c3355b375a23bdff560592d7117d09a8c847242ea3de2d40e0"
HLS_URL="https://registry.npmjs.org/hls.js/-/hls.js-${HLS_VERSION}.tgz"
DEST="src/lib/hls.min.js"

echo "Downloading hls.js v${HLS_VERSION}..."

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

curl -fsSL "$HLS_URL" -o "$TMP/hls.tgz"
tar xzf "$TMP/hls.tgz" -C "$TMP"

DOWNLOADED="$TMP/package/dist/hls.min.js"

ACTUAL=$(sha256sum "$DOWNLOADED" | cut -d' ' -f1)
if [[ "$ACTUAL" != "$HLS_SHA256" ]]; then
  echo "SHA-256 mismatch!" >&2
  echo "  expected: $HLS_SHA256" >&2
  echo "  got:      $ACTUAL" >&2
  exit 1
fi

mkdir -p src/lib

sed 's|//# sourceMappingURL=hls.min.js.map||' "$DOWNLOADED" > "$DEST.tmp"
printf '/*! hls.js v%s | Apache-2.0 License | https://github.com/video-dev/hls.js */\n' "$HLS_VERSION" |
  cat - "$DEST.tmp" > "$DEST"
rm -f "$DEST.tmp"

echo "OK  ${DEST} ($(wc -c < "$DEST") bytes, sha256 verified)"
