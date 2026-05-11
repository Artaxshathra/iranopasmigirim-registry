# Mirror (Shahin)

Mirror is a GitHub-only offline snapshot extension with a request-response protocol.

---

## Quick Start

Setup everything with one command:

```bash
./setup.sh dev
```

This builds the extension locally. Load dist/chrome in Chrome at chrome://extensions.

---

## All Commands

```bash
./setup.sh dev                              # Local development
./setup.sh dev test                         # Run tests
./setup.sh dev build                        # Production build
./setup.sh registry OWNER REPO              # Setup registry on GitHub
./setup.sh producer CONFIG_PATH             # Setup producer server
./setup.sh install-ext PATH                 # Install extension
./setup.sh verify                           # Run quality checks
./setup.sh clean                            # Clean artifacts
./setup.sh help                             # Show help
```

---

## How It Works

User creates request → Producer mirrors & signs → Extension verifies & caches → User opens offline

---

## Architecture

1. User commits request to registry repository
2. Producer validates ownership proof and whitelisted host
3. Producer scrapes site, sanitizes content, signs delivery commit
4. Extension verifies signature against pinned producer key
5. Extension stores and serves site offline from IndexedDB

Security enforced at each step:
- Mandatory OpenPGP signature verification
- Host whitelist enforcement (sync and serve time)
- XSS/injection sanitization in producer
- Git ref syntax validation
- Manifest size limits and JSON parsing guards
- Path policy enforcement per whitelisted host

---

## Project Structure

- Extension runtime: src/background/
- Extension UI: src/popup/
- Configuration: src/config.js
- Producer: pusher/mirror_and_push.py
- Tests: test/, pusher/test_producer.py
- Setup: setup.sh (all commands)

---

## Full Documentation

Production setup guide (registry, producer, user onboarding):
[OPERATIONS.md](OPERATIONS.md)

Quick deployment checklists and diagnostics:
[DEPLOYMENT.md](DEPLOYMENT.md)

---

## Testing and Building

Run all verifications:

```bash
./setup.sh verify
```

Results:
- 80 extension tests
- 14 producer tests
- Python syntax validation
- Production build validation

---

## Development

Build for local testing:

```bash
./setup.sh dev chrome
```

or

```bash
./setup.sh dev firefox
```

Then load dist/chrome or dist/firefox in your browser.

---

## Notes

- Generic and not tied to a single website
- Hardened release builds with enforced trust pins
- All data stored locally (no cloud sync)
- Requires GitHub connectivity for requests and deliveries

---

**Version:** 0.2.0
**Last Updated:** May 11, 2026
