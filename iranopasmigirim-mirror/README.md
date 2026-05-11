# Mirror (Shahin)

Mirror is a GitHub-only offline snapshot extension with a request-response protocol.

---

## Quick Navigation

- Local test in a few minutes: [Quick Start (5-min)](#quick-start-5-min)
- Full production setup: [OPERATIONS.md](../OPERATIONS.md)
- Development workflow: [Local browser testing (simple)](#local-browser-testing-simple)
- System design and trust model: [Architecture](#architecture)

---

## Quick Start (5-min)

Want to test the extension locally in 2 commands?

```bash
npm run dev:chrome
# Load dist/chrome in Chrome at chrome://extensions

# Firefox build
npm run dev:firefox  
# Load dist/firefox in Firefox at about:debugging
```

**Full production guide (registry, producer server, user deployment):** See [OPERATIONS.md](../OPERATIONS.md)

---

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
npm run build
python3 -m py_compile pusher/mirror_and_push.py
python3 -m unittest -v pusher/test_producer.py
```

## Local browser testing (simple)

If you load `src/` directly, browser will fail with "Manifest file is missing" because manifests live at project root and build output is generated under `dist/`.

Run one command:

```bash
./scripts/test-local.sh chrome
```

or for Firefox:

```bash
./scripts/test-local.sh firefox
```

Then load the built folder in your browser:
- Chrome: `chrome://extensions` -> Developer mode -> Load unpacked -> `dist/chrome`
- Firefox: `about:debugging` -> This Firefox -> Load Temporary Add-on -> select any file inside `dist/firefox` (for example `manifest.json`)

Fast rebuild without tests:

```bash
npm run dev:chrome
npm run dev:firefox
```

## Main files

- Extension runtime: `src/background/`
- Popup workflow: `src/popup/`
- Protocol config: `src/config.js`
- Producer: `pusher/mirror_and_push.py`
- Extension tests: `test/`
- Producer tests: `pusher/test_producer.py`

## Going to Production

For a **complete, step-by-step guide** covering:

- Setting up the central registry repository on GitHub
- Deploying the producer server (installation, systemd timer, GPG keys)
- User onboarding workflow
- End-to-end example (request → approval → delivery → offline serving)
- Troubleshooting and maintenance

See [OPERATIONS.md](../OPERATIONS.md)

That document walks through:
1. **Phase 1:** Registry repository setup
2. **Phase 2:** Producer server setup (systemd automation)
3. **Phase 3:** Extension installation (Chrome + Firefox)
4. Complete user workflow with examples
5. Common issues and resolutions
6. Advanced configuration (approval workflows, rate limiting, geographic mirroring)

Start there if you're deploying this system beyond local testing.

## Notes

- This repository is now generic and no longer tied to a single legacy target website.
- Hardened release builds are gated by signer pins and registry URL checks (`scripts/release-gate.js`).
