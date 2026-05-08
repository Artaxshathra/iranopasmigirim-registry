#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

usage() {
  cat <<'EOF'
Usage:
  ./build.sh                 # build both targets
  ./build.sh build           # same as default
  ./build.sh chrome          # build chrome target only
  ./build.sh firefox         # build firefox target only
  ./build.sh test            # run unit tests
  ./build.sh release         # release-gated build (IPM_RELEASE=1)
  ./build.sh ci              # install + test + build
  ./build.sh clean           # clean dist
EOF
}

cmd="${1:-build}"

case "$cmd" in
  build)
    npm run build
    ;;
  chrome)
    npm run build:chrome
    ;;
  firefox)
    npm run build:firefox
    ;;
  test)
    npm test
    ;;
  release)
    IPM_RELEASE=1 npm run build
    ;;
  ci)
    npm install
    npm test
    npm run build
    ;;
  clean)
    npm run clean
    ;;
  help|-h|--help)
    usage
    ;;
  *)
    echo "Unknown command: $cmd" >&2
    echo
    usage
    exit 1
    ;;
esac
