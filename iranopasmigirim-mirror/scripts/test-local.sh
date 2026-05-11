#!/usr/bin/env bash
set -euo pipefail
exec "$(dirname "$0")/../setup.sh" dev "${1:-all}"
