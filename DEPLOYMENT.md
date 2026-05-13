# Mirror Deployment Guide

This workspace contains multiple projects. The mirror tooling lives in
`iranopasmigirim-mirror/`, and every `setup.sh` command below must be run from
that directory.

## 1. Change Into the Mirror Repo

```bash
cd /home/arash/Code/IPM/iranopasmigirim-mirror
```

## 2. Local Build and Verification

```bash
./setup.sh dev
./setup.sh dev test
./setup.sh dev firefox
./setup.sh verify
```

`setup.sh dev` and `setup.sh verify` now preflight their CLI prerequisites and
install missing tools automatically when they detect a supported package
manager.

## 3. GitHub SSH Setup

If you use a dedicated GitHub account for the registry, define an SSH alias:

```sshconfig
Host github-work
  HostName github.com
  User git
  IdentityFile ~/.ssh/id_ed25519_mirror
  IdentitiesOnly yes
```

Verify the alias before using it:

```bash
ssh -T git@github-work
```

If you only use one GitHub identity, omit the alias and let the script default
to `github.com`.

## 4. Registry Repository Bootstrap

Create a public GitHub repo first, then run:

```bash
./setup.sh registry YOUR_GITHUB_USERNAME YOUR_REGISTRY_REPO [SSH_ALIAS]
```

Examples:

```bash
./setup.sh registry your-user iranopasmigirim-registry
./setup.sh registry your-user iranopasmigirim-registry github-work
```

The script now:

- creates a fresh temp clone
- preserves the requested SSH alias end to end
- creates missing protocol branches on origin
- writes `registry-config.json` on `main`
- seeds the default producer config with `registry_repo_url` when possible
- reruns safely

## 5. Producer Setup

Run the producer helper once. If the default config does not exist yet, it
will create it automatically at
`~/.config/iranopasmigirim-producer/config.toml`.

```bash
./setup.sh producer
```

The helper now checks for `python3`, `git`, `gpg`, `httrack`, and Python TOML
parser support. It installs anything missing automatically when it can use
`apt-get`, `dnf`, `yum`, `pacman`, `zypper`, `apk`, or `brew`, and falls back
to installing `tomli` into the active `python3` interpreter when distro
packages do not satisfy that runtime.

If you already ran step 4 on this machine, the default config will usually
already have `registry_repo_url` filled in.

Edit `~/.config/iranopasmigirim-producer/config.toml` and replace the
remaining placeholder values at minimum for:

- `signing_key`
- `whitelist_hosts`

If you skipped step 4 or you are using a custom config path, also set
`registry_repo_url` manually.

Quick validation of that config:

```bash
./setup.sh producer
```

Full producer host provisioning:

```bash
python3 pusher/mirror_and_push.py setup-system \
  --install-deps \
  --registry-repo-url https://github.com/YOUR_USER/YOUR_REGISTRY_REPO \
  --signing-key 0xYOUR_LONG_KEY_ID
```

The root `--install-deps` path supports `apt-get`, `dnf`, `yum`, `pacman`,
`zypper`, and `apk` on Linux producer hosts, and it also ensures the active
Python runtime can parse TOML configs.

Use `pusher/mirror.service` and `pusher/mirror.timer` if you prefer manual
systemd installation.

Today, the allowed website set is configured in two places:

- producer config `whitelist_hosts` in your real TOML file: controls which
  hosts the producer will mirror
- `iranopasmigirim-mirror/src/config.js` -> `WHITELIST`: controls which
  hosts and paths the extension will request and accept

Keep those host lists aligned. If a host is missing from either one, the flow
will fail.

If you want a non-default config location, `./setup.sh producer /path/to/config.toml`
will create that file automatically when it does not exist yet.

## 6. Extension Release Configuration

Before building a release for users, update
`iranopasmigirim-mirror/src/config.js` with:

- the real registry repo URL
- the signer fingerprint list
- the signer public key block list
- the `WHITELIST` host/path policy

Then build:

```bash
./setup.sh dev build
```

## 7. Diagnostics

```bash
./setup.sh verify
python3 -m py_compile pusher/mirror_and_push.py
python3 -m unittest -v pusher.test_producer
curl https://api.github.com/repos/YOUR_USER/YOUR_REGISTRY_REPO
ssh -T git@github-work
```

## 8. Detailed Docs

- [iranopasmigirim-mirror/README.md](iranopasmigirim-mirror/README.md)
- [iranopasmigirim-mirror/DEPLOYMENT.md](iranopasmigirim-mirror/DEPLOYMENT.md)
- [iranopasmigirim-mirror/OPERATIONS.md](iranopasmigirim-mirror/OPERATIONS.md)

**Version:** 0.2.0
**Last Updated:** May 13, 2026
