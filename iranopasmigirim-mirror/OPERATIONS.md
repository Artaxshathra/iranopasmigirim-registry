# Mirror Operations Guide

This guide covers the full mirror workflow: registry bootstrap, producer
installation, release configuration, and common operational checks.

The shell helper now preflights command-specific dependencies and installs
missing tools automatically when it can detect a supported package manager.

## 1. Working Directory

Run all `setup.sh` commands from this repository root:

```bash
cd /path/to/iranopasmigirim-mirror
```

## 2. Registry Repository Setup

The registry is a normal public GitHub repository used as the request and
status exchange point between users and producers.

Bootstrap command:

```bash
./setup.sh registry OWNER REPO [SSH_ALIAS]
```

Examples:

```bash
./setup.sh registry myusername iranopasmigirim-registry
./setup.sh registry myusername iranopasmigirim-registry github-work
```

### Multi-account GitHub

If you use a dedicated GitHub account for mirror infrastructure, define an SSH
alias first:

```sshconfig
Host github-work
  HostName github.com
  User git
  IdentityFile ~/.ssh/id_ed25519_mirror
  IdentitiesOnly yes
```

Verify it:

```bash
ssh -T git@github-work
```

Then pass that alias as the third argument to `./setup.sh registry`.

### What the Script Does

- asks you to create the GitHub repository in the browser
- fresh-clones the repo into `/tmp/REPO`
- ensures `main`, `requests`, `registrations`, `approvals`, and `deliveries`
  exist on origin
- writes `registry-config.json` on `main`
- keeps reruns safe and idempotent

The generated `registry-config.json` intentionally uses HTTPS and raw GitHub
URLs because the extension and diagnostics use the GitHub API and raw content
endpoints, not SSH.

## 3. Extension Release Configuration

The extension has a fixed central registry URL baked into the release build.
Before shipping a deployment, update [src/config.js](src/config.js):

- `REGISTRY_REPO_URL`
- `TRUSTED_SIGNERS`
- `TRUSTED_SIGNER_PUBLIC_KEYS`

Then build the release bundle:

```bash
./setup.sh dev build
```

Users configure their own mirror repository in the popup. They do not configure
the central registry there.

## 4. Producer Setup Options

### Option A: Validate a Producer Config Locally

Use `setup.sh producer` when you already have a config file and want a quick
prerequisite/config check:

```bash
./setup.sh producer
```

If the default config does not exist, the helper creates
`~/.config/iranopasmigirim-producer/config.toml` automatically.

The helper checks for `python3`, `git`, `gpg`, and `httrack` and installs any
missing producer prerequisite automatically when it can detect `apt-get`,
`dnf`, `yum`, `pacman`, `zypper`, `apk`, or `brew`.

If you already ran `./setup.sh registry ...` on this machine and are using the
default config path, `registry_repo_url` is seeded automatically.

Edit that file first. At minimum set:

- `signing_key`
- `whitelist_hosts`

If you skipped the `registry` step or you are using a custom config path, also
set `registry_repo_url` manually.

```bash
./setup.sh producer
```

This does not install services. It validates dependencies, checks Python
syntax, and runs the producer `doctor` command.

### Option B: Full Host Provisioning

For a dedicated producer host, use the producer's built-in setup command:

```bash
python3 pusher/mirror_and_push.py setup-system \
  --install-deps \
  --registry-repo-url https://github.com/YOUR_USER/YOUR_REGISTRY_REPO \
  --signing-key 0xYOUR_LONG_KEY_ID
```

The root `--install-deps` path supports `apt-get`, `dnf`, `yum`, `pacman`,
`zypper`, and `apk`.

Relevant files:

- starter config: [pusher/mirror.toml.example](pusher/mirror.toml.example)
- producer CLI docs: [pusher/README.md](pusher/README.md)

Allowed website policy is split today:

- producer TOML `whitelist_hosts`: host allowlist for mirroring
- [src/config.js](src/config.js) `WHITELIST`: extension request and path policy

Keep those host lists aligned.

For a custom config location, use `./setup.sh producer /path/to/config.toml`.
If the file is missing, the helper creates it automatically.

## 5. Manual systemd Setup

If you do not use `setup-system`, the repo already ships sample unit files:

- [pusher/mirror.service](pusher/mirror.service)
- [pusher/mirror.timer](pusher/mirror.timer)

Typical installation flow:

```bash
sudo install -m 0644 pusher/mirror.service /etc/systemd/system/mirror.service
sudo install -m 0644 pusher/mirror.timer /etc/systemd/system/mirror.timer
sudo systemctl daemon-reload
sudo systemctl enable --now mirror.timer
```

Before enabling them, edit the sample unit so `User`, `Group`,
`WorkingDirectory`, `EnvironmentFile`, and `ExecStart` match your host.

## 6. Release and Verification

Standard verification:

```bash
./setup.sh verify
```

`setup.sh dev` and `setup.sh verify` also preflight `node`, `npm`, and
`python3` before they start work.

Focused checks:

```bash
bash -n setup.sh
npm test
python3 -m unittest pusher.test_producer
python3 -m py_compile pusher/mirror_and_push.py
```

## 7. Operational Checks

### GitHub and SSH

```bash
ssh -T git@github-work
curl https://api.github.com/repos/YOUR_USER/YOUR_REGISTRY_REPO
curl https://raw.githubusercontent.com/YOUR_USER/YOUR_REGISTRY_REPO/main/registry-config.json
```

### Producer

```bash
python3 pusher/mirror_and_push.py --config /etc/mirror/mirror.toml doctor
python3 pusher/mirror_and_push.py --config /etc/mirror/mirror.toml run-once
sudo systemctl status mirror.timer
sudo journalctl -u mirror.service -n 50
```

### Browser Extension

- load `dist/chrome` in Chrome or `dist/firefox/manifest.json` in Firefox
- confirm the popup accepts the user's own GitHub repo URL
- confirm sync errors point to the registry or signer mismatch, not malformed
  GitHub URLs

## 8. Common Pitfalls

- Running `./setup.sh` from the workspace root instead of this repo root.
- Using `ssh -T git@github.com` when the real deployment uses an alias like
  `github-work`.
- Forgetting to update `src/config.js` before building a release.
- Leaving `pusher/mirror.toml.example` placeholder values unchanged.

## 9. Related Docs

- [README.md](README.md)
- [DEPLOYMENT.md](DEPLOYMENT.md)
- [pusher/README.md](pusher/README.md)

**Last Updated:** May 13, 2026
**Version:** 0.2.0
