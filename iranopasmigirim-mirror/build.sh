#!/usr/bin/env bash
set -euo pipefail

SET_UP_SCRIPT="$(dirname "$0")/setup.sh"
COMMAND="${1:-build}"

case "$COMMAND" in
  build)
    exec "$SET_UP_SCRIPT" dev build
    ;;
  chrome)
    exec "$SET_UP_SCRIPT" dev chrome
    ;;
  firefox)
    exec "$SET_UP_SCRIPT" dev firefox
    ;;
  test)
    exec "$SET_UP_SCRIPT" dev test
    ;;
  release)
    exec "$SET_UP_SCRIPT" dev build
    ;;
  ci)
    exec "$SET_UP_SCRIPT" verify
    ;;
  clean)
    exec "$SET_UP_SCRIPT" clean
    ;;
  help|-h|--help)
    exec "$SET_UP_SCRIPT" help
    ;;
  *)
    echo "Unknown command: $COMMAND" >&2
    echo
    usage
    exit 1
    ;;
esac
