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

  registry OWNER REPO [SSH_ALIAS]    Setup central registry repository on GitHub
                         OWNER: your GitHub username
                         REPO:  registry repository name
                         SSH_ALIAS: (optional) SSH config alias to use for git (default: github.com)

  producer [CONFIG_PATH] Validate or bootstrap producer config
  producer doctor [CONFIG_PATH]
                         Validate or bootstrap producer config
                         CONFIG_PATH: optional path to producer config (TOML)
                         Default: ~/.config/iranopasmigirim-producer/config.toml
  producer run-once [CONFIG_PATH]
                         Run one producer cycle with the given config
  producer daemon [CONFIG_PATH] [--interval MINUTES]
                         Run producer forever using interval_minutes from config
                         or override it for this foreground process only
  producer setup-system REGISTRY_REPO_URL SIGNING_KEY
                         Provision a dedicated producer host and enable mirror.timer
  producer status       Show mirror.timer status via systemctl
  producer logs [LINES] Show recent mirror.service logs (default: 50)

  install-ext PATH       Install extension from dist folder
                         PATH: path to dist/chrome or dist/firefox

  verify                 Run all quality checks
  clean                  Clean build artifacts

Examples:

  ./setup.sh dev
  ./setup.sh dev test
  ./setup.sh dev build
  ./setup.sh registry myusername iranopasmigirim-registry
  ./setup.sh registry myusername iranopasmigirim-registry github-work
  ./setup.sh producer
  ./setup.sh producer run-once
  ./setup.sh producer daemon
  ./setup.sh producer daemon --interval 2
  ./setup.sh producer setup-system https://github.com/example/registry 0xA1B2C3D4E5F6A7B8
  ./setup.sh producer status
  ./setup.sh producer logs
  ./setup.sh producer ~/.config/iranopasmigirim-producer/config.toml
  ./setup.sh verify

EOF
}

PACKAGE_INDEX_REFRESHED=0

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

python_has_toml_parser() {
  python3 - <<'PY' >/dev/null 2>&1
try:
    import tomllib  # type: ignore[attr-defined]
except Exception:
    import tomli  # type: ignore[import-not-found]
PY
}

ensure_python_pip() {
  if python3 -m pip --version >/dev/null 2>&1; then
    return 0
  fi

  if python3 -m ensurepip --upgrade >/dev/null 2>&1; then
    return 0
  fi

  die "Python pip is unavailable and could not be bootstrapped with ensurepip"
}

install_python_toml_parser_via_pip() {
  local context="$1"
  # Use the same Python interpreter that will run the producer script, not
  # a different one that might be on PATH under a virtualenv.
  local python_exe
  python_exe="$(command -v python3)"
  local pip_args=("$python_exe" -m pip install tomli)

  ensure_python_pip

  if [[ "$(id -u)" -ne 0 ]]; then
    pip_args=("$python_exe" -m pip install --user tomli)
  fi

  log_info "Installing Python TOML parser for $context via pip"
  "${pip_args[@]}"
}

run_privileged() {
  if [[ "$(id -u)" -eq 0 ]]; then
    "$@"
  elif command_exists sudo; then
    sudo "$@"
  else
    die "Installing dependencies requires root or sudo: $*"
  fi
}

detect_package_manager() {
  local manager

  for manager in apt-get dnf yum pacman zypper apk brew; do
    if command_exists "$manager"; then
      echo "$manager"
      return 0
    fi
  done

  return 1
}

package_names_for_tool() {
  local manager="$1"
  local tool="$2"

  case "$manager:$tool" in
    apt-get:python3) echo "python3" ;;
    apt-get:git) echo "git" ;;
    apt-get:gpg) echo "gnupg" ;;
    apt-get:httrack) echo "httrack" ;;
    apt-get:node) echo "nodejs" ;;
    apt-get:npm) echo "npm" ;;
    apt-get:ssh) echo "openssh-client" ;;
    dnf:python3|yum:python3) echo "python3" ;;
    dnf:git|yum:git) echo "git" ;;
    dnf:gpg|yum:gpg) echo "gnupg2" ;;
    dnf:httrack|yum:httrack) echo "httrack" ;;
    dnf:node|yum:node) echo "nodejs" ;;
    dnf:npm|yum:npm) echo "npm" ;;
    dnf:ssh|yum:ssh) echo "openssh-clients" ;;
    pacman:python3) echo "python" ;;
    pacman:git) echo "git" ;;
    pacman:gpg) echo "gnupg" ;;
    pacman:httrack) echo "httrack" ;;
    pacman:node) echo "nodejs" ;;
    pacman:npm) echo "npm" ;;
    pacman:ssh) echo "openssh" ;;
    zypper:python3) echo "python3" ;;
    zypper:git) echo "git" ;;
    zypper:gpg) echo "gpg2" ;;
    zypper:httrack) echo "httrack" ;;
    zypper:node) echo "nodejs" ;;
    zypper:npm) echo "npm" ;;
    zypper:ssh) echo "openssh" ;;
    apk:python3) echo "python3" ;;
    apk:git) echo "git" ;;
    apk:gpg) echo "gnupg" ;;
    apk:httrack) echo "httrack" ;;
    apk:node) echo "nodejs" ;;
    apk:npm) echo "npm" ;;
    apk:ssh) echo "openssh-client-default" ;;
    brew:python3) echo "python" ;;
    brew:git) echo "git" ;;
    brew:gpg) echo "gnupg" ;;
    brew:httrack) echo "httrack" ;;
    brew:node|brew:npm) echo "node" ;;
    brew:ssh) echo "openssh" ;;
    *) return 1 ;;
  esac
}

append_unique_package() {
  local package_name="$1"
  shift
  local existing

  for existing in "$@"; do
    if [[ "$existing" == "$package_name" ]]; then
      return 0
    fi
  done

  return 1
}

refresh_package_index() {
  local manager="$1"

  if [[ "$PACKAGE_INDEX_REFRESHED" -eq 1 ]]; then
    return 0
  fi

  case "$manager" in
    apt-get)
      run_privileged apt-get update
      ;;
    dnf)
      run_privileged dnf makecache -y
      ;;
    yum)
      run_privileged yum makecache -y
      ;;
    pacman)
      run_privileged pacman -Sy --noconfirm
      ;;
    zypper)
      run_privileged zypper --non-interactive refresh
      ;;
    apk)
      run_privileged apk update
      ;;
    brew)
      brew update
      ;;
    *)
      die "Unsupported package manager: $manager"
      ;;
  esac

  PACKAGE_INDEX_REFRESHED=1
}

install_packages() {
  local manager="$1"
  shift

  case "$manager" in
    apt-get)
      run_privileged apt-get install -y --no-install-recommends "$@"
      ;;
    dnf)
      run_privileged dnf install -y "$@"
      ;;
    yum)
      run_privileged yum install -y "$@"
      ;;
    pacman)
      run_privileged pacman -S --needed --noconfirm "$@"
      ;;
    zypper)
      run_privileged zypper --non-interactive install --no-recommends "$@"
      ;;
    apk)
      run_privileged apk add --no-cache "$@"
      ;;
    brew)
      brew install "$@"
      ;;
    *)
      die "Unsupported package manager: $manager"
      ;;
  esac
}

install_missing_tools() {
  local context="$1"
  shift
  local manager
  local missing_tool
  local package_name
  local packages=()

  manager="$(detect_package_manager)" || die "Missing required tools for $context: $*. Install them manually and rerun."

  for missing_tool in "$@"; do
    package_name="$(package_names_for_tool "$manager" "$missing_tool")" \
      || die "No package mapping for $missing_tool on $manager"
    if ! append_unique_package "$package_name" "${packages[@]}"; then
      packages+=("$package_name")
    fi
  done

  log_info "Installing missing dependencies for $context via $manager: ${packages[*]}"
  refresh_package_index "$manager"
  install_packages "$manager" "${packages[@]}"
}

install_python_toml_parser() {
  local context="$1"
  local manager
  local package_name

  manager="$(detect_package_manager)" || die "Missing Python TOML support for $context and no supported package manager was found"

  case "$manager" in
    apt-get|dnf|yum|zypper)
      package_name="python3-tomli"
      ;;
    pacman)
      package_name="python-tomli"
      ;;
    apk)
      package_name="py3-tomli"
      ;;
    brew)
      install_python_toml_parser_via_pip "$context"
      return
      ;;
    *)
      die "Unsupported package manager for Python TOML support: $manager"
      ;;
  esac

  log_info "Installing Python TOML parser for $context via $manager: $package_name"
  refresh_package_index "$manager"
  install_packages "$manager" "$package_name"

  if ! python_has_toml_parser; then
    log_warn "$manager installed $package_name but the active python3 still cannot import tomllib/tomli"
    install_python_toml_parser_via_pip "$context"
  fi
}

ensure_python_toml_support() {
  local context="$1"

  if python_has_toml_parser; then
    log_step "Python TOML parser available"
    return 0
  fi

  log_warn "$context requires Python TOML parser support (tomllib or tomli)"
  install_python_toml_parser "$context"

  if ! python_has_toml_parser; then
    die "Python TOML parser installation completed but tomllib/tomli is still unavailable"
  fi

  log_step "Python TOML parser available"
}

ensure_command_dependencies() {
  local context="$1"
  shift
  local tool
  local missing_tools=()

  for tool in "$@"; do
    if command_exists "$tool"; then
      log_step "$tool installed"
    else
      missing_tools+=("$tool")
    fi
  done

  if [[ "${#missing_tools[@]}" -eq 0 ]]; then
    return 0
  fi

  log_warn "$context is missing required tools: ${missing_tools[*]}"
  install_missing_tools "$context" "${missing_tools[@]}"

  for tool in "${missing_tools[@]}"; do
    if ! command_exists "$tool"; then
      die "Dependency installation completed but $tool is still unavailable"
    fi
    log_step "$tool installed"
  done
}

cmd_dev() {
  local target="${1:-all}"
  local root="$SCRIPT_DIR"

  cd "$root"

  log_info "Checking dependencies..."
  ensure_command_dependencies "Development environment" node npm

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

producer_config_path_default() {
  echo "$HOME/.config/iranopasmigirim-producer/config.toml"
}

seed_default_producer_config_from_registry() {
  local config_path="${1:-$(producer_config_path_default)}"
  local registry_url="${2:-}"
  local placeholder_registry_url="https://github.com/your-org/mirror-registry"
  local created=0
  local current_registry_url=""

  [[ -z "$registry_url" ]] && die "registry_url is required"

  if [[ ! -f "$config_path" ]]; then
    log_info "Creating default producer config at $config_path"
    python3 "$SCRIPT_DIR/pusher/mirror_and_push.py" --config "$config_path" init
    created=1
  fi

  current_registry_url="$(sed -n 's|^[[:space:]]*registry_repo_url[[:space:]]*=[[:space:]]*"\(.*\)"[[:space:]]*$|\1|p' "$config_path" | head -n 1)"

  if [[ -z "$current_registry_url" ]]; then
    log_warn "Default producer config is missing registry_repo_url: $config_path"
    return
  fi

  if [[ "$created" -eq 1 || "$current_registry_url" == "$placeholder_registry_url" || "$current_registry_url" == "$registry_url" ]]; then
    sed -i "s|^[[:space:]]*registry_repo_url[[:space:]]*=.*$|registry_repo_url = \"$registry_url\"|" "$config_path"
    log_step "Default producer config registry_repo_url set to $registry_url"
    log_info "Remaining producer edits: signing_key, whitelist_hosts"
    log_info "Find signing_key with: gpg --list-secret-keys --keyid-format LONG"
  else
    log_warn "Default producer config already points to $current_registry_url; leaving it unchanged"
  fi
}

cmd_registry() {
  local owner="${1:-}"
  local repo="${2:-}"
  local ssh_alias="${3:-github.com}"
  local repo_dir="/tmp/$repo"
  local registry_public_url="https://github.com/$owner/$repo"
  local producer_config_path="$(producer_config_path_default)"

  if [[ -z "$owner" || -z "$repo" ]]; then
    log_error "Usage: ./setup.sh registry OWNER REPO [SSH_ALIAS]"
    echo
    echo "  OWNER: your GitHub username"
    echo "  REPO:  registry repository name"
    echo "  SSH_ALIAS: (optional) SSH config alias to use for git (default: github.com)"
    exit 1
  fi

  log_header "Registry Setup for $owner/$repo"
  log_info "Checking dependencies..."
  ensure_command_dependencies "Registry bootstrap" git python3 ssh
  
  log_info "Step 1: Create GitHub repository"
  echo -e "${DIM}  1. Go to https://github.com/new${RESET}"
  echo -e "${DIM}  2. Repository name: $repo${RESET}"
  echo -e "${DIM}  3. Description: Central mirror registry${RESET}"
  echo -e "${DIM}  4. Visibility: Public${RESET}"
  echo -e "${DIM}  5. Click 'Create repository'${RESET}"
  echo
  read -p "  Press Enter when repository is created..."


  log_info "Step 2: Clone and setup branches"
  local clone_url="ssh://git@$ssh_alias/$owner/$repo.git"

  # Always remove old temp dir to avoid stale state
  if [[ -d "$repo_dir" ]]; then
    rm -rf "$repo_dir"
    log_info "Removed stale $repo_dir before cloning"
  fi

  git clone "$clone_url" "$repo_dir" || die "Failed to clone $clone_url"
  cd "$repo_dir"
  git remote set-url origin "$clone_url"

  # Ensure main branch exists
  if git ls-remote --exit-code --heads origin main >/dev/null 2>&1; then
    if git show-ref --verify --quiet refs/heads/main; then
      git checkout main
    else
      git checkout -b main --track origin/main
    fi
  else
    git checkout -b main
    git commit --allow-empty -m "Initial main branch"
    git push -u origin main
    log_step "Created and pushed main branch"
  fi

  for branch in requests registrations approvals deliveries; do
    if git ls-remote --exit-code --heads origin "$branch" >/dev/null 2>&1; then
      log_info "Branch $branch already exists on origin"
    else
      git checkout main
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
  "registry_url": "$registry_public_url",
  "api_base": "https://api.github.com/repos/$owner/$repo",
  "trusted_signers": [
    {
      "name": "Primary Producer",
      "fingerprint": "PRODUCER_GPG_FINGERPRINT_HERE",
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
  if git diff --cached --quiet -- registry-config.json; then
    log_info "Registry configuration already up to date"
  else
    git commit -m "Add registry configuration"
    git push -u origin main
    log_step "Registry configuration pushed"
  fi

  log_info "Step 4: Seed default producer config"
  seed_default_producer_config_from_registry "$producer_config_path" "$registry_public_url"

  echo
  log_header "Registry setup complete"
  log_info "Repository: $registry_public_url"
  log_info "Config file: $repo_dir/registry-config.json"
  log_info "Producer config: $producer_config_path"
}

producer_command_usage() {
  echo "Usage:"
  echo "  ./setup.sh producer [CONFIG_PATH]"
  echo "  ./setup.sh producer doctor [CONFIG_PATH]"
  echo "  ./setup.sh producer run-once [CONFIG_PATH]"
  echo "  ./setup.sh producer daemon [CONFIG_PATH]"
  echo "  ./setup.sh producer setup-system REGISTRY_REPO_URL SIGNING_KEY"
  echo "  ./setup.sh producer status"
  echo "  ./setup.sh producer logs [LINES]"
}

run_producer_cli_with_config() {
  local action="$1"
  local config_path="$2"
  shift 2

  ensure_command_dependencies "Producer setup" python3 git gpg httrack
  ensure_python_toml_support "Producer setup"

  if [[ ! -f "$config_path" ]]; then
    die "Producer config not found: $config_path"
  fi

  # Auto-migrate legacy /srv/ paths to user-writable XDG paths for non-root users.
  # Uses Python instead of sed to avoid | delimiter injection via $XDG_DATA_HOME.
  if [[ "${EUID:-$(id -u)}" -ne 0 ]] && grep -q '"/srv/mirror-' "$config_path" 2>/dev/null; then
    local xdg_data="${XDG_DATA_HOME:-$HOME/.local/share}/iranopasmigirim-producer"
    log_info "Migrating system paths to user-writable paths in config..."
    python3 - "$config_path" "$xdg_data" <<'PYEOF'
import sys
path, base = sys.argv[1], sys.argv[2]
text = open(path, encoding='utf-8').read()
text = text.replace('registry_repo_path = "/srv/mirror-registry"', f'registry_repo_path = "{base}/registry"')
text = text.replace('user_repos_root = "/srv/mirror-users"', f'user_repos_root = "{base}/users"')
open(path, 'w', encoding='utf-8').write(text)
PYEOF
    log_step "Config paths updated: $xdg_data/{registry,users}"
  fi

  log_info "Verifying producer script..."
  python3 -m py_compile "$SCRIPT_DIR/pusher/mirror_and_push.py"
  log_step "Producer syntax valid"

  python3 "$SCRIPT_DIR/pusher/mirror_and_push.py" \
    --config "$config_path" \
    "$action" \
    "$@"
}

cmd_producer_doctor() {
  local config_path="$1"
  local starter_config="$SCRIPT_DIR/pusher/mirror.toml.example"

  if [[ ! -f "$config_path" ]]; then
    log_header "Producer Config Bootstrap"
    log_info "Checking dependencies..."
    ensure_command_dependencies "Producer setup" python3 git gpg httrack
    ensure_python_toml_support "Producer setup"
    log_info "Config not found; creating starter config..."
    python3 "$SCRIPT_DIR/pusher/mirror_and_push.py" --config "$config_path" init
    log_step "Starter config created"
    log_info "Edit these fields before rerunning: registry_repo_url, signing_key, whitelist_hosts"
    log_info "Find signing_key with: gpg --list-secret-keys --keyid-format LONG"
    log_info "Config: $config_path"
    log_info "Starter template: $starter_config"
    return 0
  fi

  log_header "Producer Server Setup"
  
  log_info "Checking dependencies..."
  log_info "Running producer doctor..."
  run_producer_cli_with_config doctor "$config_path"
  log_step "Producer doctor completed"

  echo
  log_header "Producer setup complete"
  log_info "Config: $config_path"
  log_info "Run one cycle now: ./setup.sh producer run-once $config_path"
  log_info "Run in foreground: ./setup.sh producer daemon $config_path"
  log_info "Dedicated host setup: ./setup.sh producer setup-system <REGISTRY_REPO_URL> <SIGNING_KEY>"
}

cmd_producer_run_once() {
  local config_path="$1"

  log_header "Producer Run Once"
  log_info "Checking dependencies..."
  run_producer_cli_with_config run-once "$config_path"
}

cmd_producer_daemon() {
  local config_path="${1:-$HOME/.config/iranopasmigirim-producer/config.toml}"
  shift || true
  local interval=""

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --interval)
        [[ $# -ge 2 ]] || die "producer daemon --interval requires MINUTES"
        interval="$2"
        shift 2
        ;;
      --interval=*)
        interval="${1#--interval=}"
        shift
        ;;
      *)
        die "Unknown producer daemon argument: $1"
        ;;
    esac
  done

  if [[ -n "$interval" && ! "$interval" =~ ^[0-9]+$ ]]; then
    die "producer daemon --interval expects a positive integer"
  fi

  log_header "Producer Daemon"
  log_info "Checking dependencies..."
  if [[ -n "$interval" ]]; then
    run_producer_cli_with_config daemon "$config_path" --interval "$interval"
  else
    run_producer_cli_with_config daemon "$config_path"
  fi
}

cmd_producer_setup_system() {
  local registry_repo_url="${1:-}"
  local signing_key="${2:-}"

  if [[ -z "$registry_repo_url" || -z "$signing_key" ]]; then
    producer_command_usage
    die "producer setup-system requires REGISTRY_REPO_URL and SIGNING_KEY"
  fi

  log_header "Producer System Setup"
  log_info "Checking dependencies..."
  ensure_command_dependencies "Producer system setup" python3 git gpg httrack
  ensure_python_toml_support "Producer system setup"

  run_privileged python3 "$SCRIPT_DIR/pusher/mirror_and_push.py" \
    setup-system \
    --install-deps \
    --non-interactive \
    --registry-repo-url "$registry_repo_url" \
    --signing-key "$signing_key"
}

cmd_producer_status() {
  log_header "Producer Service Status"
  run_privileged systemctl status mirror.timer
}

cmd_producer_logs() {
  local lines="${1:-50}"

  [[ "$lines" =~ ^[0-9]+$ ]] || die "producer logs [LINES] expects a positive integer"

  log_header "Producer Service Logs"
  run_privileged journalctl -u mirror.service -n "$lines" --no-pager
}

cmd_producer() {
  local action="${1:-doctor}"
  local config_path=""

  case "$action" in
    doctor)
      config_path="${2:-$HOME/.config/iranopasmigirim-producer/config.toml}"
      cmd_producer_doctor "$config_path"
      ;;
    run-once)
      config_path="${2:-$HOME/.config/iranopasmigirim-producer/config.toml}"
      cmd_producer_run_once "$config_path"
      ;;
    daemon)
      if [[ "${2:-}" == --* || -z "${2:-}" ]]; then
        config_path="$HOME/.config/iranopasmigirim-producer/config.toml"
        cmd_producer_daemon "$config_path" "${@:2}"
      else
        config_path="$2"
        cmd_producer_daemon "$config_path" "${@:3}"
      fi
      ;;
    setup-system)
      cmd_producer_setup_system "${2:-}" "${3:-}"
      ;;
    status)
      cmd_producer_status
      ;;
    logs)
      cmd_producer_logs "${2:-50}"
      ;;
    help|-h|--help)
      producer_command_usage
      ;;
    *)
      cmd_producer_doctor "${1:-$HOME/.config/iranopasmigirim-producer/config.toml}"
      ;;
  esac
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

  log_info "Checking dependencies..."
  ensure_command_dependencies "Verification" node npm python3
  ensure_python_toml_support "Verification"

  log_info "Installing dependencies..."
  npm install --silent

  log_info "Running tests..."
  npm test || die "Tests failed"
  log_step "Extension tests passed"

  log_info "Running producer validation..."
  python3 -m py_compile pusher/mirror_and_push.py || die "Producer syntax invalid"
  log_step "Producer syntax valid"

  log_info "Running producer unit tests..."
  python3 -m unittest pusher.test_producer >/dev/null 2>&1 || die "Producer tests failed"
  log_step "Producer tests passed"

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
      cmd_registry "${2:-}" "${3:-}" "${4:-}"
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
