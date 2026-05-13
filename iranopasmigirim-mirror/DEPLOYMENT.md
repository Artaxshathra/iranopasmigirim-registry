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

If you already ran the `registry` command on this machine, the default config
will usually already have `registry_repo_url` filled in.

Then edit `~/.config/iranopasmigirim-producer/config.toml` and set at minimum:

- `signing_key`
- `whitelist_hosts`

If you skipped the `registry` step or you are using a custom config path, also
set `registry_repo_url` manually.

Validation command:

```bash
./setup.sh producer
```

Full server provisioning on a producer host:

```bash
python3 pusher/mirror_and_push.py setup-system \
  --registry-repo-url https://github.com/YOUR_USER/YOUR_REGISTRY_REPO \
  --signing-key 0xYOUR_LONG_KEY_ID
```

Manual systemd option:

- sample unit: `pusher/mirror.service`
- sample timer: `pusher/mirror.timer`

Allowed websites are configured in two places today:

- producer TOML `whitelist_hosts`: producer-side allowed host list
- [src/config.js](src/config.js) -> `WHITELIST`: extension-side allowed
  hosts and path policy

Keep them aligned.

If you prefer a different config path, `./setup.sh producer /path/to/config.toml`
will create it automatically when missing.

## 6. Extension Release Build

Before building a release for real users, update
[src/config.js](src/config.js) with:

- `REGISTRY_REPO_URL`
- `TRUSTED_SIGNERS`
- `TRUSTED_SIGNER_PUBLIC_KEYS`
- `WHITELIST`

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
