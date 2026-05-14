# Deployment Quick Reference

This file is the short version. For the full runbook, see
[OPERATIONS.md](OPERATIONS.md).

## 1. Work From This Directory

All commands below assume you are in the mirror repo root:

```bash
cd /path/to/iranopasmigirim-mirror
```

## 2. Local Development

```bash
./setup.sh dev
./setup.sh dev test
./setup.sh dev firefox
./setup.sh verify
```

`setup.sh dev` and `setup.sh verify` now preflight their CLI prerequisites and
install missing tools automatically when they detect a supported package
manager.

Load the development build from `dist/chrome` or `dist/firefox`.

## 3. GitHub SSH Setup

Single-account setup can use your default `github.com` SSH identity.

For a separate GitHub account, create an alias and use `IdentitiesOnly yes` so
SSH does not fall back to a personal key:

```sshconfig
Host github-work
  HostName github.com
  User git
  IdentityFile ~/.ssh/id_ed25519_mirror
  IdentitiesOnly yes
```

Verify the alias before running registry setup:

```bash
ssh -T git@github-work
```

## 4. Registry Bootstrap

Create the public registry repository on GitHub, then run:

```bash
./setup.sh registry YOUR_GITHUB_USERNAME YOUR_REGISTRY_REPO [SSH_ALIAS]
```

Examples:

```bash
./setup.sh registry your-user iranopasmigirim-registry
./setup.sh registry your-user iranopasmigirim-registry github-work
```

What the script does:

- fresh-clones the registry into `/tmp/YOUR_REGISTRY_REPO`
- ensures `main`, `requests`, `registrations`, `approvals`, and `deliveries`
  exist on origin
- writes `registry-config.json` on `main`
- seeds the default producer config with `registry_repo_url` when possible
- keeps reruns idempotent

## 5. Producer Setup

Validation only. Run the helper once; if the default config does not exist, it
will create `~/.config/iranopasmigirim-producer/config.toml` automatically:

```bash
./setup.sh producer
```

The helper now checks for `python3`, `git`, `gpg`, `httrack`, and Python TOML
parser support. It installs anything missing automatically when it can use
`apt-get`, `dnf`, `yum`, `pacman`, `zypper`, `apk`, or `brew`, and falls back
to installing `tomli` into the active `python3` interpreter when distro
packages do not satisfy that runtime.

If you already ran the `registry` command on this machine, the default config
will usually already have `registry_repo_url` filled in.

Then edit `~/.config/iranopasmigirim-producer/config.toml` and set at minimum:

- `signing_key`
- `whitelist_hosts`

`whitelist_hosts` is the main control for "only these few sites should work."
Put only the hostnames you want mirrored there, for example `bbc.com` and
`cnn.com`.

`signing_key` is the GPG secret key ID or full fingerprint the producer uses
for signed git commits. It must already exist on the producer host in your GPG
secret keyring. Find it with:

```bash
gpg --list-secret-keys --keyid-format LONG
```

Copy the long key ID from the `sec` line into `signing_key`, usually with the
`0x` prefix. Example: `sec   ed25519/DD13EC3368AA05D1 ...` means
`signing_key = "0xDD13EC3368AA05D1"`.

If you skipped the `registry` step or you are using a custom config path, also
set `registry_repo_url` manually.

Optional quick validation of that user-level config:

```bash
./setup.sh producer
```

That command only checks the existing config file and runs producer doctor. It
does not install services or provision the machine.

Run one producer cycle right now:

```bash
./setup.sh producer run-once
```

Run the producer continuously in the foreground:

```bash
./setup.sh producer daemon
```

For faster local testing without changing the saved config cadence:

```bash
./setup.sh producer daemon --interval 2
```

If you are setting up a dedicated producer server, use this separate full-host
provisioning path instead:

```bash
./setup.sh producer setup-system \
  https://github.com/YOUR_USER/YOUR_REGISTRY_REPO \
  0xYOUR_LONG_KEY_ID
```

That command is not a second validation pass for
`~/.config/iranopasmigirim-producer/config.toml`. It provisions the server,
writes the system config under `/etc/mirror/`, and installs the systemd unit
and timer.

Service inspection shortcuts:

```bash
./setup.sh producer status
./setup.sh producer logs
```

The root `--install-deps` path supports `apt-get`, `dnf`, `yum`, `pacman`,
`zypper`, and `apk` on Linux producer hosts, and it also ensures the active
Python runtime can parse TOML configs.

Manual systemd option:

- sample unit: `pusher/mirror.service`
- sample timer: `pusher/mirror.timer`

Allowed websites are configured in one place:

- producer TOML `whitelist_hosts`: the only host allowlist. The producer
  rejects requests for hosts not in this list, so the user's delivery repo
  never receives content for them and the extension never serves them.

The extension does not duplicate this list and does not need to be rebuilt
when `whitelist_hosts` changes; only the producer needs to reload its config.

The `block_stream_extensions` and `block_payment_domains` settings are not
extra allowlists. They are extra deny rules inside already-whitelisted pages:

- `block_stream_extensions`: rewrites stream/media links like `.m3u8` or `.mpd`
  to a blocked page
- `block_payment_domains`: rewrites payment/checkout links like `paypal.com`
  or `stripe.com` to a blocked page

Those `block_*` lists only remove functionality. They do not make any new site
or feature available. If you want "absolutely nothing except a few news
websites," the only control you need is `whitelist_hosts`.

If you prefer a different config path, `./setup.sh producer /path/to/config.toml`
will create it automatically when missing.

## 6. Extension Release Build

Before building a release for real users, update
[src/config.js](src/config.js) with:

- `REGISTRY_REPO_URL`
- `TRUSTED_SIGNERS`
- `TRUSTED_SIGNER_PUBLIC_KEYS`

Then build:

```bash
./setup.sh dev build
```

Install manually:

- Chrome: `chrome://extensions` -> Developer mode -> Load unpacked -> `dist/chrome`
- Firefox: `about:debugging` -> This Firefox -> Load Temporary Add-on -> `dist/firefox/manifest.json`

## 7. Useful Diagnostics

```bash
./setup.sh verify
python3 -m py_compile pusher/mirror_and_push.py
python3 -m unittest -v pusher.test_producer
curl https://api.github.com/repos/YOUR_USER/YOUR_REGISTRY_REPO
ssh -T git@github-work
```

## 8. Most Common Failure Modes

- Wrong working directory: run commands from the mirror repo root, not the
  workspace root.
- Wrong SSH identity: verify `ssh -T git@YOUR_ALIAS` and pass the same alias as
  the third `registry` argument.
- Stale release config: update `src/config.js` before running a production
  build.
- Wrong producer template: start from
  [pusher/mirror.toml.example](pusher/mirror.toml.example), then replace the
  placeholder registry URL, signing key, and `whitelist_hosts` with your real
  values.

## 9. More Detail

- [OPERATIONS.md](OPERATIONS.md)
- [README.md](README.md)
- [pusher/README.md](pusher/README.md)

**Last Updated:** May 13, 2026
**Version:** 0.2.0
