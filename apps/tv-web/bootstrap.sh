#!/usr/bin/env bash
# Re-fetches every third-party asset bundled with the TV app and verifies
# each by SHA-256. The TV app pins the SAME hls.js version as
# extensions/inrtv so a single audit covers both. Run after cloning if you
# want to regenerate the lib/ contents from scratch instead of trusting the
# tracked copies.

set -euo pipefail
cd "$(dirname "$0")"

# --- hls.js ---
HLS_VERSION="1.6.16"
HLS_SHA256="442f599c34f103c3355b375a23bdff560592d7117d09a8c847242ea3de2d40e0"
HLS_URL="https://registry.npmjs.org/hls.js/-/hls.js-${HLS_VERSION}.tgz"
HLS_DEST="lib/hls.min.js"

# --- Vazirmatn (Persian font, OFL-1.1) ---
# The variable WOFF2 covers every weight in a single ~110 KB file, so the
# whole UI can shift weight without bundling 9 separate files. The pinned
# SHA is over the upstream release zip so any re-fetch is byte-verified end
# to end (zip → woff2). https://github.com/rastikerdar/vazirmatn
VAZ_VERSION="33.003"
VAZ_ZIP_SHA256="0a9afd41967e6f57096a56a181a23f81a2b999b62f1f2a4e4b26736580854fdb"
VAZ_WOFF2_SHA256="4e3fa217d38fdafc1fea4414ceb58ca5e662cf0ab5fa735a8c8c20e8b42cad92"
VAZ_URL="https://github.com/rastikerdar/vazirmatn/releases/download/v${VAZ_VERSION}/vazirmatn-v${VAZ_VERSION}.zip"
VAZ_DEST="lib/fonts/Vazirmatn-wght.woff2"
VAZ_LICENSE="lib/fonts/Vazirmatn-OFL.txt"

verify_sha() {
  local file="$1" expected="$2" name="$3"
  local actual
  actual=$(sha256sum "$file" | cut -d' ' -f1)
  if [[ "$actual" != "$expected" ]]; then
    echo "SHA-256 mismatch for ${name}!" >&2
    echo "  expected: ${expected}" >&2
    echo "  got:      ${actual}" >&2
    exit 1
  fi
}

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

echo "Downloading hls.js v${HLS_VERSION}..."
curl -fsSL "$HLS_URL" -o "$TMP/hls.tgz"
tar xzf "$TMP/hls.tgz" -C "$TMP"
DOWNLOADED="$TMP/package/dist/hls.min.js"
verify_sha "$DOWNLOADED" "$HLS_SHA256" "hls.min.js"

mkdir -p lib lib/fonts

sed 's|//# sourceMappingURL=hls.min.js.map||' "$DOWNLOADED" > "$HLS_DEST.tmp"
printf '/*! hls.js v%s | Apache-2.0 License | https://github.com/video-dev/hls.js */\n' "$HLS_VERSION" |
  cat - "$HLS_DEST.tmp" > "$HLS_DEST"
rm -f "$HLS_DEST.tmp"

echo "OK  ${HLS_DEST} ($(wc -c < "$HLS_DEST") bytes, sha256 verified)"

echo "Downloading Vazirmatn v${VAZ_VERSION}..."
curl -fsSL "$VAZ_URL" -o "$TMP/vaz.zip"
verify_sha "$TMP/vaz.zip" "$VAZ_ZIP_SHA256" "vazirmatn release zip"
unzip -q "$TMP/vaz.zip" -d "$TMP/vaz"

cp "$TMP/vaz/fonts/webfonts/Vazirmatn[wght].woff2" "$VAZ_DEST"
cp "$TMP/vaz/OFL.txt" "$VAZ_LICENSE"
verify_sha "$VAZ_DEST" "$VAZ_WOFF2_SHA256" "Vazirmatn variable woff2"

echo "OK  ${VAZ_DEST} ($(wc -c < "$VAZ_DEST") bytes, sha256 verified)"
