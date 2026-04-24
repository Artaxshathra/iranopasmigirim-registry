# Changelog

All notable changes to the INRTV Live extension.

## [1.1.0] — 2026-04-24

### Added
- **Radio mode** — press `R` or click the new toolbar button to hide the video
  and listen to the stream like a radio. Minimal pulsing face with "Radio mode"
  label; no new permissions or network activity (the audio is muxed into the
  existing HLS stream)
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
