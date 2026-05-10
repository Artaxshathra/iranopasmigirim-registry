# Mirror (Shahin)

Mirror is a GitHub-only offline snapshot extension with a request-response protocol.

## Architecture

1. User registers by committing a request document to a fixed registry repository.
2. Producer validates request policy and ownership proof.
3. Producer mirrors approved website content, sanitizes active surfaces, signs delivery commits, and pushes to the user's repository delivery branch.
4. Extension verifies signatures, syncs files incrementally, and serves the snapshot from extension origin.

## Security model

- Signature verification is mandatory by default.
- Host whitelist is enforced during registration and sync manifest validation.
- Serve-time path policy blocks out-of-policy snapshot paths.
- Mirror output is read-only and sanitizes risky interactive surfaces.

## Current workflow

- Extension
  - Configure your GitHub repository URL in popup.
  - Create a registration package from popup.
  - Commit generated request file to registry repo.
  - Commit generated ownership nonce file to your own repo.
  - Refresh status in popup.
  - Sync and open offline snapshot.

- Producer
  - Run `pusher/mirror_and_push.py` with `run-once` or `daemon`.
  - Producer reads registry requests, verifies ownership, mirrors approved hosts, pushes delivery, and writes status files.

## Build and test

```bash
npm test
node build.js both
python3 -m py_compile pusher/mirror_and_push.py
python3 -m unittest -v pusher/test_producer.py
```

## Main files

- Extension runtime: `src/background/`
- Popup workflow: `src/popup/`
- Protocol config: `src/config.js`
- Producer: `pusher/mirror_and_push.py`
- Extension tests: `test/`
- Producer tests: `pusher/test_producer.py`

## Notes

- This repository is now generic and no longer tied to a single legacy target website.
- If release signing pins are not configured, release-gate scripts intentionally fail hardened release builds.
