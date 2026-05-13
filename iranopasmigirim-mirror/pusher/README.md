# Producer App (mirror_and_push.py)

This is the producer side of the mirror (Phase 3 request-driven model).

It handles:
- registry request intake (`requests/*.json`)
- ownership proof verification in user repos (`requests` branch challenge file)
- whitelist enforcement by host
- scrape + sanitize (fail-closed for forms/payment/stream links)
- signed delivery commits to each user repo (`content` branch)
- signed status updates to registry (`status/*.json`)
- periodic automatic runs

## One-command Setup (recommended)

Run as root on your producer server:

```bash
/usr/bin/env python3 mirror_and_push.py setup-system --install-deps
```

This command does deterministic, idempotent provisioning:
- installs deps (if `--install-deps`)
- creates `mirror` system user
- clones/updates registry repo under `/srv/mirror-registry`
- prepares user repos root under `/srv/mirror-users`
- installs producer binary to `/usr/local/bin/mirror_and_push.py`
- writes `/etc/mirror/mirror.toml`
- installs systemd unit/timer
- enables `mirror.timer`

`--install-deps` supports `apt-get`, `dnf`, `yum`, `pacman`, `zypper`, and
`apk` on Linux producer hosts and ensures the active Python runtime can parse
TOML configs.

Data hygiene policy (automatic):
- Sender: local repo maintenance runs periodically (`maintenance_interval_hours`, default 24h) and prunes old unreachable git objects (`prune_after_days`, default 30).
- Extension: cache maintenance runs periodically and removes malformed/oversized stale cache records.

The setup is interactive and validates each input (repo URL, signing key,
branch, interval). Invalid input is explained clearly and re-prompted.

For automation/CI:

```bash
/usr/bin/env python3 mirror_and_push.py setup-system \
	--non-interactive \
	--registry-repo-url <YOUR_REGISTRY_REPO_URL> \
	--signing-key 0xYOUR_LONG_KEY_ID \
	--registry-branch registrations
```

## Runtime Commands

- `mirror_and_push.py --config /etc/mirror/mirror.toml doctor`
- `mirror_and_push.py --config /etc/mirror/mirror.toml run-once`
- `mirror_and_push.py --config /etc/mirror/mirror.toml daemon`

## Config

Start from `pusher/mirror.toml.example`.

Key options:
- `registry_repo_url`: fixed producer registry repository
- `registry_repo_path`: local registry checkout
- `user_repos_root`: local root for user repository checkouts
- `delivery_subdir`: set to empty string to deliver at repo root (recommended for extension compatibility)
- `whitelist_hosts`: allowed host list
- `signing_key`: GPG key id used for signed commits
- `interval_minutes`: daemon cadence
- `max_requests_per_run`: cap per cycle
- `block_payment_domains`: blocked payment links rewritten to a blocked page
- `block_stream_extensions`: blocked stream/media URL patterns

Release signer consistency:
- Extension trust pin (fingerprint) is configured in `src/config.js` and must match producer signing identity.
- Current pinned fingerprint: `AF95AB7725D68A2ABBA8B938DD13EC3368AA05D1`.
- Default producer signing key id in templates: `0xDD13EC3368AA05D1`.

## Security Notes

- Signed commits only. No unsigned fallback.
- Single-instance lock prevents overlapping runs.
- Fail-closed rewrites disable forms and high-risk payment/stream URLs.
- This lowers risk but cannot guarantee zero abuse risk in all cases.
