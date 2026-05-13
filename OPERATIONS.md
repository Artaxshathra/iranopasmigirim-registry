# Mirror Operations (Workspace Index)

The mirror project lives in `iranopasmigirim-mirror/`. Run mirror commands from
that directory, not from the workspace root.

## Start Here

```bash
cd /home/arash/Code/IPM/iranopasmigirim-mirror
```

## Current Command Forms

```bash
./setup.sh dev
./setup.sh verify
./setup.sh registry OWNER REPO [SSH_ALIAS]
./setup.sh producer [CONFIG_PATH]
```

## Multi-Account GitHub

If you use a dedicated SSH alias for mirror operations, verify it first:

```bash
ssh -T git@YOUR_ALIAS
./setup.sh registry OWNER REPO YOUR_ALIAS
```

## Detailed Runbooks

- [iranopasmigirim-mirror/README.md](iranopasmigirim-mirror/README.md)
- [iranopasmigirim-mirror/DEPLOYMENT.md](iranopasmigirim-mirror/DEPLOYMENT.md)
- [iranopasmigirim-mirror/OPERATIONS.md](iranopasmigirim-mirror/OPERATIONS.md)

## Notes

- The registry bootstrap script now supports an optional SSH alias and keeps
  reruns idempotent.
- The producer helper now bootstraps the default config automatically at
  `~/.config/iranopasmigirim-producer/config.toml` when missing.
- Replace the producer config placeholder values, especially
  `registry_repo_url`, `signing_key`, and `whitelist_hosts`, before
  deployment.
- The extension release still needs a real registry URL and signer pins in
  `iranopasmigirim-mirror/src/config.js` before building for users.

**Version:** 0.2.0
**Last Updated:** May 13, 2026
