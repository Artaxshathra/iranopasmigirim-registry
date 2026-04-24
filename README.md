# INRTV Live — Browser Extension

Watch **Iran National Revolution TV** live in a dedicated pop-up player, directly from your browser toolbar.

## Features

- One-click live stream in a clean pop-up window
- Built-in HLS player (hls.js, Apache-2.0)
- **Radio mode** — listen like a radio: the player window minimizes and audio keeps playing. Start it from the popup's "Listen (Radio)" button, or press `R` in the player to toggle anytime
- Double-click to toggle fullscreen; scoped to the player, not the whole page
- Keyboard shortcuts (press `?` in the player for the full list)
- Zero permissions — no browsing data, no tracking, no storage
- Chrome opens the player in a resizable popup window; Firefox opens it in a new tab (popup-type windows on Firefox have platform limitations)
- English and Persian (فارسی) store listings
- Works on Chrome and Firefox

## Install

| Store | Link |
|-------|------|
| Chrome Web Store | _coming soon_ |
| Firefox Add-ons (AMO) | _coming soon_ |

## Build from source

```bash
cd extensions/inrtv
./build.sh
```

Output: `extensions/inrtv/dist/inrtv-chrome.zip` and `inrtv-firefox.zip`.

Builds are reproducible — Chrome and Firefox zips are byte-identical across
runs (SOURCE_DATE_EPOCH, normalized mtimes, `zip -X`).

If you need to regenerate `src/lib/hls.min.js` from scratch (instead of using
the tracked copy), run `./bootstrap.sh` first — it downloads hls.js v1.6.16
and verifies its SHA-256.

## Project structure

```
extensions/inrtv/
  src/
    manifest.json          Chrome MV3 manifest
    popup.html/js/css      Toolbar popup
    player.html/js/css     Live stream player
    lib/hls.min.js         Bundled HLS library (tracked, SHA-256 pinned)
    icons/                 Extension icons (Lion and Sun)
    _locales/en, fa/       Store-listing strings (English + Persian)
  bootstrap.sh             Re-fetch and verify hls.js (optional)
  build.sh                 Package Chrome & Firefox zips (reproducible)
  LICENSE                  hls.js Apache-2.0 license
docs/
  privacy-policy.html      Privacy policy
store-assets/              Chrome Web Store images
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

Test suites (127 assertions across 7 files):

| Suite | What it checks |
|-------|----------------|
| `manifest.test.js` | MV3 structure, permissions, CSP, icons, en/fa locale parity |
| `html.test.js` | Accessibility, structure, asset references, no inline scripts/styles |
| `security.test.js` | No innerHTML/eval/http, no inline handlers, URL consistency |
| `player-logic.test.js` | Strict mode, cleanup, keyboard, radio mode, fullscreen target, a11y attributes |
| `build.test.js` | Zip contents, license banner, Firefox gecko settings |
| `bootstrap.test.js` | SHA-256 pinning, script integrity |
| `reproducibility.test.js` | Byte-identical zip output across builds |

## Privacy

This extension collects **no data**. See the full [privacy policy](docs/privacy-policy.html).

## Disclaimer

This is an **independent, unofficial** browser extension that plays the publicly
available INRTV live stream. It is not affiliated with, endorsed by, or sponsored
by Iran National Revolution TV or any related organization. All trademarks are
the property of their respective owners.

## License

Extension code: MIT  
hls.js: Apache-2.0 (bundled in `src/lib/`)
