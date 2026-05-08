#!/usr/bin/env python3
"""mirror_and_push.py

Producer-side mirror app.

This CLI is intentionally single-file and stdlib-heavy for easier auditing.
It supports:
  - init: guided config bootstrap
  - doctor: prerequisite checks
  - run-once: scrape -> sanitize -> signed commit -> push
  - daemon: periodic loop with lock to prevent overlap
"""

from __future__ import annotations

import argparse
import fcntl
import os
import pwd
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

DEFAULT_CONFIG = """# Mirror producer configuration

target_url = "https://iranopasmigirim.com/"
repo_path = "/srv/mirror-repo"
content_subdir = "content"
git_remote = "origin"
git_branch = "main"

# Run interval used by daemon mode only.
interval_minutes = 15

# GPG signing key id used for signed commits.
signing_key = "0xABCDEF1234567890"

# Environment variable containing gpg passphrase if key is passphrase-protected.
gpg_passphrase_env = "GPG_PASSPHRASE"

# Scraper behavior
user_agent = "Mozilla/5.0 (compatible; offline-mirror-bot/2.0)"
exclude_patterns = ["-*.zip", "-*.exe", "-*.dmg", "-*.pkg"]
min_files = 20
max_files = 5000

# Local repository housekeeping (sender side).
# Run lightweight git maintenance at most once per this many hours.
maintenance_interval_hours = 24
# Prune unreachable git objects older than this many days.
prune_after_days = 30

# Fail-closed rewrite behavior for high-risk URL classes in mirrored HTML.
block_stream_extensions = [".m3u8", ".mpd", ".ism/manifest", ".f4m", ".ts"]
block_payment_domains = [
  "zarinpal.com",
  "idpay.ir",
  "nextpay.org",
  "paypal.com",
  "stripe.com",
]
"""

SERVICE_TEMPLATE = """[Unit]
Description=Mirror producer run-once
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User={user}
Group={group}
WorkingDirectory={repo_path}
EnvironmentFile=-/etc/mirror/secrets.env
ExecStart=/usr/local/bin/mirror_and_push.py --config {config_path} run-once
StandardOutput=journal
StandardError=journal
TimeoutStartSec=30m
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
PrivateDevices=true
ReadWritePaths={repo_path}
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
    target_url: str
    repo_path: Path
    content_subdir: str
    git_remote: str
    git_branch: str
    interval_minutes: int
    signing_key: str
    gpg_passphrase_env: str
    user_agent: str
    exclude_patterns: list[str]
    min_files: int
    max_files: int
    maintenance_interval_hours: int
    prune_after_days: int
    block_stream_extensions: list[str]
    block_payment_domains: list[str]

    @property
    def content_path(self) -> Path:
        return self.repo_path / self.content_subdir


def run(cmd: list[str], cwd: Path | None = None, check: bool = True, env: dict[str, str] | None = None):
    print(f"$ {' '.join(cmd)}", flush=True)
    return subprocess.run(cmd, cwd=str(cwd) if cwd else None, check=check, env=env)


def die(msg: str) -> None:
    raise SystemExit(msg)


def validate_target_url(url: str) -> str:
    u = urlparse(url.strip())
    if u.scheme not in {"http", "https"} or not u.netloc:
        die(f"invalid target URL: {url!r} (must be full http(s) URL)")
    return url.strip()


def validate_branch_name(name: str) -> str:
    n = name.strip()
    if not n:
        die("branch cannot be empty")
    if n.startswith("-") or ".." in n or " " in n:
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
    allowed_prefixes = ("https://", "http://", "ssh://", "git@", "file://", "/")
    if not v.startswith(allowed_prefixes):
        die("repo-url looks invalid; expected https://, ssh://, git@, file://, or absolute path")
    return v


def validate_interval_minutes(value: int) -> int:
    if value < 1 or value > 1440:
        die("interval must be between 1 and 1440 minutes")
    return value


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


def check_repo_remote(repo_url: str, branch: str) -> None:
    probe = subprocess.run(
        ["git", "ls-remote", "--heads", repo_url, branch],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    if probe.returncode != 0:
        err = (probe.stderr or "").strip() or "unable to access repository"
        die(f"repo-url check failed: {err}")


def require_root() -> None:
    if os.geteuid() != 0:
        raise SystemExit("setup-system must run as root")


def run_as_user(user: str, cmd: list[str], cwd: Path | None = None, check: bool = True) -> subprocess.CompletedProcess:
    if shutil.which("runuser"):
        wrapped = ["runuser", "-u", user, "--"] + cmd
        return run(wrapped, cwd=cwd, check=check)
    if shutil.which("sudo"):
        wrapped = ["sudo", "-u", user] + cmd
        return run(wrapped, cwd=cwd, check=check)
    raise SystemExit("runuser/sudo is required to execute commands as the mirror user")


def write_file(path: Path, content: str, mode: int = 0o644) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    os.chmod(path, mode)


def config_from_values(target_url: str, repo_path: Path, signing_key: str, branch: str, interval_minutes: int) -> str:
    content = DEFAULT_CONFIG
    content = content.replace('target_url = "https://iranopasmigirim.com/"', f'target_url = "{target_url}"')
    content = content.replace('repo_path = "/srv/mirror-repo"', f'repo_path = "{repo_path}"')
    content = content.replace('signing_key = "0xABCDEF1234567890"', f'signing_key = "{signing_key}"')
    content = content.replace('git_branch = "main"', f'git_branch = "{branch}"')
    content = content.replace('interval_minutes = 15', f'interval_minutes = {interval_minutes}')
    return content


def ensure_system_user(user: str, group: str) -> None:
    try:
        pwd.getpwnam(user)
    except KeyError:
        run(["useradd", "-r", "-m", "-s", "/usr/sbin/nologin", user])

    if group != user:
        run(["groupadd", "-f", group], check=False)
        run(["usermod", "-a", "-G", group, user], check=False)


def ensure_repo_checkout(repo_url: str, repo_path: Path, user: str, branch: str) -> None:
    repo_path.parent.mkdir(parents=True, exist_ok=True)
    if not (repo_path / ".git").is_dir():
        run_as_user(user, ["git", "clone", "-b", branch, repo_url, str(repo_path)])
    else:
        run_as_user(user, ["git", "-C", str(repo_path), "fetch", "--all", "--prune"], check=False)
        run_as_user(user, ["git", "-C", str(repo_path), "checkout", branch], check=False)
    run(["chown", "-R", f"{user}:{user}", str(repo_path)])


def install_binary_from_self() -> None:
    src = Path(__file__).resolve()
    dest = Path("/usr/local/bin/mirror_and_push.py")
    shutil.copy2(src, dest)
    os.chmod(dest, 0o755)


def install_systemd_units(config_path: Path, repo_path: Path, user: str, group: str, interval_minutes: int) -> None:
    service = SERVICE_TEMPLATE.format(
        user=user,
        group=group,
        repo_path=str(repo_path),
        config_path=str(config_path),
    )
    timer = TIMER_TEMPLATE.format(interval_minutes=interval_minutes)
    write_file(Path("/etc/systemd/system/mirror.service"), service, mode=0o644)
    write_file(Path("/etc/systemd/system/mirror.timer"), timer, mode=0o644)


def maybe_install_deps() -> None:
    if not shutil.which("apt-get"):
        raise SystemExit("--install-deps requested but apt-get was not found")
    run(["apt-get", "update", "-y"])
    run([
        "apt-get",
        "install",
        "-y",
        "--no-install-recommends",
        "python3",
        "git",
        "gpg",
        "httrack",
    ])


def write_default_secrets_file() -> None:
    path = Path("/etc/mirror/secrets.env")
    if path.exists():
        return
    content = "# Optional. Set if your key is passphrase-protected.\nGPG_PASSPHRASE=\n"
    write_file(path, content, mode=0o600)


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


def load_config(path: Path) -> Config:
    raw = parse_toml_text(path.read_text(encoding="utf-8"))
    return Config(
        target_url=str(raw["target_url"]),
        repo_path=Path(str(raw["repo_path"])).expanduser().resolve(),
        content_subdir=str(raw.get("content_subdir", "content")),
        git_remote=str(raw.get("git_remote", "origin")),
        git_branch=str(raw.get("git_branch", "main")),
        interval_minutes=int(raw.get("interval_minutes", 15)),
        signing_key=str(raw["signing_key"]),
        gpg_passphrase_env=str(raw.get("gpg_passphrase_env", "GPG_PASSPHRASE")),
        user_agent=str(raw.get("user_agent", "Mozilla/5.0 (compatible; offline-mirror-bot/2.0)")),
        exclude_patterns=[str(x) for x in raw.get("exclude_patterns", [])],
        min_files=int(raw.get("min_files", 20)),
        max_files=int(raw.get("max_files", 5000)),
        maintenance_interval_hours=int(raw.get("maintenance_interval_hours", 24)),
        prune_after_days=int(raw.get("prune_after_days", 30)),
        block_stream_extensions=[str(x).lower() for x in raw.get("block_stream_extensions", [])],
        block_payment_domains=[str(x).lower() for x in raw.get("block_payment_domains", [])],
    )


def validate_config(cfg: Config) -> None:
    validate_target_url(cfg.target_url)
    if not (cfg.repo_path / ".git").is_dir():
        die(f"repo_path is not a git checkout: {cfg.repo_path}")
    if cfg.interval_minutes < 1:
        die("interval_minutes must be >= 1")
    if cfg.min_files < 1 or cfg.max_files < cfg.min_files:
        die("min_files/max_files values are invalid")
    if cfg.maintenance_interval_hours < 1:
        die("maintenance_interval_hours must be >= 1")
    if cfg.prune_after_days < 1:
        die("prune_after_days must be >= 1")
    if not cfg.signing_key.strip():
        die("signing_key must be set")


def ensure_tools() -> None:
    required = ["httrack", "git", "gpg"]
    missing = [t for t in required if shutil.which(t) is None]
    if missing:
        raise SystemExit(f"missing required tools: {', '.join(missing)}")


def advisory_safety_note() -> None:
    print(
        "[note] No mirror can guarantee zero abuse risk. This app is fail-closed by default for "
        "known payment/stream patterns and strips interactive posting surfaces where possible.",
        flush=True,
    )


def scrape_site(cfg: Config, stage_dir: Path) -> Path:
    host = urlparse(cfg.target_url).netloc
    cmd = [
        "httrack",
        cfg.target_url,
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

    # Pick the largest candidate directory as the host content root.
    host_dir = max(candidates, key=lambda p: sum(1 for _ in p.rglob("*")))
    return host_dir


def clear_scraper_control_files(content_dir: Path) -> None:
    for name in ("hts-log.txt", "cookies.txt", "hts-cache"):
        p = content_dir / name
        if p.is_file():
            p.unlink()
        elif p.is_dir():
            shutil.rmtree(p)


def is_payment_url(url: str, blocked_domains: list[str]) -> bool:
    lower = url.lower()
    return any(d in lower for d in blocked_domains)


def is_stream_url(url: str, blocked_exts: list[str]) -> bool:
    lower = url.lower()
    return any(ext in lower for ext in blocked_exts)


def sanitize_html_text(html: str, cfg: Config) -> str:
    # Disable all forms (read-only mirror policy).
    html = re.sub(
        r"<form\b([^>]*)>",
        r'<form\1 action="/__mirror_blocked.html?reason=form" method="get" onsubmit="return false;">',
        html,
        flags=re.IGNORECASE,
    )

    # Disable payment/stream links and media URLs.
    attr_re = re.compile(r"\b(href|src|poster)\s*=\s*([\"'])([^\"']+)\2", re.IGNORECASE)

    def replace_attr(match: re.Match[str]) -> str:
        attr, quote, value = match.group(1), match.group(2), match.group(3)
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


def sync_to_repo(cfg: Config, staged_host_dir: Path) -> None:
    target = cfg.content_path
    if target.exists():
        shutil.rmtree(target)
    shutil.copytree(staged_host_dir, target)


def stage_and_commit(cfg: Config) -> bool:
    run(["git", "add", "-A", cfg.content_subdir], cwd=cfg.repo_path)
    diff = subprocess.run(["git", "diff", "--cached", "--quiet"], cwd=cfg.repo_path)
    if diff.returncode == 0:
        print("no changes — skipping commit", flush=True)
        return False

    msg = "mirror update " + datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    env = os.environ.copy()
    passphrase = os.environ.get(cfg.gpg_passphrase_env)
    if passphrase:
        env[cfg.gpg_passphrase_env] = passphrase
    run(
        ["git", "commit", "-S", f"--gpg-sign={cfg.signing_key}", "-m", msg],
        cwd=cfg.repo_path,
        env=env,
    )
    run(["git", "push", cfg.git_remote, f"HEAD:{cfg.git_branch}"], cwd=cfg.repo_path)
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


def run_repo_maintenance(cfg: Config) -> None:
    marker = cfg.repo_path / ".mirror_last_maintenance"
    if not repo_maintenance_due(marker, cfg.maintenance_interval_hours):
        return
    prune = f"--prune={cfg.prune_after_days}.days.ago"
    expire = f"--expire={cfg.prune_after_days}.days.ago"
    try:
        # Keep this lightweight and infrequent: we want bloat prevention,
        # not an expensive maintenance step every cycle.
        run(["git", "reflog", "expire", expire, "--all"], cwd=cfg.repo_path)
        run(["git", "gc", "--auto", prune], cwd=cfg.repo_path)
        marker.write_text(str(int(time.time())), encoding="utf-8")
    except Exception as exc:  # noqa: BLE001
        print(f"[warn] maintenance skipped: {exc}", flush=True)


def run_once(cfg: Config) -> int:
    validate_config(cfg)
    ensure_tools()
    advisory_safety_note()

    with tempfile.TemporaryDirectory(prefix="mirror_stage_") as td:
        stage = Path(td)
        host_dir = scrape_site(cfg, stage)
        sanitize_content(host_dir, cfg)
        files = count_files(host_dir)
        if files < cfg.min_files:
            raise SystemExit(f"scrape sanity check failed: only {files} files (min_files={cfg.min_files})")
        if files > cfg.max_files:
            raise SystemExit(f"scrape sanity check failed: {files} files (max_files={cfg.max_files})")
        sync_to_repo(cfg, host_dir)

    changed = stage_and_commit(cfg)
    run_repo_maintenance(cfg)
    print("completed with changes" if changed else "completed without changes", flush=True)
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


def cmd_init(args: argparse.Namespace) -> int:
    path = Path(args.config).expanduser().resolve()
    if path.exists() and not args.force:
        raise SystemExit(f"config exists: {path} (use --force to overwrite)")

    target = input("Target URL [https://iranopasmigirim.com/]: ").strip() or "https://iranopasmigirim.com/"
    repo = input("Local git repo path [/srv/mirror-repo]: ").strip() or "/srv/mirror-repo"
    key = input("GPG signing key id [0xABCDEF1234567890]: ").strip() or "0xABCDEF1234567890"
    branch = input("Git branch [main]: ").strip() or "main"

    content = DEFAULT_CONFIG
    content = content.replace('target_url = "https://iranopasmigirim.com/"', f'target_url = "{target}"')
    content = content.replace('repo_path = "/srv/mirror-repo"', f'repo_path = "{repo}"')
    content = content.replace('signing_key = "0xABCDEF1234567890"', f'signing_key = "{key}"')
    content = content.replace('git_branch = "main"', f'git_branch = "{branch}"')

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    print(f"wrote config: {path}")
    return 0


def cmd_doctor(args: argparse.Namespace) -> int:
    cfg = load_config(Path(args.config))
    validate_config(cfg)
    ensure_tools()
    run(["git", "rev-parse", "--is-inside-work-tree"], cwd=cfg.repo_path)
    run(["git", "remote", "get-url", cfg.git_remote], cwd=cfg.repo_path)
    run(["gpg", "--list-secret-keys", cfg.signing_key], check=False)
    print("doctor checks completed")
    return 0


def cmd_run_once(args: argparse.Namespace) -> int:
    cfg = load_config(Path(args.config))
    lock_path = cfg.repo_path / ".mirror_producer.lock"
    lock = acquire_lock(lock_path)
    try:
        return run_once(cfg)
    finally:
        lock.close()


def cmd_daemon(args: argparse.Namespace) -> int:
    cfg = load_config(Path(args.config))
    lock_path = cfg.repo_path / ".mirror_producer.lock"
    lock = acquire_lock(lock_path)
    try:
        while True:
            start = time.time()
            try:
                run_once(cfg)
            except Exception as exc:  # noqa: BLE001
                print(f"[error] run failed: {exc}", flush=True)
            elapsed = time.time() - start
            sleep_s = max(5, cfg.interval_minutes * 60 - int(elapsed))
            print(f"sleeping {sleep_s}s", flush=True)
            time.sleep(sleep_s)
    finally:
        lock.close()


def cmd_setup_system(args: argparse.Namespace) -> int:
    require_root()

    if args.interactive:
        print("[setup] interactive mode enabled", flush=True)
        args.repo_url = prompt_validated("Mirror repo URL", args.repo_url, validate_repo_url)
        args.target_url = prompt_validated("Target URL", args.target_url, validate_target_url)
        args.signing_key = prompt_validated("GPG signing key", args.signing_key, validate_signing_key)
        args.branch = prompt_validated("Git branch", args.branch, validate_branch_name)
        args.repo_path = prompt_value("Local repo path", args.repo_path)
        args.interval = prompt_int("Interval minutes", args.interval, validate_interval_minutes)
    else:
        if not args.repo_url:
            die("--repo-url is required in non-interactive mode")
        if not args.signing_key:
            die("--signing-key is required in non-interactive mode")
        args.repo_url = validate_repo_url(args.repo_url)
        args.target_url = validate_target_url(args.target_url)
        args.signing_key = validate_signing_key(args.signing_key)
        args.branch = validate_branch_name(args.branch)
        args.interval = validate_interval_minutes(args.interval)

    check_repo_remote(args.repo_url, args.branch)

    if args.install_deps:
        maybe_install_deps()

    repo_path = Path(args.repo_path).expanduser().resolve()
    config_path = Path(args.config).expanduser().resolve()

    ensure_system_user(args.user, args.group)
    ensure_repo_checkout(args.repo_url, repo_path, args.user, args.branch)
    install_binary_from_self()

    cfg = config_from_values(
        target_url=args.target_url,
        repo_path=repo_path,
        signing_key=args.signing_key,
        branch=args.branch,
        interval_minutes=args.interval,
    )
    write_file(config_path, cfg, mode=0o640)
    run(["chown", "root:root", str(config_path)])

    write_default_secrets_file()
    install_systemd_units(config_path, repo_path, args.user, args.group, args.interval)
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

    run_p = sub.add_parser("run-once", help="run one mirror cycle")
    run_p.set_defaults(func=cmd_run_once)

    daemon_p = sub.add_parser("daemon", help="run forever with interval_minutes cadence")
    daemon_p.set_defaults(func=cmd_daemon)

    setup_p = sub.add_parser("setup-system", help="one-command deterministic system setup (root)")
    setup_p.add_argument("--repo-url", default="", help="git URL of the mirror repo")
    setup_p.add_argument("--target-url", default="https://iranopasmigirim.com/", help="site to mirror")
    setup_p.add_argument("--repo-path", default="/srv/mirror-repo", help="local mirror repo path")
    setup_p.add_argument("--signing-key", default="", help="GPG signing key id")
    setup_p.add_argument("--branch", default="main", help="git branch to push")
    setup_p.add_argument("--interval", type=int, default=15, help="minutes between mirror runs")
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
    except subprocess.CalledProcessError as exc:
        cmd = " ".join(exc.cmd) if isinstance(exc.cmd, list) else str(exc.cmd)
        print(f"[error] command failed ({exc.returncode}): {cmd}", file=sys.stderr)
        return int(exc.returncode or 1)
    except KeyboardInterrupt:
        print("\n[error] interrupted by user", file=sys.stderr)
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
