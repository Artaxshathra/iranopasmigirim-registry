# INRTV Live — Browser Extension

Watch **Iran National Revolution TV** live in a dedicated pop-up player, directly from your browser toolbar.

## Features

- One-click live stream in a clean pop-up window
- Built-in HLS player (hls.js, Apache-2.0)
- Zero permissions — no browsing data, no tracking, no storage
- Works on Chrome and Firefox

## Install

| Store | Link |
|-------|------|
| Chrome Web Store | _coming soon_ |
| Firefox Add-ons (AMO) | _coming soon_ |

## Build from source

```bash
cd extensions/inrtv

# Download hls.js (one-time, SHA-256 verified)
./bootstrap.sh

# Build Chrome + Firefox zips
./build.sh
```

Output: `extensions/inrtv/dist/inrtv-chrome.zip` and `inrtv-firefox.zip`.

## Project structure

```
extensions/inrtv/
  src/
    manifest.json       Chrome MV3 manifest
    popup.html/js/css   Toolbar popup
    player.html/js/css  Live stream player
    lib/hls.min.js      Bundled HLS library (gitignored)
    icons/              Extension icons (Lion and Sun)
    _locales/en/        English strings
  bootstrap.sh          Download + verify hls.js
  build.sh              Package Chrome & Firefox zips
  LICENSE               hls.js Apache-2.0 license
docs/
  privacy-policy.html   Privacy policy
store-assets/           Chrome Web Store images
```

## Stream

The extension plays the live HLS stream at:

```
https://hls.irannrtv.live/hls/stream.m3u8
```

H.264 High 1280×720 25fps, AAC-LC 48 kHz stereo, 5-second TS segments.

## Testing

Tests use the Node.js built-in test runner (zero dependencies).

```bash
# From repo root
npm test

# Or from the extension directory
cd extensions/inrtv
npm test
```

Test suites:

| Suite | What it checks |
|-------|----------------|
| `manifest.test.js` | MV3 structure, permissions, CSP, icons, i18n |
| `html.test.js` | Accessibility, structure, asset references |
| `security.test.js` | No innerHTML/eval/http, no inline handlers, URL consistency |
| `player-logic.test.js` | Strict mode, cleanup, keyboard, aria-label updates |
| `build.test.js` | Zip contents, license banner, Firefox gecko settings |
| `bootstrap.test.js` | SHA-256 pinning, script integrity |

## Privacy

This extension collects **no data**. See the full [privacy policy](docs/privacy-policy.html).

## License

Extension code: MIT  
hls.js: Apache-2.0 (bundled in `src/lib/`)
