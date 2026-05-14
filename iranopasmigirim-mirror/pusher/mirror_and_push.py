#!/usr/bin/env python3
"""mirror_and_push.py

Phase 3 producer: request-driven, registry-based mirroring.

Flow per cycle:
  1. Pull registry repository branch.
  2. Read request documents from requests/*.json.
  3. Verify user ownership proof in user repo request branch.
  4. Mirror + sanitize approved request URLs.
  5. Push signed delivery commit to user's delivery branch.
  6. Write status/<requestId>.json back to registry and push signed update.
"""

from __future__ import annotations

import argparse
import fcntl
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import textwrap
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

DEFAULT_CONFIG = """# Mirror producer configuration (Phase 3)

# Registry repo (fixed producer-controlled inbox/outbox).
# Default paths are user-writable (XDG_DATA_HOME / ~/.local/share).
# For a dedicated system installation (root-provisioned), use /srv/mirror-registry
# and /srv/mirror-users instead, and run via ./setup.sh producer setup-system.
registry_repo_path = "~/.local/share/iranopasmigirim-producer/registry"
registry_repo_url = "https://github.com/your-org/mirror-registry"
registry_remote = "origin"
registry_branch = "registrations"
requests_subdir = "requests"
status_subdir = "status"

# Per-user local checkouts root.
user_repos_root = "~/.local/share/iranopasmigirim-producer/users"

# Delivery settings.
# Empty means write mirrored files at repository root (recommended).
delivery_subdir = ""
default_delivery_branch = "content"
default_entry_path = "index.html"

# Processing cadence for daemon mode.
interval_minutes = 15
max_requests_per_run = 10

# Signed commits.
# signing_key must be a GPG secret key id or full fingerprint that exists on
# this producer host. Find it with:
#   gpg --list-secret-keys --keyid-format LONG
# Copy the long id from the `sec` line, for example:
#   sec   ed25519/DD13EC3368AA05D1 ... -> signing_key = "0xDD13EC3368AA05D1"
signing_key = "YOUR_SIGNING_KEY_ID_HERE"
gpg_passphrase_env = "GPG_PASSPHRASE"

# Mirroring behavior.
user_agent = "Mozilla/5.0 (compatible; offline-mirror-bot/3.0)"
exclude_patterns = ["-*.zip", "-*.exe", "-*.dmg", "-*.pkg"]
min_files = 20
max_files = 5000

# Whitelist: only these hosts can be mirrored.
whitelist_hosts = [
  "bbc.com",
]

# Defense-in-depth rewrites inside already-whitelisted sites.
# These do not allow any extra sites. whitelist_hosts is the real allowlist.
# They only rewrite known payment and stream/media links to a blocked page so
# the mirror stays read-only even within allowed news sites.
block_stream_extensions = [".m3u8", ".mpd", ".ism/manifest", ".f4m", ".ts"]
block_payment_domains = [
  "zarinpal.com",
  "idpay.ir",
  "nextpay.org",
  "paypal.com",
  "stripe.com",
]

# Local repository housekeeping.
maintenance_interval_hours = 24
prune_after_days = 30
"""

SERVICE_TEMPLATE = """[Unit]
Description=Mirror producer request processor
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User={user}
Group={group}
WorkingDirectory={registry_repo_path}
EnvironmentFile=-/etc/mirror/secrets.env
ExecStart=/usr/local/bin/mirror_and_push.py --config {config_path} run-once
StandardOutput=journal
StandardError=journal
TimeoutStartSec=45m
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
PrivateDevices=true
ReadWritePaths={registry_repo_path} {user_repos_root}
"""

TIMER_TEMPLATE = """[Unit]
Description=Mirror producer timer

[Timer]
OnBootSec=2min
OnUnitActiveSec={interval_minutes}min
RandomizedDelaySec=60s
Persistent=true

[Install]
WantedBy=timers.target
"""


@dataclass
class Config:
    registry_repo_path: Path
    registry_repo_url: str
    registry_remote: str
    registry_branch: str
    requests_subdir: str
    status_subdir: str
    user_repos_root: Path
    delivery_subdir: str
    default_delivery_branch: str
    default_entry_path: str
    interval_minutes: int
    max_requests_per_run: int
    signing_key: str
    gpg_passphrase_env: str
    user_agent: str
    exclude_patterns: list[str]
    min_files: int
    max_files: int
    whitelist_hosts: list[str]
    maintenance_interval_hours: int
    prune_after_days: int
    block_stream_extensions: list[str]
    block_payment_domains: list[str]


@dataclass
class RequestDoc:
    request_id: str
    user_repo_url: str
    requested_url: str
    site_host: str
    ownership_branch: str
    ownership_challenge_path: str
    ownership_nonce: str
    delivery_branch: str
    delivery_manifest_path: str


def run(cmd: list[str], cwd: Path | None = None, check: bool = True, env: dict[str, str] | None = None):
    print(f"$ {' '.join(cmd)}", flush=True)
    return subprocess.run(cmd, cwd=str(cwd) if cwd else None, check=check, env=env)


def run_capture(cmd: list[str], cwd: Path | None = None, check: bool = True) -> str:
    print(f"$ {' '.join(cmd)}", flush=True)
    p = subprocess.run(
        cmd,
        cwd=str(cwd) if cwd else None,
        check=False,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    if check and p.returncode != 0:
        msg = (p.stderr or p.stdout or "command failed").strip()
        raise SystemExit(msg)
    return (p.stdout or "").strip()


def die(msg: str) -> None:
    raise SystemExit(msg)


def normalize_host(host: str) -> str:
    h = host.strip().lower()
    return h[4:] if h.startswith("www.") else h


def validate_target_url(url: str) -> str:
    u = urlparse(url.strip())
    if u.scheme != "https" or not u.netloc:
        die(f"invalid target URL: {url!r} (must be full https URL)")
    return url.strip()


def validate_branch_name(name: str) -> str:
    n = name.strip()
    if not n:
        die("branch cannot be empty")
    if n.startswith("-") or ".." in n or " " in n:
        die(f"invalid branch name: {name!r}")
    if n.endswith("/") or n.endswith(".") or "/." in n or n.startswith("."):
        die(f"invalid branch name: {name!r}")
    if any(ch in n for ch in ("~", "^", ":", "?", "*", "[", "\\")):
        die(f"invalid branch name: {name!r}")
    if "@{" in n or "//" in n:
        die(f"invalid branch name: {name!r}")
    return n


def validate_signing_key(key: str) -> str:
    k = key.strip().upper()
    if k.startswith("0X"):
        k = "0x" + k[2:]
    raw = k[2:] if k.startswith("0x") else k
    if not re.fullmatch(r"[0-9A-F]{8,40}", raw):
        die("signing-key must be 8-40 hex chars (optionally prefixed with 0x)")
    return k


def validate_repo_url(repo_url: str) -> str:
    v = repo_url.strip()
    if not v:
        die("repo-url cannot be empty")
    allowed_prefixes = ("https://", "ssh://", "git@")
    if not v.startswith(allowed_prefixes):
        die("repo-url looks invalid; expected https://, ssh://, or git@")
    return v


def validate_interval_minutes(value: int) -> int:
    if value < 1 or value > 1440:
        die("interval must be between 1 and 1440 minutes")
    return value


def replace_config_assignment(config_text: str, key: str, rendered_value: str) -> str:
    pattern = rf"(?m)^{re.escape(key)}\s*=\s*.*$"
    updated, count = re.subn(pattern, f"{key} = {rendered_value}", config_text, count=1)
    if count != 1:
        raise SystemExit(f"missing config key in template: {key}")
    return updated


def prompt_value(label: str, default: str) -> str:
    raw = input(f"{label} [{default}]: ").strip()
    return raw if raw else default


def prompt_validated(label: str, default: str, validator):
    while True:
        value = prompt_value(label, default)
        try:
            return validator(value)
        except SystemExit as exc:
            print(f"[input error] {exc}", flush=True)


def prompt_int(label: str, default: int, validator):
    while True:
        raw = prompt_value(label, str(default))
        try:
            return validator(int(raw))
        except ValueError:
            print("[input error] value must be an integer", flush=True)
        except SystemExit as exc:
            print(f"[input error] {exc}", flush=True)


def require_root() -> None:
    if os.geteuid() != 0:
        raise SystemExit("setup-system must run as root")


def parse_toml_text(content: str) -> dict:
    try:
        import tomllib  # type: ignore[attr-defined]
        return tomllib.loads(content)
    except Exception:
        try:
            import tomli  # type: ignore[import-not-found]
            return tomli.loads(content)
        except Exception as exc:
            raise SystemExit(
                "TOML parser unavailable. Use Python 3.11+ or install tomli: pip install tomli"
            ) from exc


def has_toml_parser() -> bool:
    try:
        import tomllib  # type: ignore[attr-defined]
        return True
    except Exception:
        try:
            import tomli  # type: ignore[import-not-found]
            return True
        except Exception:
            return False


def ensure_pip_for_active_python() -> None:
    check = subprocess.run(
        [sys.executable, "-m", "pip", "--version"],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    if check.returncode == 0:
        return

    bootstrap = subprocess.run(
        [sys.executable, "-m", "ensurepip", "--upgrade"],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    if bootstrap.returncode != 0:
        msg = (bootstrap.stderr or bootstrap.stdout or "ensurepip failed").strip()
        raise SystemExit(f"pip unavailable for active python: {msg}")


def install_tomli_for_active_python() -> None:
    ensure_pip_for_active_python()
    cmd = [sys.executable, "-m", "pip", "install", "tomli"]
    if os.geteuid() != 0:
        cmd.insert(4, "--user")
    run(cmd)


def load_config(path: Path) -> Config:
    raw = parse_toml_text(path.read_text(encoding="utf-8"))
    return Config(
        registry_repo_path=Path(str(raw["registry_repo_path"])).expanduser().resolve(),
        registry_repo_url=str(raw["registry_repo_url"]),
        registry_remote=str(raw.get("registry_remote", "origin")),
        registry_branch=str(raw.get("registry_branch", "registrations")),
        requests_subdir=str(raw.get("requests_subdir", "requests")),
        status_subdir=str(raw.get("status_subdir", "status")),
        user_repos_root=Path(str(raw.get("user_repos_root", "~/.local/share/iranopasmigirim-producer/users"))).expanduser().resolve(),
        delivery_subdir=str(raw.get("delivery_subdir", "")),
        default_delivery_branch=str(raw.get("default_delivery_branch", "content")),
        default_entry_path=str(raw.get("default_entry_path", "index.html")),
        interval_minutes=int(raw.get("interval_minutes", 15)),
        max_requests_per_run=int(raw.get("max_requests_per_run", 10)),
        signing_key=str(raw["signing_key"]),
        gpg_passphrase_env=str(raw.get("gpg_passphrase_env", "GPG_PASSPHRASE")),
        user_agent=str(raw.get("user_agent", "Mozilla/5.0 (compatible; offline-mirror-bot/3.0)")),
        exclude_patterns=[str(x) for x in raw.get("exclude_patterns", [])],
        min_files=int(raw.get("min_files", 20)),
        max_files=int(raw.get("max_files", 5000)),
        whitelist_hosts=[normalize_host(str(x)) for x in raw.get("whitelist_hosts", [])],
        maintenance_interval_hours=int(raw.get("maintenance_interval_hours", 24)),
        prune_after_days=int(raw.get("prune_after_days", 30)),
        block_stream_extensions=[str(x).lower() for x in raw.get("block_stream_extensions", [])],
        block_payment_domains=[str(x).lower() for x in raw.get("block_payment_domains", [])],
    )


def validate_config(cfg: Config) -> None:
    if not cfg.registry_repo_url.strip():
        die("registry_repo_url must be set")
    validate_repo_url(cfg.registry_repo_url)
    if cfg.interval_minutes < 1:
        die("interval_minutes must be >= 1")
    if cfg.max_requests_per_run < 1:
        die("max_requests_per_run must be >= 1")
    if cfg.min_files < 1 or cfg.max_files < cfg.min_files:
        die("min_files/max_files values are invalid")
    if cfg.maintenance_interval_hours < 1:
        die("maintenance_interval_hours must be >= 1")
    if cfg.prune_after_days < 1:
        die("prune_after_days must be >= 1")
    if not cfg.signing_key.strip():
        die("signing_key must be set")
    if not cfg.whitelist_hosts:
        die("whitelist_hosts must include at least one host")


def ensure_tools() -> None:
    required = ["httrack", "git", "gpg"]
    missing = [t for t in required if shutil.which(t) is None]
    if missing:
        raise SystemExit(f"missing required tools: {', '.join(missing)}")


def parse_github_repo_parts(repo_url: str) -> tuple[str, str]:
    v = repo_url.strip()
    m = re.match(r"^https://github\.com/([^/]+)/([^/]+?)(?:\.git)?$", v, flags=re.IGNORECASE)
    if m:
        return m.group(1), m.group(2)
    m = re.match(r"^git@github\.com:([^/]+)/([^/]+?)(?:\.git)?$", v, flags=re.IGNORECASE)
    if m:
        return m.group(1), m.group(2)
    m = re.match(r"^ssh://git@github\.com/([^/]+)/([^/]+?)(?:\.git)?$", v, flags=re.IGNORECASE)
    if m:
        return m.group(1), m.group(2)
    raise SystemExit(f"unsupported GitHub repo URL format: {repo_url}")


def sanitize_relpath(path: str) -> str:
    p = path.strip().replace("\\", "/")
    if not p or p.startswith("/") or ".." in p.split("/"):
        raise SystemExit(f"invalid repository relative path: {path!r}")
    return p


def user_repo_checkout_dir(cfg: Config, user_repo_url: str) -> Path:
    owner, repo = parse_github_repo_parts(user_repo_url)
    safe = f"{owner}__{repo}".lower()
    return cfg.user_repos_root / safe


def producer_lock_path(cfg: Config) -> Path:
    return cfg.registry_repo_path.parent / f".{cfg.registry_repo_path.name}.mirror_producer.lock"


def checkout_dir_contains_only_stale_lock(repo_path: Path) -> bool:
    try:
        children = list(repo_path.iterdir())
    except OSError:
        return False
    return len(children) == 1 and children[0].name == ".mirror_producer.lock" and children[0].is_file()


def ensure_repo_checkout(repo_url: str, repo_path: Path, branch: str, remote: str = "origin") -> None:
    repo_path.parent.mkdir(parents=True, exist_ok=True)
    if not (repo_path / ".git").is_dir():
        if repo_path.exists() and not repo_path.is_dir():
            raise SystemExit(f"checkout path exists and is not a directory: {repo_path}")
        if repo_path.is_dir() and checkout_dir_contains_only_stale_lock(repo_path):
            (repo_path / ".mirror_producer.lock").unlink()
        if repo_path.is_dir() and any(repo_path.iterdir()):
            raise SystemExit(
                f"checkout path exists but is not a git checkout and is not empty: {repo_path}. "
                "Move it aside or remove it before rerunning."
            )
        run(["git", "clone", repo_url, str(repo_path)])

    run(["git", "remote", "set-url", remote, repo_url], cwd=repo_path)
    run(["git", "fetch", remote, "--prune"], cwd=repo_path)

    remote_ref = f"{remote}/{branch}"
    check_branch = subprocess.run(
        ["git", "show-ref", "--verify", f"refs/remotes/{remote_ref}"],
        cwd=str(repo_path),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    if check_branch.returncode == 0:
        run(["git", "checkout", "-B", branch, remote_ref], cwd=repo_path)
    else:
        run(["git", "checkout", "-B", branch], cwd=repo_path)


def update_registry_checkout(cfg: Config) -> None:
    ensure_repo_checkout(
        repo_url=cfg.registry_repo_url,
        repo_path=cfg.registry_repo_path,
        branch=cfg.registry_branch,
        remote=cfg.registry_remote,
    )
    run(["git", "pull", "--ff-only", cfg.registry_remote, cfg.registry_branch], cwd=cfg.registry_repo_path)


def request_files(cfg: Config) -> list[Path]:
    req_root = cfg.registry_repo_path / cfg.requests_subdir
    if not req_root.is_dir():
        return []
    return sorted(req_root.rglob("*.json"))


def parse_request_doc(data: dict, cfg: Config) -> RequestDoc:
    if not isinstance(data, dict):
        raise SystemExit("request document is not an object")

    request_id = str(data.get("requestId", "")).strip()
    if not request_id or not re.fullmatch(r"[a-zA-Z0-9._:-]{6,128}", request_id):
        raise SystemExit("requestId is missing or invalid")

    user_repo_url = validate_repo_url(str(data.get("userRepoUrl", "")))
    requested_url = validate_target_url(str(data.get("requestedUrl", "")))

    site_host = normalize_host(str(data.get("siteHost", "")).strip())
    if not site_host:
        site_host = normalize_host(urlparse(requested_url).hostname or "")

    ownership = data.get("ownership", {})
    if not isinstance(ownership, dict):
        raise SystemExit("ownership block missing")

    ownership_branch = validate_branch_name(str(ownership.get("branch", "requests")))
    ownership_challenge_path = sanitize_relpath(str(ownership.get("challengePath", "")))
    ownership_nonce = str(ownership.get("nonce", "")).strip()
    if not ownership_nonce:
        raise SystemExit("ownership nonce missing")

    delivery = data.get("delivery", {})
    if not isinstance(delivery, dict):
        delivery = {}

    delivery_branch = str(delivery.get("branch", cfg.default_delivery_branch)).strip() or cfg.default_delivery_branch
    delivery_branch = validate_branch_name(delivery_branch)
    delivery_manifest_path = sanitize_relpath(str(delivery.get("manifestPath", "_mirror/manifest.json")))

    return RequestDoc(
        request_id=request_id,
        user_repo_url=user_repo_url,
        requested_url=requested_url,
        site_host=site_host,
        ownership_branch=ownership_branch,
        ownership_challenge_path=ownership_challenge_path,
        ownership_nonce=ownership_nonce,
        delivery_branch=delivery_branch,
        delivery_manifest_path=delivery_manifest_path,
    )


def is_host_allowed(site_host: str, cfg: Config) -> bool:
    return normalize_host(site_host) in set(cfg.whitelist_hosts)


def git_show_remote_file(repo_path: Path, remote: str, branch: str, relpath: str) -> str | None:
    rel = sanitize_relpath(relpath)
    run(["git", "fetch", remote, branch], cwd=repo_path)
    ref = f"{remote}/{branch}:{rel}"
    p = subprocess.run(
        ["git", "show", ref],
        cwd=str(repo_path),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    if p.returncode != 0:
        return None
    return p.stdout


def advisory_safety_note() -> None:
    print(
        "[note] Producer enforces whitelist + ownership proof + fail-closed sanitization. "
        "This reduces risk but does not guarantee zero abuse in all conditions.",
        flush=True,
    )


def scrape_site(cfg: Config, target_url: str, stage_dir: Path) -> Path:
    host = urlparse(target_url).netloc
    cmd = [
        "httrack",
        target_url,
        "-O",
        str(stage_dir),
        "--robots=0",
        "-%v0",
        "-n",
        "--update",
        f"+*{host.rstrip('/')}/*",
        "-F",
        cfg.user_agent,
    ] + cfg.exclude_patterns
    run(cmd, check=False)

    candidates = [p for p in stage_dir.iterdir() if p.is_dir() and not p.name.startswith("hts-")]
    if not candidates:
        raise SystemExit("scrape produced no host directory")
    return max(candidates, key=lambda p: sum(1 for _ in p.rglob("*")))


def clear_scraper_control_files(content_dir: Path) -> None:
    for name in ("hts-log.txt", "cookies.txt", "hts-cache"):
        p = content_dir / name
        if p.is_file():
            p.unlink()
        elif p.is_dir():
            shutil.rmtree(p)


def is_payment_url(url: str, blocked_domains: list[str]) -> bool:
    try:
        parsed = urlparse(url)
        host = (parsed.hostname or "").strip().lower()
    except Exception:
        return False
    if not host:
        return False
    host = host[4:] if host.startswith("www.") else host
    domains = [d.strip().lower() for d in blocked_domains if d and d.strip()]
    for domain in domains:
        if host == domain or host.endswith("." + domain):
            return True
    return False


def is_stream_url(url: str, blocked_exts: list[str]) -> bool:
    try:
        path = urlparse(url).path.lower()
    except Exception:
        return False
    exts = [ext.strip().lower() for ext in blocked_exts if ext and ext.strip()]
    return any(path.endswith(ext) for ext in exts)


def sanitize_html_text(html: str, cfg: Config) -> str:
    html = re.sub(r"<script\b[^>]*>.*?</script>", "", html, flags=re.IGNORECASE | re.DOTALL)
    html = re.sub(r"<(iframe|object|embed)\b[^>]*>.*?</\1>", "", html, flags=re.IGNORECASE | re.DOTALL)
    html = re.sub(r"\son[a-z]+\s*=\s*([\"']).*?\1", "", html, flags=re.IGNORECASE | re.DOTALL)
    html = re.sub(r"\son[a-z]+\s*=\s*[^\s>]+", "", html, flags=re.IGNORECASE)
    html = re.sub(
        r"<meta\b([^>]*?)http-equiv\s*=\s*([\"']?)refresh\2([^>]*)>",
        "",
        html,
        flags=re.IGNORECASE,
    )

    # Strip srcset attributes entirely (multi-URL format; responsive images are
    # inert without scripts and complicate URL scanning).
    html = re.sub(r"""\s+srcset\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*)""", " ", html, flags=re.IGNORECASE)

    # Rewrite form tags: strip any existing action/formaction first, then inject
    # the blocked action.  Without stripping, the browser uses the FIRST action
    # attribute in the tag — meaning the original unsafe action would win.
    def _sanitize_form_tag(m: re.Match[str]) -> str:
        tag = m.group(0)
        tag = re.sub(
            r"""\s+(?:action|formaction)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*)""",
            " ",
            tag,
            flags=re.IGNORECASE,
        )
        return re.sub(
            r"<form\b",
            '<form action="/__mirror_blocked.html?reason=form" method="get" onsubmit="return false;"',
            tag,
            count=1,
            flags=re.IGNORECASE,
        )

    html = re.sub(r"<form\b[^>]*>", _sanitize_form_tag, html, flags=re.IGNORECASE)

    # formaction and ping also carry navigation URLs and must be rewritten.
    attr_re = re.compile(r"\b(href|src|poster|formaction|ping)\s*=\s*([\"'])([^\"']+)\2", re.IGNORECASE)

    def replace_attr(match: re.Match[str]) -> str:
        attr, quote, value = match.group(1), match.group(2), match.group(3)
        lower_value = value.strip().lower()
        if lower_value.startswith("javascript:") or lower_value.startswith("data:text/html"):
            return f'{attr}={quote}/__mirror_blocked.html?reason=active-content{quote}'
        if is_payment_url(value, cfg.block_payment_domains):
            return f'{attr}={quote}/__mirror_blocked.html?reason=payment{quote}'
        if is_stream_url(value, cfg.block_stream_extensions):
            return f'{attr}={quote}/__mirror_blocked.html?reason=stream{quote}'
        return match.group(0)

    return attr_re.sub(replace_attr, html)


def write_blocked_page(content_dir: Path) -> None:
    page = textwrap.dedent(
        """\
        <!doctype html>
        <meta charset="utf-8">
        <title>Unavailable in mirror</title>
        <style>
          body{font-family:system-ui,sans-serif;max-width:720px;margin:48px auto;padding:0 16px;line-height:1.6}
          .card{border:1px solid #ddd;border-radius:10px;padding:18px}
          h1{margin-top:0}
        </style>
        <div class="card">
          <h1>This action is disabled in the mirror</h1>
          <p>Interactive actions (payments, forms, live/stream URLs) are intentionally blocked in this read-only mirror.</p>
          <p>Please use trusted direct channels for critical actions.</p>
        </div>
        """
    )
    (content_dir / "__mirror_blocked.html").write_text(page, encoding="utf-8")


def sanitize_content(content_dir: Path, cfg: Config) -> None:
    clear_scraper_control_files(content_dir)
    write_blocked_page(content_dir)
    for path in content_dir.rglob("*"):
        if not path.is_file():
            continue
        if path.suffix.lower() not in {".html", ".htm", ".xhtml"}:
            continue
        try:
            src = path.read_text(encoding="utf-8", errors="ignore")
            out = sanitize_html_text(src, cfg)
            if out != src:
                path.write_text(out, encoding="utf-8")
        except Exception as exc:
            print(f"[warn] sanitize failed for {path}: {exc}", flush=True)


def count_files(root: Path) -> int:
    return sum(1 for p in root.rglob("*") if p.is_file())


def git_has_remote_branch(repo_path: Path, remote: str, branch: str) -> bool:
    p = subprocess.run(
        ["git", "show-ref", "--verify", f"refs/remotes/{remote}/{branch}"],
        cwd=str(repo_path),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    return p.returncode == 0


def prepare_delivery_branch(repo_path: Path, remote: str, branch: str) -> None:
    run(["git", "fetch", remote, "--prune"], cwd=repo_path)
    if git_has_remote_branch(repo_path, remote, branch):
        run(["git", "checkout", "-B", branch, f"{remote}/{branch}"], cwd=repo_path)
    else:
        run(["git", "checkout", "--orphan", branch], cwd=repo_path)
        run(["git", "rm", "-rf", "."], cwd=repo_path, check=False)


def write_manifest(staging_root: Path, req: RequestDoc, cfg: Config) -> None:
    manifest_path = staging_root / sanitize_relpath(req.delivery_manifest_path)
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest = {
        "requestId": req.request_id,
        "siteHost": normalize_host(req.site_host),
        "sourceUrl": req.requested_url,
        "entryPath": cfg.default_entry_path,
        "producer": "mirror_and_push.py",
        "producedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "protocolVersion": 1,
    }
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=True, indent=2) + "\n", encoding="utf-8")


def sync_tree(src_root: Path, dst_root: Path) -> None:
    if dst_root.exists():
        shutil.rmtree(dst_root)
    shutil.copytree(src_root, dst_root)


def replace_repo_working_tree(src_root: Path, repo_root: Path) -> None:
    for child in repo_root.iterdir():
        if child.name == ".git":
            continue
        if child.is_dir():
            shutil.rmtree(child)
        else:
            child.unlink()
    for src_child in src_root.iterdir():
        dst = repo_root / src_child.name
        if src_child.is_dir():
            shutil.copytree(src_child, dst)
        else:
            shutil.copy2(src_child, dst)


def stage_commit_and_push(repo_path: Path, remote: str, branch: str, signing_key: str, pass_env: str, message: str) -> str:
    run(["git", "add", "-A"], cwd=repo_path)
    diff = subprocess.run(["git", "diff", "--cached", "--quiet"], cwd=str(repo_path))
    if diff.returncode == 0:
        head = run_capture(["git", "rev-parse", "HEAD"], cwd=repo_path)
        return head

    env = os.environ.copy()
    passphrase = os.environ.get(pass_env)
    if passphrase:
        env[pass_env] = passphrase
    run(["git", "commit", "-S", f"--gpg-sign={signing_key}", "-m", message], cwd=repo_path, env=env)
    run(["git", "push", remote, f"HEAD:{branch}"], cwd=repo_path)
    return run_capture(["git", "rev-parse", "HEAD"], cwd=repo_path)


def current_head_sha(repo_path: Path) -> str | None:
    p = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=str(repo_path),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    if p.returncode != 0:
        return None
    head = (p.stdout or "").strip()
    return head or None


def rollback_delivery_checkout(repo_path: Path, head_before: str | None) -> None:
    if head_before:
        run(["git", "reset", "--hard", head_before], cwd=repo_path, check=False)
    run(["git", "clean", "-fd"], cwd=repo_path, check=False)


def stage_commit_and_push_with_rollback(
    repo_path: Path,
    remote: str,
    branch: str,
    signing_key: str,
    pass_env: str,
    message: str,
) -> str:
    head_before = current_head_sha(repo_path)
    try:
        return stage_commit_and_push(repo_path, remote, branch, signing_key, pass_env, message)
    except Exception:
        rollback_delivery_checkout(repo_path, head_before)
        raise


def process_single_request(cfg: Config, req: RequestDoc) -> dict:
    status = {
        "requestId": req.request_id,
        "state": "pending",
        "reason": "waiting",
        "updatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "userRepoUrl": req.user_repo_url,
        "siteHost": normalize_host(req.site_host),
        "deliveryBranch": req.delivery_branch,
        "commitSha": None,
        "ownershipVerified": False,
    }

    if not is_host_allowed(req.site_host, cfg):
        status["state"] = "rejected"
        status["reason"] = f"host not in whitelist: {normalize_host(req.site_host)}"
        return status

    user_repo_path = user_repo_checkout_dir(cfg, req.user_repo_url)
    ensure_repo_checkout(req.user_repo_url, user_repo_path, req.delivery_branch)

    proof = git_show_remote_file(
        repo_path=user_repo_path,
        remote="origin",
        branch=req.ownership_branch,
        relpath=req.ownership_challenge_path,
    )
    if proof is None:
        status["state"] = "pending"
        status["reason"] = "ownership proof file not found"
        return status

    if proof.strip() != req.ownership_nonce:
        status["state"] = "pending"
        status["reason"] = "ownership nonce mismatch"
        return status

    status["ownershipVerified"] = True

    try:
        with tempfile.TemporaryDirectory(prefix=f"mirror_req_{req.request_id}_") as td:
            stage = Path(td)
            host_dir = scrape_site(cfg, req.requested_url, stage)
            sanitize_content(host_dir, cfg)
            files = count_files(host_dir)
            if files < cfg.min_files:
                status["state"] = "error"
                status["reason"] = f"scrape sanity check failed: only {files} files"
                return status
            if files > cfg.max_files:
                status["state"] = "error"
                status["reason"] = f"scrape sanity check failed: {files} files"
                return status

            prepare_delivery_branch(user_repo_path, "origin", req.delivery_branch)

            if cfg.delivery_subdir.strip():
                delivery_root = user_repo_path / cfg.delivery_subdir.strip()
                sync_tree(host_dir, delivery_root)
                write_manifest(delivery_root, req, cfg)
            else:
                replace_repo_working_tree(host_dir, user_repo_path)
                write_manifest(user_repo_path, req, cfg)

            commit_sha = stage_commit_and_push_with_rollback(
                repo_path=user_repo_path,
                remote="origin",
                branch=req.delivery_branch,
                signing_key=cfg.signing_key,
                pass_env=cfg.gpg_passphrase_env,
                message=f"deliver: {req.request_id} {datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')}",
            )
    except Exception as exc:  # noqa: BLE001
        status["state"] = "error"
        status["reason"] = f"delivery failed and rolled back: {exc}"
        return status

    status["state"] = "approved"
    status["reason"] = "delivered"
    status["commitSha"] = commit_sha
    return status


def status_file_path(cfg: Config, request_id: str) -> Path:
    safe_id = re.sub(r"[^a-zA-Z0-9._:-]", "_", request_id)
    return cfg.registry_repo_path / cfg.status_subdir / f"{safe_id}.json"


def write_status(cfg: Config, status: dict) -> None:
    p = status_file_path(cfg, str(status.get("requestId", "unknown")))
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(status, ensure_ascii=True, indent=2) + "\n", encoding="utf-8")


def stage_and_push_registry_status(cfg: Config) -> bool:
    run(["git", "add", "-A", cfg.status_subdir], cwd=cfg.registry_repo_path)
    diff = subprocess.run(["git", "diff", "--cached", "--quiet"], cwd=str(cfg.registry_repo_path))
    if diff.returncode == 0:
        print("no registry status changes", flush=True)
        return False

    env = os.environ.copy()
    passphrase = os.environ.get(cfg.gpg_passphrase_env)
    if passphrase:
        env[cfg.gpg_passphrase_env] = passphrase

    msg = "registry status update " + datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    run(["git", "commit", "-S", f"--gpg-sign={cfg.signing_key}", "-m", msg], cwd=cfg.registry_repo_path, env=env)
    run(["git", "push", cfg.registry_remote, f"HEAD:{cfg.registry_branch}"], cwd=cfg.registry_repo_path)
    return True


def repo_maintenance_due(marker_path: Path, interval_hours: int, now_s: int | None = None) -> bool:
    now = int(time.time() if now_s is None else now_s)
    if not marker_path.is_file():
        return True
    try:
        last = int(marker_path.read_text(encoding="utf-8").strip() or "0")
    except Exception:
        return True
    return (now - last) >= (interval_hours * 3600)


def run_repo_maintenance(repo_path: Path, interval_hours: int, prune_after_days: int) -> None:
    marker = repo_path / ".mirror_last_maintenance"
    if not repo_maintenance_due(marker, interval_hours):
        return
    prune = f"--prune={prune_after_days}.days.ago"
    expire = f"--expire={prune_after_days}.days.ago"
    try:
        run(["git", "reflog", "expire", expire, "--all"], cwd=repo_path)
        run(["git", "gc", "--auto", prune], cwd=repo_path)
        marker.write_text(str(int(time.time())), encoding="utf-8")
    except Exception as exc:  # noqa: BLE001
        print(f"[warn] maintenance skipped for {repo_path}: {exc}", flush=True)


def run_once(cfg: Config) -> int:
    validate_config(cfg)
    ensure_tools()

    update_registry_checkout(cfg)
    files = request_files(cfg)
    if not files:
        print("no requests found", flush=True)
        return 0

    processed = 0
    for req_path in files:
        if processed >= cfg.max_requests_per_run:
            break

        try:
            payload = json.loads(req_path.read_text(encoding="utf-8"))
            req = parse_request_doc(payload, cfg)
        except Exception as exc:  # noqa: BLE001
            # Best-effort request ID fallback from filename.
            fallback_id = req_path.stem
            status = {
                "requestId": fallback_id,
                "state": "rejected",
                "reason": f"invalid request document: {exc}",
                "updatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                "userRepoUrl": None,
                "siteHost": None,
                "deliveryBranch": cfg.default_delivery_branch,
                "commitSha": None,
                "ownershipVerified": False,
            }
            write_status(cfg, status)
            processed += 1
            continue

        existing_status_path = status_file_path(cfg, req.request_id)
        if existing_status_path.is_file():
            try:
                existing = json.loads(existing_status_path.read_text(encoding="utf-8"))
                if existing.get("state") == "approved" and existing.get("commitSha"):
                    continue
            except Exception:
                pass

        status = process_single_request(cfg, req)
        write_status(cfg, status)
        processed += 1

    changed = stage_and_push_registry_status(cfg)
    run_repo_maintenance(cfg.registry_repo_path, cfg.maintenance_interval_hours, cfg.prune_after_days)

    if cfg.user_repos_root.is_dir():
        for repo_dir in cfg.user_repos_root.iterdir():
            if (repo_dir / ".git").is_dir():
                run_repo_maintenance(repo_dir, cfg.maintenance_interval_hours, cfg.prune_after_days)

    print("completed with status updates" if changed else "completed without status updates", flush=True)
    return 0


def acquire_lock(lock_path: Path):
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    fh = lock_path.open("w", encoding="utf-8")
    try:
        fcntl.flock(fh.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        raise SystemExit(f"another instance is running (lock: {lock_path})")
    fh.write(str(os.getpid()))
    fh.flush()
    return fh


def run_as_user(user: str, cmd: list[str], cwd: Path | None = None, check: bool = True) -> subprocess.CompletedProcess:
    if shutil.which("runuser"):
        wrapped = ["runuser", "-u", user, "--"] + cmd
        return run(wrapped, cwd=cwd, check=check)
    if shutil.which("sudo"):
        wrapped = ["sudo", "-u", user] + cmd
        return run(wrapped, cwd=cwd, check=check)
    raise SystemExit("runuser/sudo is required to execute commands as the mirror user")


def ensure_gpg_loopback(user: str) -> None:
    """Write allow-loopback-pinentry to the mirror user's gpg-agent.conf so that
    a passphrase set via GPG_PASSPHRASE env can be forwarded to gpg in a headless
    systemd service without a TTY/pinentry dialog."""
    import pwd as _pwd
    try:
        entry = _pwd.getpwnam(user)
    except KeyError:
        print(f"[warn] user {user!r} not found; skipping gpg-agent.conf setup", flush=True)
        return
    gnupg_dir = Path(entry.pw_dir) / ".gnupg"
    agent_conf = gnupg_dir / "gpg-agent.conf"
    if agent_conf.is_file():
        text = agent_conf.read_text(encoding="utf-8")
        if "allow-loopback-pinentry" in text:
            return
        agent_conf.write_text(text.rstrip() + "\nallow-loopback-pinentry\n", encoding="utf-8")
    else:
        gnupg_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
        agent_conf.write_text("allow-loopback-pinentry\n", encoding="utf-8")
        os.chmod(agent_conf, 0o600)
    run(["chown", "-R", f"{user}:{user}", str(gnupg_dir)], check=False)
    print(f"gpg-agent.conf allow-loopback-pinentry configured for {user}", flush=True)


def ensure_system_user(user: str, group: str) -> None:
    import pwd

    try:
        pwd.getpwnam(user)
    except KeyError:
        run(["useradd", "-r", "-m", "-s", "/usr/sbin/nologin", user])

    if group != user:
        run(["groupadd", "-f", group], check=False)
        run(["usermod", "-a", "-G", group, user], check=False)


def install_binary_from_self() -> None:
    src = Path(__file__).resolve()
    dest = Path("/usr/local/bin/mirror_and_push.py")
    shutil.copy2(src, dest)
    os.chmod(dest, 0o755)


def detect_linux_package_manager() -> str | None:
    for manager in ("apt-get", "dnf", "yum", "pacman", "zypper", "apk"):
        if shutil.which(manager):
            return manager
    return None


def package_names_for_tools(package_manager: str, tools: list[str]) -> list[str]:
    package_map = {
        "apt-get": {
            "python3": "python3",
            "git": "git",
            "gpg": "gnupg",
            "httrack": "httrack",
            "tomli": "python3-tomli",
        },
        "dnf": {
            "python3": "python3",
            "git": "git",
            "gpg": "gnupg2",
            "httrack": "httrack",
            "tomli": "python3-tomli",
        },
        "yum": {
            "python3": "python3",
            "git": "git",
            "gpg": "gnupg2",
            "httrack": "httrack",
            "tomli": "python3-tomli",
        },
        "pacman": {
            "python3": "python",
            "git": "git",
            "gpg": "gnupg",
            "httrack": "httrack",
            "tomli": "python-tomli",
        },
        "zypper": {
            "python3": "python3",
            "git": "git",
            "gpg": "gpg2",
            "httrack": "httrack",
            "tomli": "python3-tomli",
        },
        "apk": {
            "python3": "python3",
            "git": "git",
            "gpg": "gnupg",
            "httrack": "httrack",
            "tomli": "py3-tomli",
        },
    }
    manager_map = package_map.get(package_manager)
    if manager_map is None:
        raise SystemExit(f"unsupported package manager for --install-deps: {package_manager}")

    packages: list[str] = []
    seen: set[str] = set()
    for tool in tools:
        package_name = manager_map.get(tool, tool)
        if package_name not in seen:
            packages.append(package_name)
            seen.add(package_name)
    return packages


def maybe_install_deps() -> None:
    package_manager = detect_linux_package_manager()
    if package_manager is None:
        raise SystemExit("--install-deps requested but no supported Linux package manager was found")

    required_tools = ["python3", "git", "gpg", "httrack"]
    if not has_toml_parser():
        required_tools.append("tomli")

    packages = package_names_for_tools(package_manager, required_tools)

    if package_manager == "apt-get":
        run(["apt-get", "update"])
        run(["apt-get", "install", "-y", "--no-install-recommends", *packages])
    elif package_manager == "dnf":
        run(["dnf", "makecache", "-y"])
        run(["dnf", "install", "-y", *packages])
    elif package_manager == "yum":
        run(["yum", "makecache", "-y"])
        run(["yum", "install", "-y", *packages])
    elif package_manager == "pacman":
        run(["pacman", "-Sy", "--noconfirm"])
        run(["pacman", "-S", "--needed", "--noconfirm", *packages])
    elif package_manager == "zypper":
        run(["zypper", "--non-interactive", "refresh"])
        run(["zypper", "--non-interactive", "install", "--no-recommends", *packages])
    elif package_manager == "apk":
        run(["apk", "update"])
        run(["apk", "add", "--no-cache", *packages])
    else:
        raise SystemExit(f"unsupported package manager for --install-deps: {package_manager}")

    if not has_toml_parser():
        install_tomli_for_active_python()


def write_default_secrets_file() -> None:
    path = Path("/etc/mirror/secrets.env")
    if path.exists():
        return
    content = "# Optional. Set if your key is passphrase-protected.\nGPG_PASSPHRASE=\n"
    write_file(path, content, mode=0o600)


def install_systemd_units(config_path: Path, cfg: Config, user: str, group: str) -> None:
    service = SERVICE_TEMPLATE.format(
        user=user,
        group=group,
        registry_repo_path=str(cfg.registry_repo_path),
        user_repos_root=str(cfg.user_repos_root),
        config_path=str(config_path),
    )
    timer = TIMER_TEMPLATE.format(interval_minutes=cfg.interval_minutes)
    write_file(Path("/etc/systemd/system/mirror.service"), service, mode=0o644)
    write_file(Path("/etc/systemd/system/mirror.timer"), timer, mode=0o644)


def cmd_init(args: argparse.Namespace) -> int:
    path = Path(args.config).expanduser().resolve()
    if path.exists() and not args.force:
        raise SystemExit(f"config exists: {path} (use --force to overwrite)")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(DEFAULT_CONFIG, encoding="utf-8")
    print(f"wrote config: {path}")
    return 0


def cmd_doctor(args: argparse.Namespace) -> int:
    cfg = load_config(Path(args.config))
    validate_config(cfg)
    ensure_tools()
    run(["git", "ls-remote", "--heads", cfg.registry_repo_url, cfg.registry_branch])
    run(["gpg", "--list-secret-keys", cfg.signing_key])
    print("doctor checks completed")
    return 0


def cmd_run_once(args: argparse.Namespace) -> int:
    cfg = load_config(Path(args.config))
    lock_path = producer_lock_path(cfg)
    lock = acquire_lock(lock_path)
    advisory_safety_note()
    try:
        return run_once(cfg)
    finally:
        lock.close()


def cmd_daemon(args: argparse.Namespace) -> int:
    cfg = load_config(Path(args.config))
    interval_minutes = cfg.interval_minutes
    if args.interval is not None:
        interval_minutes = validate_interval_minutes(args.interval)
    lock_path = producer_lock_path(cfg)
    lock = acquire_lock(lock_path)
    advisory_safety_note()  # print once at daemon start, not every cycle
    if args.interval is not None:
        print(f"[daemon] using interval override: {interval_minutes} minute(s)", flush=True)
    try:
        while True:
            start = time.time()
            try:
                run_once(cfg)
            except Exception as exc:  # noqa: BLE001
                print(f"[error] run failed: {exc}", flush=True)
            elapsed = time.time() - start
            sleep_s = max(5, interval_minutes * 60 - int(elapsed))
            print(f"sleeping {sleep_s}s", flush=True)
            time.sleep(sleep_s)
    finally:
        lock.close()


def cmd_setup_system(args: argparse.Namespace) -> int:
    require_root()

    if args.interactive:
        print("[setup] interactive mode enabled", flush=True)
        args.registry_repo_url = prompt_validated("Registry repo URL", args.registry_repo_url, validate_repo_url)
        args.registry_branch = prompt_validated("Registry branch", args.registry_branch, validate_branch_name)
        args.signing_key = prompt_validated("GPG signing key", args.signing_key, validate_signing_key)
        args.registry_repo_path = prompt_value("Local registry repo path", args.registry_repo_path)
        args.user_repos_root = prompt_value("Local user repos root", args.user_repos_root)
        args.interval = prompt_int("Interval minutes", args.interval, validate_interval_minutes)
    else:
        if not args.registry_repo_url:
            die("--registry-repo-url is required in non-interactive mode")
        if not args.signing_key:
            die("--signing-key is required in non-interactive mode")
        args.registry_repo_url = validate_repo_url(args.registry_repo_url)
        args.registry_branch = validate_branch_name(args.registry_branch)
        args.signing_key = validate_signing_key(args.signing_key)
        args.interval = validate_interval_minutes(args.interval)

    if args.install_deps:
        maybe_install_deps()

    registry_repo_path = Path(args.registry_repo_path).expanduser().resolve()
    user_repos_root = Path(args.user_repos_root).expanduser().resolve()
    config_path = Path(args.config).expanduser().resolve()

    ensure_system_user(args.user, args.group)
    ensure_gpg_loopback(args.user)
    ensure_repo_checkout(args.registry_repo_url, registry_repo_path, args.registry_branch)
    user_repos_root.mkdir(parents=True, exist_ok=True)
    run(["chown", "-R", f"{args.user}:{args.group}", str(registry_repo_path)])
    run(["chown", "-R", f"{args.user}:{args.group}", str(user_repos_root)])
    install_binary_from_self()

    config_text = DEFAULT_CONFIG
    config_text = replace_config_assignment(config_text, 'registry_repo_path', json.dumps(str(registry_repo_path)))
    config_text = replace_config_assignment(config_text, 'registry_repo_url', json.dumps(args.registry_repo_url))
    config_text = replace_config_assignment(config_text, 'registry_branch', json.dumps(args.registry_branch))
    config_text = replace_config_assignment(config_text, 'user_repos_root', json.dumps(str(user_repos_root)))
    config_text = replace_config_assignment(config_text, 'signing_key', json.dumps(args.signing_key))
    config_text = replace_config_assignment(config_text, 'interval_minutes', str(args.interval))

    write_file(config_path, config_text, mode=0o640)
    run(["chown", "root:root", str(config_path)])

    write_default_secrets_file()

    cfg = load_config(config_path)
    install_systemd_units(config_path, cfg, args.user, args.group)
    run(["systemctl", "daemon-reload"])

    run_as_user(args.user, ["/usr/local/bin/mirror_and_push.py", "--config", str(config_path), "doctor"], check=False)

    if args.enable_timer:
        run(["systemctl", "enable", "--now", "mirror.timer"])
        print("setup complete: timer enabled", flush=True)
    else:
        print("setup complete: timer not enabled (use systemctl enable --now mirror.timer)", flush=True)
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Mirror producer app")
    p.add_argument("--config", default="/etc/mirror/mirror.toml", help="path to config TOML")

    sub = p.add_subparsers(dest="command", required=True)

    init_p = sub.add_parser("init", help="write a starter config")
    init_p.add_argument("--force", action="store_true", help="overwrite existing config")
    init_p.set_defaults(func=cmd_init)

    doc_p = sub.add_parser("doctor", help="check dependencies and configuration")
    doc_p.set_defaults(func=cmd_doctor)

    run_p = sub.add_parser("run-once", help="run one processing cycle")
    run_p.set_defaults(func=cmd_run_once)

    daemon_p = sub.add_parser("daemon", help="run forever with interval_minutes cadence")
    daemon_p.add_argument("--interval", type=int, default=None,
                          help="override minutes between runs for this process only")
    daemon_p.set_defaults(func=cmd_daemon)

    setup_p = sub.add_parser("setup-system", help="one-command deterministic system setup (root)")
    setup_p.add_argument("--registry-repo-url", default="", help="git URL of registry repo")
    setup_p.add_argument("--registry-repo-path", default="/srv/mirror-registry", help="local registry repo path")
    setup_p.add_argument("--user-repos-root", default="/srv/mirror-users", help="local root for user repo checkouts")
    setup_p.add_argument("--signing-key", default="", help="GPG signing key id")
    setup_p.add_argument("--registry-branch", default="registrations", help="registry branch to watch/write")
    setup_p.add_argument("--interval", type=int, default=15, help="minutes between processor runs")
    setup_p.add_argument("--user", default="mirror", help="system user for mirror service")
    setup_p.add_argument("--group", default="mirror", help="system group for mirror service")
    setup_p.add_argument("--install-deps", action="store_true", help="install apt dependencies")
    setup_p.add_argument("--interactive", action="store_true", default=True,
                         help="prompt interactively for required values (default)")
    setup_p.add_argument("--non-interactive", dest="interactive", action="store_false",
                         help="do not prompt; require all necessary flags")
    setup_p.add_argument("--enable-timer", dest="enable_timer", action="store_true", default=True,
                         help="enable and start mirror.timer")
    setup_p.add_argument("--no-enable-timer", dest="enable_timer", action="store_false",
                         help="do not enable timer automatically")
    setup_p.set_defaults(func=cmd_setup_system)
    return p


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    try:
        return int(args.func(args))
    except BrokenPipeError:
        # A downstream consumer like `grep -m1` can close the pipe after it has
        # seen enough output. Redirect remaining flushes to /dev/null so Python
        # exits quietly instead of printing a traceback during shutdown.
        devnull_fd = os.open(os.devnull, os.O_WRONLY)
        try:
            os.dup2(devnull_fd, sys.stdout.fileno())
            os.dup2(devnull_fd, sys.stderr.fileno())
        finally:
            os.close(devnull_fd)
        return 141
    except subprocess.CalledProcessError as exc:
        cmd = " ".join(exc.cmd) if isinstance(exc.cmd, list) else str(exc.cmd)
        print(f"[error] command failed ({exc.returncode}): {cmd}", file=sys.stderr)
        return int(exc.returncode or 1)
    except KeyboardInterrupt:
        print("\n[error] interrupted by user", file=sys.stderr)
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
