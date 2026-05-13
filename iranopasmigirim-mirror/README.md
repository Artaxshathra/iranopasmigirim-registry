# Mirror (Shahin)

Mirror is a GitHub-backed offline snapshot system: a browser extension handles
user-side request and sync flows, and the producer validates requests, mirrors
approved content, and signs delivery commits.

## Quick Start

From this directory:

```bash
./setup.sh dev
```

That installs dependencies, runs the extension tests, and builds the Chrome
development bundle in `dist/chrome`.

## Command Reference

```bash
./setup.sh dev                              # Install deps, test, build Chrome dev bundle
./setup.sh dev test                         # Run extension tests only
./setup.sh dev chrome                       # Build Chrome dev bundle
./setup.sh dev firefox                      # Build Firefox dev bundle
./setup.sh dev build                        # Run release build
./setup.sh registry OWNER REPO [SSH_ALIAS]  # Bootstrap registry branches/config
./setup.sh producer CONFIG_PATH             # Validate producer prerequisites/config
./setup.sh install-ext PATH                 # Print browser install steps
./setup.sh verify                           # Extension tests + producer tests + build
./setup.sh clean                            # Remove build artifacts
./setup.sh help                             # Show help
```

## Multi-Account GitHub

If you use a dedicated GitHub identity for mirror operations, configure an SSH
alias and pass it as the optional third argument to `registry`:

```sshconfig
Host github-work
  HostName github.com
  User git
  IdentityFile ~/.ssh/id_ed25519_mirror
  IdentitiesOnly yes
```

```bash
ssh -T git@github-work
./setup.sh registry YOUR_GITHUB_USERNAME iranopasmigirim-registry github-work
```

If you use your default GitHub SSH identity, omit the alias argument.

## Release Notes

Before shipping a real deployment, update [src/config.js](src/config.js) with
your actual registry repository URL and signer pins, then rebuild with:

```bash
./setup.sh dev build
```

For producer configuration, start from
[pusher/mirror.toml.example](pusher/mirror.toml.example).

## Documentation

- [DEPLOYMENT.md](DEPLOYMENT.md): quick setup checklist and diagnostics
- [OPERATIONS.md](OPERATIONS.md): detailed registry, producer, and release flow
- [pusher/README.md](pusher/README.md): producer-specific CLI and config notes

## Verification

```bash
./setup.sh verify
```

This runs the extension test suite, producer unit tests, Python syntax checks,
and the production build gate.

## Project Layout

- `src/background/`: extension runtime, sync, registry, and serving logic
- `src/popup/`: extension UI for configuration and request flow
- `src/config.js`: release-time registry and trust-pin configuration
- `pusher/mirror_and_push.py`: producer CLI and automation entrypoint
- `test/`: extension tests
- `setup.sh`: local setup, registry bootstrap, and validation helper

**Version:** 0.2.0
**Last Updated:** May 13, 2026
