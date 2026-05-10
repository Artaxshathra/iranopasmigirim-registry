#!/usr/bin/env bash
set -euo pipefail

TARGET="${1:-chrome}"

case "$TARGET" in
  chrome|firefox|both) ;;
  *)
    echo "Usage: ./scripts/test-local.sh [chrome|firefox|both]"
    exit 1
    ;;
esac

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "[local-test] Running tests..."
npm test

echo "[local-test] Building target: $TARGET"
npm run "dev:$TARGET"

echo
if [[ "$TARGET" == "chrome" || "$TARGET" == "both" ]]; then
  echo "Chrome load path: $ROOT_DIR/dist/chrome"
fi
if [[ "$TARGET" == "firefox" || "$TARGET" == "both" ]]; then
  echo "Firefox load path: $ROOT_DIR/dist/firefox"
fi

echo
cat <<'EOF'
Important:
- Do NOT load src/ in browser extension manager.
- Load dist/chrome for Chrome (Load unpacked).
- Load dist/firefox for Firefox temporary add-on.
EOF
