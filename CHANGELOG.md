# Changelog

All notable changes to the INRTV Live extension.

## [1.1.1] — 2026-04-25

### Fixed
- **Crash on close after a network error.** The fatal-network retry was
  scheduled with `setTimeout` but never tracked. If the player window closed
  before it fired, the callback ran against a destroyed `hls` instance and
  threw. Retry is now stored in `retryTimer`, cancelled by `destroy()`, and
  guards `if (!hls) return` defensively.
- **Stacked overlays on early failures.** `showError()` only unhid the error
  overlay, so the loading spinner stayed visible behind it. Error and
  play-prompt overlays are now mutually exclusive — showing one hides the
  others.
- **Brittle radio-mode layout.** `#radio-face` used a hard-coded `bottom: 34px`
  to dodge the controls bar. Wrapped `#video` and `#radio-face` in a new
  `#video-area` flex item so radio-face can use `inset: 0` within its own
  positioning context — survives font/zoom/control-height changes.
- **Help overlay copy.** "Radio mode (audio only)" → "Radio mode (audio focus)"
  to match what the mode actually does (the HLS stream still demuxes; the
  video surface is just hidden).

### Changed
- All teardown lives in a single `destroy()` function — retry timer, idle
  timer, branding-fade timer, stats interval, and `hls`. Adding new resources
  becomes one-line safe.
- Behavior tunables are now named constants at the top of `player.js`:
  `RETRY_DELAY_MS`, `IDLE_TIMEOUT_MS`, `BRANDING_FADE_DELAY_MS`,
  `STATS_INTERVAL_MS`, plus `PLAYER_WIDTH`/`PLAYER_HEIGHT` in `popup.js`.

### Tests
- 145/145 (added 9 covering retry-timer cleanup, mutually-exclusive overlays,
  named-constants usage, `#video-area` HTML structure, no-magic-offset CSS
  regression guard).

## [1.1.0] — 2026-04-24

### Added
- **Radio mode** — press `R`, click the toolbar button, or start directly from
  the popup's "Listen (Radio)" button. Hides the video, minimizes the player
  window, and keeps audio playing so it truly feels like a radio. Toggles back
  to video cleanly (window restores, video re-appears — audio never stops). The
  popup reuses an already-open player window: clicking Watch or Listen switches
  the existing window's mode instead of opening a duplicate. No new permissions.
- The radio button's icon names the *next* action: in video mode it shows the
  radio glyph (click → switch to radio); in radio mode it shows the TV glyph
  (click → switch back to video). `aria-label` mirrors this.
- **Double-click to toggle fullscreen** — matches universal video-player
  convention
- **Persian (`fa`) locale** for the store listing (`تلویزیون انقلاب ملی ایران
  — پخش زنده`)
- **Keyboard shortcuts help overlay** — press `?` to toggle

### Changed
- Fullscreen now targets the player container instead of the whole document,
  so only the video area expands
- Controls, branding, and cursor auto-hide after 3 s of inactivity
- Tightened hls.js live-edge tuning (lower back-buffer, `maxLiveSyncPlaybackRate`)
- Switched `var` → `const`/`let` throughout `player.js`

### Fixed
- `R` key is now blocked while text input has focus (defensive, no current
  inputs exist)
- Radio-mode overlay now correctly layers above error/loading overlays
- `f` / `p` keyboard shortcuts are no-ops in radio mode to avoid meaningless
  fullscreen/PiP on a hidden video
- Radio toggle button now follows the WAI-ARIA toggle convention (stable
  label + `aria-pressed`) — no more contradictory screen-reader announcements

### Security
- MV3 CSP hardened: `worker-src 'self'` (blob: forbidden by Chrome MV3 parser;
  hls.js runs on the main thread with `enableWorker: false`)
- `base-uri 'self'` and `frame-ancestors 'none'` added to CSP
- `connect-src` and `media-src` pinned to the stream host
- **Dropped `host_permissions`** — CSP `connect-src`/`media-src` pins are the
  real network-egress control. Firefox MV3 was surfacing a misleading "Can't
  read and change data on this site" message on our toolbar icon because of
  the declaration, without adding any capability we actually use

### Firefox
- Player opens in a new tab on Firefox instead of a popup-type window.
  Firefox's `windows.create({type:'popup',...})` ignores requested dimensions
  and popup-type windows can't reliably minimize, so radio mode's
  minimize-on-entry was a silent no-op. Opening as a tab gives full browser
  chrome, proper resizing, and consistent behavior. Chrome is unchanged
  (still a 960×560 popup window that minimizes in radio mode)

### Build
- Reproducible zips (SOURCE_DATE_EPOCH, mtime normalization, `zip -X`) — Chrome
  and Firefox artifacts are byte-identical across builds
- `hls.js` is now tracked in git so source zips are self-sufficient (previously
  gitignored and only present after running `bootstrap.sh`)

## [1.0.0] — 2026-04-20

### Added
- One-click live stream player in a pop-up window (960×560)
- Built-in HLS playback via hls.js v1.6.16 (Apache-2.0)
- Player controls: play/pause, mute, volume slider, PiP, fullscreen
- Keyboard shortcuts: Space/K (play), M (mute), F (fullscreen), P (PiP), arrows (volume)
- Live stream stats overlay (resolution, bitrate, buffer health)
- Error overlay with automatic retry on network/media errors
- Accessibility: aria-labels on all controls, role/aria-live on error overlay
- Privacy policy documenting zero data collection
- Chrome and Firefox support via single codebase + build script
- SHA-256 pinned hls.js download (bootstrap.sh)
- Comprehensive test suite (manifest, HTML, security, logic, build, bootstrap)

### Security
- Manifest V3 with zero permissions (no storage, activeTab, tabs, etc.)
- Single host_permission: `https://hls.irannrtv.live/*` (HTTPS only)
- CSP: `script-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'`
- No background scripts, content scripts, or web-accessible resources
- No innerHTML, eval, document.write, or inline event handlers
- All DOM text insertion via textContent
- hls.js integrity verified by SHA-256 at download time
