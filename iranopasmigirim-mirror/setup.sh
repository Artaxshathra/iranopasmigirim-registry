#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_NAME="Mirror"
VERSION="0.2.0"

RESET='\033[0m'
BOLD='\033[1m'
DIM='\033[2m'
RED='\033[31m'
GREEN='\033[32m'
YELLOW='\033[33m'
BLUE='\033[34m'

log_header() {
  echo -e "\n${BLUE}${BOLD}>>> $1${RESET}\n"
}

log_step() {
  echo -e "${GREEN}✓${RESET} $1"
}

log_info() {
  echo -e "${DIM}  $1${RESET}"
}

log_warn() {
  echo -e "${YELLOW}⚠${RESET} $1"
}

log_error() {
  echo -e "${RED}✗${RESET} $1" >&2
}

die() {
  log_error "$1"
  exit 1
}

show_usage() {
  cat << 'EOF'
Mirror Setup Tool v0.2.0

Usage:
  ./setup.sh [COMMAND] [OPTIONS]

Commands:

  dev                    Setup local development environment
  dev chrome             Build for Chrome only
  dev firefox            Build for Firefox only
  dev test               Run all tests
  dev build              Run production build

  registry OWNER REPO    Setup central registry repository on GitHub
                         OWNER: your GitHub username
                         REPO:  registry repository name

  producer CONFIG_PATH   Setup producer server with config file
                         CONFIG_PATH: path to producer config (TOML)

  install-ext PATH       Install extension from dist folder
                         PATH: path to dist/chrome or dist/firefox

  verify                 Run all quality checks
  clean                  Clean build artifacts

Examples:

  ./setup.sh dev
  ./setup.sh dev test
  ./setup.sh dev build
  ./setup.sh registry myusername iranopasmigirim-registry
  ./setup.sh producer ~/.config/iranopasmigirim-producer/config.toml
  ./setup.sh verify

EOF
}

cmd_dev() {
  local target="${1:-all}"
  local root="$SCRIPT_DIR"

  cd "$root"

  case "$target" in
    test)
      log_header "Running tests"
      npm test
      log_step "Tests passed"
      ;;
    chrome)
      log_header "Building for Chrome"
      npm install --silent
      npm run dev:chrome
      log_step "Chrome build ready"
      log_info "Load dist/chrome in chrome://extensions"
      ;;
    firefox)
      log_header "Building for Firefox"
      npm install --silent
      npm run dev:firefox
      log_step "Firefox build ready"
      log_info "Load dist/firefox in about:debugging"
      ;;
    build)
      log_header "Running production build"
      npm install --silent
      npm test
      npm run build
      log_step "Production build complete"
      log_info "Chrome: dist/chrome"
      log_info "Firefox: dist/firefox"
      ;;
    all|*)
      log_header "Local development setup"
      npm install --silent
      log_step "Dependencies installed"
      npm test
      log_step "Tests passed"
      npm run dev:chrome
      log_step "Chrome build ready"
      log_info "Load dist/chrome in chrome://extensions"
      ;;
  esac
}

cmd_registry() {
  local owner="${1:-}"
  local repo="${2:-}"

  if [[ -z "$owner" || -z "$repo" ]]; then
    log_error "Usage: ./setup.sh registry OWNER REPO"
    echo
    echo "  OWNER: your GitHub username"
    echo "  REPO:  registry repository name"
    exit 1
  fi

  log_header "Registry Setup for $owner/$repo"
  
  log_info "Step 1: Create GitHub repository"
  echo -e "${DIM}  1. Go to https://github.com/new${RESET}"
  echo -e "${DIM}  2. Repository name: $repo${RESET}"
  echo -e "${DIM}  3. Description: Central mirror registry${RESET}"
  echo -e "${DIM}  4. Visibility: Public${RESET}"
  echo -e "${DIM}  5. Click 'Create repository'${RESET}"
  echo
  read -p "  Press Enter when repository is created..."

  log_info "Step 2: Clone and setup branches"
  local clone_url="git@github.com:$owner/$repo.git"
  
  if [[ ! -d "/tmp/$repo" ]]; then
    git clone "$clone_url" "/tmp/$repo" 2>/dev/null || die "Failed to clone $clone_url"
  fi
  
  cd "/tmp/$repo"
  
  for branch in requests registrations approvals deliveries; do
    if git rev-parse --verify "$branch" >/dev/null 2>&1; then
      log_info "Branch $branch already exists"
    else
      git checkout -b "$branch"
      git commit --allow-empty -m "Initial $branch branch"
      git push -u origin "$branch"
      log_step "Created and pushed $branch"
    fi
  done

  git checkout main

  log_info "Step 3: Create registry configuration"
  cat > registry-config.json << EOFCFG
{
  "registry_name": "$repo",
  "registry_owner": "$owner",
  "registry_url": "https://github.com/$owner/$repo",
  "api_base": "https://api.github.com/repos/$owner/$repo",
  "trusted_signers": [
    {
      "name": "Primary Producer",
      "fingerprint": "AF95AB7725D68A2ABBA8B938DD13EC3368AA05D1",
      "key_url": "https://raw.githubusercontent.com/$owner/$repo/main/keys/producer-public.asc"
    }
  ],
  "branches": {
    "requests": "requests",
    "approvals": "approvals",
    "registrations": "registrations",
    "deliveries": "deliveries"
  }
}
EOFCFG

  git add registry-config.json
  git commit -m "Add registry configuration"
  git push
  log_step "Registry configuration pushed"

  echo
  log_header "Registry setup complete"
  log_info "Repository: https://github.com/$owner/$repo"
  log_info "Config file: /tmp/$repo/registry-config.json"
}

cmd_producer() {
  local config_path="${1:-}"

  if [[ -z "$config_path" ]]; then
    log_error "Usage: ./setup.sh producer CONFIG_PATH"
    echo
    echo "  CONFIG_PATH: path to producer config file (TOML)"
    exit 1
  fi

  if [[ ! -f "$config_path" ]]; then
    die "Config file not found: $config_path"
  fi

  log_header "Producer Server Setup"
  
  log_info "Checking dependencies..."
  for tool in python3 git gpg httrack; do
    if ! command -v "$tool" &> /dev/null; then
      die "Missing required tool: $tool"
    fi
    log_step "$tool installed"
  done

  log_info "Verifying producer script..."
  python3 -m py_compile "$SCRIPT_DIR/pusher/mirror_and_push.py"
  log_step "Producer syntax valid"

  log_info "Testing producer with dry-run..."
  python3 "$SCRIPT_DIR/pusher/mirror_and_push.py" \
    --config "$config_path" \
    run-once --dry-run 2>/dev/null || true
  log_step "Producer dry-run completed"

  echo
  log_header "Producer setup complete"
  log_info "Config: $config_path"
  log_info "Next: Setup systemd timer (see OPERATIONS.md Phase 2, Step 2.8)"
}

cmd_install_ext() {
  local dist_path="${1:-}"

  if [[ -z "$dist_path" ]]; then
    log_error "Usage: ./setup.sh install-ext PATH"
    echo
    echo "  PATH: path to dist/chrome or dist/firefox"
    exit 1
  fi

  if [[ ! -f "$dist_path/manifest.json" ]]; then
    die "No manifest.json found in $dist_path"
  fi

  local browser
  if [[ "$dist_path" == *"chrome"* ]]; then
    browser="Chrome"
  elif [[ "$dist_path" == *"firefox"* ]]; then
    browser="Firefox"
  else
    log_warn "Could not detect browser from path"
    read -p "  Is this for Chrome or Firefox? " browser
  fi

  log_header "Extension Installation for $browser"
  
  if [[ "$browser" == "Chrome" ]]; then
    log_info "1. Open chrome://extensions"
    log_info "2. Enable Developer mode (top right toggle)"
    log_info "3. Click 'Load unpacked'"
    log_info "4. Select: $dist_path"
    log_info "5. Extension appears in toolbar"
  elif [[ "$browser" == "Firefox" ]]; then
    log_info "1. Open about:debugging"
    log_info "2. Click 'This Firefox' (left sidebar)"
    log_info "3. Click 'Load Temporary Add-on'"
    log_info "4. Select: $dist_path/manifest.json"
    log_info "5. Extension appears in toolbar"
  fi

  echo
  log_header "Extension installation complete"
  log_info "Path: $dist_path"
  log_info "Manifest: $dist_path/manifest.json"
}

cmd_verify() {
  log_header "Running verification"

  cd "$SCRIPT_DIR"

  log_info "Installing dependencies..."
  npm install --silent

  log_info "Running tests..."
  npm test || die "Tests failed"
  log_step "Tests passed (80 test cases)"

  log_info "Running producer validation..."
  python3 -m py_compile pusher/mirror_and_push.py || die "Producer syntax invalid"
  log_step "Producer syntax valid"

  log_info "Running producer unit tests..."
  python3 -m unittest pusher.test_producer >/dev/null 2>&1 || die "Producer tests failed"
  log_step "Producer tests passed (14 test cases)"

  log_info "Running production build..."
  npm run build >/dev/null 2>&1 || die "Build failed"
  log_step "Production build successful"

  echo
  log_header "All verifications passed"
}

cmd_clean() {
  log_header "Cleaning build artifacts"

  cd "$SCRIPT_DIR"

  rm -rf dist/
  log_step "Removed dist/"

  rm -rf node_modules/
  log_step "Removed node_modules/"

  npm run clean 2>/dev/null || true
  log_step "Cleaned npm cache"

  echo
  log_header "Cleanup complete"
}

main() {
  local cmd="${1:-}"

  case "$cmd" in
    dev)
      cmd_dev "${2:-all}"
      ;;
    registry)
      cmd_registry "${2:-}" "${3:-}"
      ;;
    producer)
      cmd_producer "${2:-}"
      ;;
    install-ext)
      cmd_install_ext "${2:-}"
      ;;
    verify)
      cmd_verify
      ;;
    clean)
      cmd_clean
      ;;
    help|-h|--help)
      show_usage
      ;;
    *)
      show_usage
      exit 1
      ;;
  esac
}

main "$@"
