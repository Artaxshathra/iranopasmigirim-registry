# Changelog

All notable changes to the INRTV Live extension.

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
