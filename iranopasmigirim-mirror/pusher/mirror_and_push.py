#!/usr/bin/env python3
"""
Standalone mirror pusher — for users who'd rather run the mirror on their
own infrastructure (a VPS, a home server) than on GitHub Actions.

Behavior matches .github/workflows/mirror.yml:
  1. httrack the target site into ./content/
  2. sanitize (drop httrack control files, strip cookies, promote host dir)
  3. git add + git commit -S (signed) + git push

Usage:
  ./mirror_and_push.py \\
      --target https://iranopasmigirim.com/ \\
      --repo  /srv/mirror-repo \\
      --signing-key 0xABCDEF1234567890

Run as a cron job every 10–15 minutes:
  */15 * * * * cd /srv/mirror-repo && /usr/local/bin/mirror_and_push.py >> mirror.log 2>&1

If the commit signature fails to verify against the extension's pinned
fingerprint, the extension keeps serving the previous good cache. We do
NOT add a fallback to commit unsigned — the trust boundary is exactly
"only signed commits are honored".
"""

import argparse
import os
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path


def run(cmd, cwd=None, check=True, env=None):
    """Run a subprocess, surfacing stdout/stderr live so cron logs are useful."""
    print(f"$ {' '.join(cmd)}", flush=True)
    return subprocess.run(cmd, cwd=cwd, check=check, env=env)


def ensure_httrack():
    """Fail fast if httrack isn't installed — we don't auto-install on a host."""
    if shutil.which("httrack") is None:
        sys.exit("httrack not found in PATH. Install: apt install httrack")


def scrape(target_url: str, dest: Path):
    """Run httrack into a temp dir, then promote the host folder to content/."""
    work = dest.parent / "_scrape"
    if work.exists():
        shutil.rmtree(work)
    work.mkdir(parents=True)
    run([
        "httrack", target_url,
        "-O", str(work),
        "--robots=0", "-%v0", "-n", "--update",
        f"+*{target_url.split('//', 1)[1].rstrip('/')}/*",
        # Skip large binaries that bloat the repo with no value to readers.
        "-*.zip", "-*.exe", "-*.dmg", "-*.pkg",
        "-F", "Mozilla/5.0 (compatible; offline-mirror-bot/1.0)",
    ], check=False)  # httrack exits non-zero on minor warnings; we check the output instead

    # httrack puts content in <work>/<host>/ — find that dir and rsync into dest.
    candidates = [p for p in work.iterdir() if p.is_dir() and not p.name.startswith("hts-")]
    if not candidates:
        sys.exit("scrape produced no host directory — aborting")
    host_dir = candidates[0]
    if dest.exists():
        shutil.rmtree(dest)
    shutil.copytree(host_dir, dest)
    shutil.rmtree(work)


def sanitize(content_dir: Path):
    """Drop scraper bookkeeping. Be conservative: never edit user content."""
    for name in ("hts-log.txt", "cookies.txt", "hts-cache"):
        p = content_dir / name
        if p.is_file():
            p.unlink()
        elif p.is_dir():
            shutil.rmtree(p)


def commit_and_push(repo_dir: Path, signing_key: str, gpg_passphrase: str | None):
    """Create a signed commit if there are changes, then push."""
    # Stage everything.
    run(["git", "add", "-A", "content"], cwd=repo_dir)
    # Skip if no diff.
    diff = subprocess.run(
        ["git", "diff", "--cached", "--quiet"],
        cwd=repo_dir,
    )
    if diff.returncode == 0:
        print("no changes — nothing to commit", flush=True)
        return
    msg = "mirror update " + datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    env = os.environ.copy()
    if gpg_passphrase:
        # Pass via env to avoid argv leakage. The git config below tells gpg
        # to read the passphrase from this var via gpg.conf / loopback.
        env["GPG_PASSPHRASE"] = gpg_passphrase
    run(["git", "commit", "-S", f"--gpg-sign={signing_key}", "-m", msg], cwd=repo_dir, env=env)
    run(["git", "push", "origin", "HEAD"], cwd=repo_dir)


def main():
    ap = argparse.ArgumentParser(description="Mirror a website into a signed git repo.")
    ap.add_argument("--target", required=True, help="URL of the site to mirror, e.g. https://iranopasmigirim.com/")
    ap.add_argument("--repo", required=True, help="Path to a local checkout of the mirror git repo.")
    ap.add_argument("--signing-key", required=True, help="GPG key id (long form, e.g. 0xABCDEF1234567890).")
    ap.add_argument("--gpg-passphrase-env", default="GPG_PASSPHRASE", help="Env var name holding the GPG passphrase (or empty if no passphrase).")
    args = ap.parse_args()

    ensure_httrack()
    repo = Path(args.repo).resolve()
    if not (repo / ".git").is_dir():
        sys.exit(f"{repo} is not a git checkout")
    content = repo / "content"

    scrape(args.target, content)
    sanitize(content)
    commit_and_push(
        repo,
        args.signing_key,
        os.environ.get(args.gpg_passphrase_env) or None,
    )


if __name__ == "__main__":
    main()
