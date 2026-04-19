# Contributing to INRTV Live

## Prerequisites

- Node.js ≥ 18 (22+ recommended)
- `curl`, `tar`, `zip` (standard on Linux/macOS; Git Bash on Windows)
- Chrome or Firefox for manual testing

## Setup

```bash
git clone git@github.com:ardeshiri/inrtv-extension.git
cd inrtv-extension

# Download hls.js (one-time, SHA-256 verified)
cd extensions/inrtv
./bootstrap.sh
```

## Development workflow

### Source files

All extension source is in `extensions/inrtv/src/`. Plain HTML, CSS, and JS — no bundler, no transpiler.

| File | Purpose |
|------|---------|
| `manifest.json` | Chrome MV3 manifest |
| `popup.html/js/css` | Toolbar popup UI |
| `player.html/js/css` | Live stream player |
| `lib/hls.min.js` | HLS library (gitignored, built by bootstrap.sh) |
| `_locales/en/messages.json` | Extension name and description |

### Load in browser

**Chrome:**
1. Go to `chrome://extensions`
2. Enable "Developer mode"
3. Click "Load unpacked" → select `extensions/inrtv/src/`

**Firefox:**
1. Go to `about:debugging#/runtime/this-firefox`
2. Click "Load Temporary Add-on" → select `extensions/inrtv/src/manifest.json`

### Run tests

```bash
npm test                  # From repo root (runs all workspaces)
cd extensions/inrtv && npm test   # Extension tests only
```

Tests use Node's built-in `node:test` runner — zero dependencies.

### Build

```bash
cd extensions/inrtv
./build.sh
```

Produces `dist/inrtv-chrome.zip` and `dist/inrtv-firefox.zip`.

## Code style

- **Plain ES5-ish JavaScript** — no modules, no classes, no arrow functions. The extension runs directly in the browser with no build step.
- `'use strict'` at the top of every JS file.
- DOM manipulation via `textContent` and `setAttribute` only — never `innerHTML`.
- All user-facing text is safe (no HTML interpolation).

## Security rules

These are enforced by the test suite:

- No `innerHTML`, `outerHTML`, `document.write`, `eval`, or `new Function()`
- No `http://` URLs — HTTPS everywhere
- No inline scripts, inline styles, or inline event handlers in HTML
- No external `<script>` sources — all code is local
- CSP must include `script-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'`
- `permissions` array must not exist in manifest
- `host_permissions` must use `https://` scheme only

## Pull request checklist

- [ ] `npm test` passes (all 6 suites)
- [ ] `./build.sh` succeeds
- [ ] No new permissions added to manifest
- [ ] No innerHTML or unsafe DOM APIs introduced
- [ ] Tested manually in Chrome and/or Firefox
- [ ] CHANGELOG.md updated if user-facing changes
