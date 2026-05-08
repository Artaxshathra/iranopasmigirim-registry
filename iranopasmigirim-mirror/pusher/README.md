# Producer App (mirror_and_push.py)

This is the producer side of the mirror.

It handles:
- scrape
- sanitize (fail-closed for forms/payment/stream links)
- signed commit
- push
- periodic automatic runs

## One-command Setup (recommended)

Run as root on your producer server:

```bash
/usr/bin/env python3 mirror_and_push.py setup-system --install-deps
```

This command does deterministic, idempotent provisioning:
- installs deps (if `--install-deps`)
- creates `mirror` system user
- clones/updates repo under `/srv/mirror-repo`
- installs producer binary to `/usr/local/bin/mirror_and_push.py`
- writes `/etc/mirror/mirror.toml`
- installs systemd unit/timer
- enables `mirror.timer`

Data hygiene policy (automatic):
- Sender: local repo maintenance runs periodically (`maintenance_interval_hours`, default 24h) and prunes old unreachable git objects (`prune_after_days`, default 30).
- Extension: cache maintenance runs periodically and removes malformed/oversized stale cache records.

The setup is interactive and validates each input (repo URL, signing key,
branch, interval). Invalid input is explained clearly and re-prompted.

For automation/CI:

```bash
/usr/bin/env python3 mirror_and_push.py setup-system \
	--non-interactive \
	--repo-url <YOUR_MIRROR_REPO_URL> \
	--signing-key 0xYOUR_LONG_KEY_ID \
	--target-url https://iranopasmigirim.com/ \
	--branch main
```

## Runtime Commands

- `mirror_and_push.py --config /etc/mirror/mirror.toml doctor`
- `mirror_and_push.py --config /etc/mirror/mirror.toml run-once`
- `mirror_and_push.py --config /etc/mirror/mirror.toml daemon`

## Config

Start from `pusher/mirror.toml.example`.

Key options:
- `target_url`: website to mirror
- `repo_path`: local git checkout
- `signing_key`: GPG key id used for signed commits
- `interval_minutes`: daemon cadence
- `block_payment_domains`: blocked payment links rewritten to a blocked page
- `block_stream_extensions`: blocked stream/media URL patterns

## Security Notes

- Signed commits only. No unsigned fallback.
- Single-instance lock prevents overlapping runs.
- Fail-closed rewrites disable forms and high-risk payment/stream URLs.
- This lowers risk but cannot guarantee zero abuse risk in all cases.
