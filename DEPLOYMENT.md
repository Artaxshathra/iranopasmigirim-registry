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
- reruns safely

## 5. Producer Setup

Quick validation of an existing producer config:

```bash
./setup.sh producer /path/to/your/config.toml
```

Full producer host provisioning:

```bash
python3 pusher/mirror_and_push.py setup-system \
  --registry-repo-url https://github.com/YOUR_USER/YOUR_REGISTRY_REPO \
  --signing-key 0xYOUR_LONG_KEY_ID
```

Use `pusher/mirror.service` and `pusher/mirror.timer` if you prefer manual
systemd installation.

## 6. Extension Release Configuration

Before building a release for users, update
`iranopasmigirim-mirror/src/config.js` with:

- the real registry repo URL
- the signer fingerprint list
- the signer public key block list

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
