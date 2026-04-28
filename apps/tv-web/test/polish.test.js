'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const SRC = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(SRC, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(SRC, 'player.css'), 'utf8');
const playerJs = fs.readFileSync(path.join(SRC, 'player.js'), 'utf8');

describe('tv-web polish: HTML splash', () => {
  it('declares a splash element with the lion icon', () => {
    assert.match(html, /<div\s+id=["']splash["']/, 'splash container required');
    // The HTML splash must reuse icon.png so the launcher → platform
    // splash → in-app splash chain is visually continuous.
    assert.match(html, /<img[^>]+class=["']splash-mark["'][^>]+src=["']icon\.png["']/);
  });

  it('player hides the splash on first frame and via a hard cap', () => {
    // setupSplash must subscribe to 'playing' (first frame) AND start a
    // SPLASH_MAX_MS fallback so a broken stream still surfaces error UI.
    const fn = playerJs.slice(playerJs.indexOf('function setupSplash'),
                              playerJs.indexOf('function hideSplash'));
    assert.match(fn, /addEventListener\(\s*['"]playing['"]\s*,\s*hideSplash/);
    assert.match(fn, /SPLASH_MAX_MS/);
    assert.match(playerJs, /SPLASH_MAX_MS\s*=\s*\d+/);
  });

  it('splash CSS fades (transition + .fade rule)', () => {
    assert.match(css, /#splash\s*\{[\s\S]*?transition:\s*opacity/);
    assert.match(css, /#splash\.fade\s*\{[\s\S]*?opacity:\s*0/);
  });
});

describe('tv-web polish: LIVE badge', () => {
  it('badge exists with channel name and pulsing dot', () => {
    assert.match(html, /<div[^>]+id=["']live-badge["']/);
    assert.match(html, /<span\s+class=["']live-dot["']/);
    assert.match(html, /<span\s+class=["']live-channel["']>INRTV<\/span>/);
  });

  it('badge dot has a pulse animation (slowly, not seizure-fast)', () => {
    assert.match(css, /\.live-dot\s*\{[\s\S]*?animation:\s*live-pulse\s+(\d+)s/);
    const m = css.match(/animation:\s*live-pulse\s+(\d+)s/);
    assert.ok(Number(m[1]) >= 2, 'pulse must be slow enough to feel ambient');
  });

  it('badge animation is suppressed under prefers-reduced-motion', () => {
    const block = css.match(/@media\s*\(prefers-reduced-motion[^)]+\)\s*\{[\s\S]*?\}/g)
      .map(s => s).join('\n');
    assert.match(block, /\.live-dot[^}]*animation:\s*none/);
  });

  it('player dims the badge after a settle delay (not immediately)', () => {
    assert.match(playerJs, /LIVE_BADGE_DIM_DELAY_MS\s*=\s*(\d+)/);
    const m = playerJs.match(/LIVE_BADGE_DIM_DELAY_MS\s*=\s*(\d+)/);
    assert.ok(Number(m[1]) >= 8000, 'badge must not dim faster than the chrome bar hides');
    assert.match(playerJs, /liveBadge\.classList\.add\(\s*['"]dim['"]/);
  });

  it('badge is hidden in HTML by default (only revealed once truly live)', () => {
    // Showing a red pulsing "LIVE" dot before the first frame is a lie —
    // the picture might still be loading or the stream might be down.
    assert.match(html, /id=["']live-badge["'][^>]*\bhidden\b/);
  });

  it('badge has a .stale rule that greys the dot and stops the pulse', () => {
    // While buffering or on error, the dot must not pulse red — that would
    // tell the viewer "you're watching live" while the picture is frozen.
    assert.match(css, /\.live-badge\.stale\s+\.live-dot[\s\S]*?animation:\s*none/);
    assert.match(css, /\.live-badge\.stale\s+\.live-dot[\s\S]*?background:\s*var\(--dim\)/);
  });

  it('player marks the badge stale on waiting/error and revives on playing', () => {
    // markBadgeStale must be called from waiting + showError; showLiveBadge
    // must clear stale on each 'playing' so a recovered stream lights up
    // the dot again.
    assert.match(playerJs, /function markBadgeStale/);
    assert.match(playerJs, /function showLiveBadge/);
    const setupBadge = playerJs.slice(playerJs.indexOf('function setupBadge'),
                                      playerJs.indexOf('function setupBadge') + 800);
    assert.match(setupBadge, /addEventListener\(\s*['"]waiting['"]\s*,\s*markBadgeStale/);
    assert.match(setupBadge, /showLiveBadge\(\)/);
    const showErr = playerJs.slice(playerJs.indexOf('function showError'),
                                   playerJs.indexOf('function showError') + 400);
    assert.match(showErr, /markBadgeStale\(\)/,
      'showError must mark the badge stale (no live dot during errors)');
  });
});

describe('tv-web polish: resume on return (wake-from-sleep / app switch)', () => {
  it('tracks the wall-clock time of the last loaded fragment', () => {
    // Without this, maybeResume() can't tell stale from fresh.
    assert.match(playerJs, /lastFragLoadedAt/);
    const fragHandler = playerJs.slice(playerJs.indexOf('function onFragLoaded'),
                                       playerJs.indexOf('function onFragLoaded') + 600);
    assert.match(fragHandler, /lastFragLoadedAt\s*=\s*Date\.now\(\)/);
  });

  it('maybeResume forces a reload when the player is stale', () => {
    const fn = playerJs.slice(playerJs.indexOf('function maybeResume'),
                              playerJs.indexOf('function setupResume'));
    assert.match(fn, /RESUME_STALENESS_MS/);
    // -1 tells hls.js to pick liveSyncPosition; LEVEL_LOADED then snaps
    // currentTime if needed. Plain startLoad() would resume from the last
    // play position, which is exactly what we're trying to avoid.
    assert.match(fn, /startLoad\(\s*-1\s*\)/);
    assert.match(fn, /stopLoad\(\)/);
  });

  it('setupResume wires pageshow + visibilitychange', () => {
    // pageshow fires on BFCache restore + wake-from-sleep on TV WebViews.
    // visibilitychange fires on app-switch return. Both paths matter.
    const fn = playerJs.slice(playerJs.indexOf('function setupResume'),
                              playerJs.indexOf('function setupResume') + 600);
    assert.match(fn, /addEventListener\(\s*['"]pageshow['"]\s*,\s*maybeResume/);
    assert.match(fn, /addEventListener\(\s*['"]visibilitychange['"]/);
    assert.match(fn, /document\.visibilityState\s*===\s*['"]visible['"]/);
  });

  it('resume staleness threshold is reasonable (15-60s window)', () => {
    const m = playerJs.match(/RESUME_STALENESS_MS\s*=\s*(\d+)/);
    assert.ok(m, 'RESUME_STALENESS_MS must be defined');
    const v = Number(m[1]);
    assert.ok(v >= 15000 && v <= 60000,
      'staleness must be 15-60s; shorter triggers spurious reloads, longer feels broken');
  });

  it('init() wires setupResume', () => {
    const initFn = playerJs.slice(playerJs.indexOf('function init'),
                                  playerJs.indexOf('function init') + 800);
    assert.match(initFn, /setupResume\(\)/);
  });
});

describe('tv-web polish: slow-connection whisper', () => {
  it('subscribes to LEVEL_SWITCHED to detect quality drops', () => {
    assert.match(playerJs, /Hls\.Events\.LEVEL_SWITCHED/);
    assert.match(playerJs, /function onLevelSwitched/);
  });

  it('only fires after a debounce, not on a single dip to lowest level', () => {
    // A single switch to level 0 can be a momentary fluctuation. Only
    // sustained pinning to level 0 indicates a genuinely slow connection.
    assert.match(playerJs, /SLOW_CONNECTION_DEBOUNCE_MS\s*=\s*(\d+)/);
    const m = playerJs.match(/SLOW_CONNECTION_DEBOUNCE_MS\s*=\s*(\d+)/);
    assert.ok(Number(m[1]) >= 15000,
      'debounce must be long enough that a transient dip does not show the label');
  });

  it('clears the whisper as soon as quality switches back up', () => {
    const fn = playerJs.slice(playerJs.indexOf('function onLevelSwitched'),
                              playerJs.indexOf('function onLevelSwitched') + 800);
    assert.match(fn, /hideSlowConnection\(\)/);
  });

  it('uses the i18n key (translatable, not a hard-coded English string)', () => {
    assert.match(playerJs, /t\(\s*['"]slowConnection['"]/);
    const en = JSON.parse(fs.readFileSync(path.join(SRC, '_locales/en/messages.json'), 'utf8'));
    const fa = JSON.parse(fs.readFileSync(path.join(SRC, '_locales/fa/messages.json'), 'utf8'));
    assert.ok(en.slowConnection && en.slowConnection.message);
    assert.ok(fa.slowConnection && fa.slowConnection.message);
    // The English wording matters: "Slow connection" reads as the network,
    // not "Weak signal" which implies an antenna/RF source the TV doesn't have.
    assert.ok(/slow/i.test(en.slowConnection.message));
  });

  it('subtitle CSS sits inside the badge (no new positioned element)', () => {
    // Adding a separate positioned element would risk overlapping branding
    // or other corner UI. Rendering inside .live-badge keeps everything
    // co-located and pre-mirrored under RTL.
    assert.match(css, /\.live-slow\s*\{/);
    assert.match(css, /html\[dir="rtl"\]\s+\.live-slow/);
  });

  it('destroy() clears the slow-connection timer (no zombie firings after teardown)', () => {
    const fn = playerJs.slice(playerJs.indexOf('function destroy'),
                              playerJs.indexOf('function destroy') + 1500);
    assert.match(fn, /clearTimeout\(\s*slowConnectionTimer\s*\)/);
  });
});

describe('tv-web polish: stream pre-warm', () => {
  it('prewarmStream fires before setupI18n in init()', () => {
    // Pre-warming during locale load overlaps TLS handshake + manifest
    // fetch with i18n setup, so the manifest is in cache by the time
    // hls.js requests it. Running it after setupI18n would defeat the point.
    const initFn = playerJs.slice(playerJs.indexOf('function init'),
                                  playerJs.indexOf('function init') + 800);
    const prewarm = initFn.indexOf('prewarmStream()');
    const i18n = initFn.indexOf('setupI18n(');
    assert.ok(prewarm >= 0, 'prewarmStream() must be called from init()');
    assert.ok(i18n >= 0, 'setupI18n() must be called from init()');
    assert.ok(prewarm < i18n, 'prewarm must run before setupI18n to overlap with locale fetch');
  });

  it('prewarmStream targets STREAM_URL and is wrapped in try/catch', () => {
    // Pre-warm is best-effort: a throw on older Tizen WebViews must not
    // break cold start. The XHR has no handlers because we only care
    // about the connection-pool/HTTP-cache side effect.
    const fn = playerJs.slice(playerJs.indexOf('function prewarmStream'),
                              playerJs.indexOf('function init'));
    assert.match(fn, /try\s*\{[\s\S]*\}\s*catch/);
    assert.match(fn, /STREAM_URL/);
    assert.match(fn, /prewarmXhr\.send\(\)/);
  });
});

describe('tv-web polish: live-edge enforcement', () => {
  it('LEVEL_LOADED handler snaps playback to liveSyncPosition on cold start', () => {
    // Without this, hls.js can start a few segments back from live (the
    // manifest's EXT-X-START or the head of the live window), which the
    // viewer perceives as "the app showed yesterday for a few seconds
    // before catching up". Snapping to liveSyncPosition on cold start
    // eliminates the visible drift.
    assert.match(playerJs, /Hls\.Events\.LEVEL_LOADED/);
    const handler = playerJs.slice(playerJs.indexOf('function onLevelLoaded'),
                                   playerJs.indexOf('function onLevelLoaded') + 600);
    assert.match(handler, /liveSyncPosition/);
    assert.match(handler, /currentTime/);
    assert.match(handler, /details\.live/, 'must guard on details.live (VOD must not snap)');
  });
});

describe('tv-web polish: i18n + RTL', () => {
  it('player picks fa locale when navigator.language starts with fa', () => {
    // Must inspect navigator.language and strip region. Anything else
    // (e.g. matching only exact "fa") would miss fa-IR / fa-AF.
    const fn = playerJs.slice(playerJs.indexOf('function pickLocale'),
                              playerJs.indexOf('function applyTranslations'));
    assert.match(fn, /navigator\.language/);
    assert.match(fn, /startsWith\(\s*['"]fa['"]/);
  });

  it('player sets <html dir="rtl"> for the fa locale', () => {
    assert.match(playerJs, /setAttribute\(\s*['"]dir['"]\s*,\s*['"]rtl['"]/);
    assert.match(playerJs, /setAttribute\(\s*['"]lang['"]/);
  });

  it('CSS mirrors corner elements when dir="rtl"', () => {
    // LIVE badge and branding watermark are positioned by edge — RTL
    // layout must flip them or they'll sit on the wrong side of frame.
    assert.match(css, /html\[dir="rtl"\]\s+\.live-badge[^}]*right:/);
    assert.match(css, /html\[dir="rtl"\]\s+\.branding[^}]*left:/);
  });

  it('every data-i18n key in HTML has a matching message in en + fa', () => {
    const keys = [...html.matchAll(/data-i18n=["']([^"']+)["']/g)].map(m => m[1]);
    assert.ok(keys.length > 0, 'HTML must declare at least one i18n key');
    const en = JSON.parse(fs.readFileSync(path.join(SRC, '_locales/en/messages.json'), 'utf8'));
    const fa = JSON.parse(fs.readFileSync(path.join(SRC, '_locales/fa/messages.json'), 'utf8'));
    for (const k of keys) {
      assert.ok(en[k] && en[k].message, `en is missing i18n key "${k}"`);
      assert.ok(fa[k] && fa[k].message, `fa is missing i18n key "${k}"`);
    }
  });

  it('every t() call in player.js references a key present in en + fa', () => {
    // Catches silent fallbacks where a typo'd key would always render the
    // English fallback even on a Persian TV.
    const en = JSON.parse(fs.readFileSync(path.join(SRC, '_locales/en/messages.json'), 'utf8'));
    const fa = JSON.parse(fs.readFileSync(path.join(SRC, '_locales/fa/messages.json'), 'utf8'));
    const calls = [...playerJs.matchAll(/\bt\(\s*['"]([a-zA-Z][a-zA-Z0-9_]*)['"]/g)].map(m => m[1]);
    assert.ok(calls.length > 0);
    for (const k of calls) {
      assert.ok(en[k], `en missing t() key "${k}"`);
      assert.ok(fa[k], `fa missing t() key "${k}"`);
    }
  });

  it('locale fetch is same-origin (CSP allows nothing else for connect)', () => {
    // Anything beyond a relative path would hit the connect-src whitelist
    // and be rejected by the WebView's CSP.
    assert.match(playerJs, /xhr\.open\(\s*['"]GET['"]\s*,\s*['"]_locales\//);
  });
});

describe('tv-web polish: Vazirmatn font', () => {
  const fontPath = path.join(SRC, 'lib/fonts/Vazirmatn-wght.woff2');
  const licensePath = path.join(SRC, 'lib/fonts/Vazirmatn-OFL.txt');
  const PINNED_SHA = '4e3fa217d38fdafc1fea4414ceb58ca5e662cf0ab5fa735a8c8c20e8b42cad92';

  it('variable woff2 + OFL license are bundled', () => {
    assert.ok(fs.existsSync(fontPath), 'Vazirmatn variable woff2 must be present');
    assert.ok(fs.existsSync(licensePath), 'OFL.txt must accompany the font (license requirement)');
  });

  it('woff2 sha-256 matches the SHA pinned in bootstrap.sh', () => {
    // If a re-fetch ever drifted, this catches it before we ship a font
    // we did not audit.
    const bytes = fs.readFileSync(fontPath);
    const sha = crypto.createHash('sha256').update(bytes).digest('hex');
    assert.equal(sha, PINNED_SHA, 'tracked font diverged from bootstrap.sh pin');
    const boot = fs.readFileSync(path.join(SRC, 'bootstrap.sh'), 'utf8');
    const m = boot.match(/VAZ_WOFF2_SHA256="([0-9a-f]+)"/);
    assert.ok(m, 'bootstrap.sh must declare VAZ_WOFF2_SHA256');
    assert.equal(m[1], PINNED_SHA, 'bootstrap.sh pin must equal the tracked SHA');
  });

  it('CSS @font-face references the bundled woff2', () => {
    assert.match(css, /@font-face[\s\S]*?Vazirmatn[\s\S]*?lib\/fonts\/Vazirmatn-wght\.woff2/);
  });

  it('body font-family lists Vazirmatn first', () => {
    const m = css.match(/body[\s\S]*?font-family:\s*([^;]+);/);
    assert.ok(m, 'body font-family must be set');
    assert.match(m[1], /^['"]?Vazirmatn['"]?\s*,/);
  });

  it('OFL license file is non-empty and credits Vazirmatn project', () => {
    const txt = fs.readFileSync(licensePath, 'utf8');
    assert.ok(txt.length > 1000, 'OFL.txt looks truncated');
    assert.match(txt, /SIL Open Font License/);
    assert.match(txt, /Vazirmatn/);
  });
});

describe('tv-web polish: cold-retry resilience', () => {
  it('cold-retry triggers when fast retries are exhausted', () => {
    // Without enterColdRetry the user sees "Stream is offline" once and
    // never reconnects — they have to restart the app.
    assert.match(playerJs, /function enterColdRetry/);
    assert.match(playerJs, /COLD_RETRY_DELAY_MS\s*=\s*\d+/);
    const m = playerJs.match(/COLD_RETRY_DELAY_MS\s*=\s*(\d+)/);
    assert.ok(Number(m[1]) >= 15000, 'cold retry must not hammer the origin during outage');
  });

  it('cold-retry timer is cleared on FRAG_LOADED (so a recovery stops polling)', () => {
    // The FRAG_LOADED handler is the only path that knows the stream is
    // back; if it doesn't kill the cold-retry timer, the slow poll keeps
    // calling startLoad() during normal playback.
    const handlerStart = playerJs.indexOf("function onFragLoaded");
    assert.ok(handlerStart > 0, 'onFragLoaded handler must exist');
    const fragBlock = playerJs.slice(handlerStart, handlerStart + 400);
    assert.match(fragBlock, /coldRetryTimer/);
    assert.match(fragBlock, /clearTimeout\(coldRetryTimer\)/);
  });

  it('NETWORK_ERROR escalates to cold-retry instead of giving up', () => {
    const block = playerJs.slice(playerJs.indexOf('NETWORK_ERROR'),
                                 playerJs.indexOf('MEDIA_ERROR'));
    assert.match(block, /enterColdRetry\(\)/, 'NETWORK_ERROR exhaustion must enter cold-retry');
  });

  it('destroy() clears the cold-retry timer (no zombie polls after teardown)', () => {
    const fn = playerJs.slice(playerJs.indexOf('function destroy'),
                              playerJs.indexOf('function destroy') + 800);
    assert.match(fn, /clearTimeout\(\s*coldRetryTimer\s*\)/);
  });
});

describe('tv-web polish: leak hygiene', () => {
  it('every timer variable that is set is also cleared in destroy()', () => {
    const destroy = playerJs.slice(playerJs.indexOf('function destroy'),
                                   playerJs.indexOf('function destroy') + 1200);
    // Find every `setTimeout(...)` that assigns to a `*Timer`/`*Timeout` ident.
    const assignRe = /(\w*(?:Timer|Timeout))\s*=\s*setTimeout\(/g;
    const owned = new Set();
    let m;
    while ((m = assignRe.exec(playerJs)) !== null) owned.add(m[1]);
    assert.ok(owned.size > 0, 'expected at least one tracked timer');
    for (const name of owned) {
      assert.match(destroy, new RegExp('clearTimeout\\(\\s*' + name + '\\s*\\)'),
        `destroy() must clear ${name}`);
    }
  });
});

describe('tv-web polish: buffering indicator', () => {
  it('subscribes to waiting/playing on the video element', () => {
    // Mid-stream stalls are silent without this — the picture freezes and
    // the viewer doesn't know whether the app is broken or the stream is.
    const fn = playerJs.slice(playerJs.indexOf('function setupBuffering'),
                              playerJs.indexOf('function setupBuffering') + 800);
    assert.match(fn, /addEventListener\(\s*['"]waiting['"]/);
    assert.match(fn, /addEventListener\(\s*['"]playing['"]/);
  });

  it('debounces the buffering overlay (no flicker on sub-second jitter)', () => {
    // Showing the spinner for every 200 ms hiccup feels broken. Wait long
    // enough that only real stalls surface UI.
    assert.match(playerJs, /BUFFERING_DEBOUNCE_MS\s*=\s*(\d+)/);
    const m = playerJs.match(/BUFFERING_DEBOUNCE_MS\s*=\s*(\d+)/);
    assert.ok(Number(m[1]) >= 400 && Number(m[1]) <= 1500,
      'debounce should be 400-1500ms; outside that, it either flickers or feels stuck');
  });

  it('buffering does not stomp the error overlay (error takes precedence)', () => {
    const fn = playerJs.slice(playerJs.indexOf('function setupBuffering'),
                              playerJs.indexOf('function setupBuffering') + 800);
    assert.match(fn, /overlayError\.hidden/);
  });
});

describe('tv-web polish: manual retry from error overlay', () => {
  it('Enter on error overlay calls manualRetry instead of activating chrome', () => {
    // Without this branch a viewer stuck on "Stream is offline" can't escape
    // without restarting the app — Enter would just toggle the chrome.
    // We grab the *last* 'enter' case (the main-screen branch) — earlier
    // ones belong to the exit-dialog handler in dispatchAction.
    const all = [...playerJs.matchAll(/case\s+['"]enter['"]\s*:[\s\S]*?break;/g)];
    assert.ok(all.length >= 1, "'enter' case must exist in dispatchAction");
    const main = all[all.length - 1][0];
    assert.match(main, /overlayError\.hidden/);
    assert.match(main, /manualRetry\(\)/);
  });

  it('manualRetry is rate-limited (no origin hammering on key-mash)', () => {
    assert.match(playerJs, /MANUAL_RETRY_COOLDOWN_MS\s*=\s*(\d+)/);
    const m = playerJs.match(/MANUAL_RETRY_COOLDOWN_MS\s*=\s*(\d+)/);
    assert.ok(Number(m[1]) >= 1500, 'cooldown too short, will hammer origin');
    const fn = playerJs.slice(playerJs.indexOf('function manualRetry'),
                              playerJs.indexOf('function manualRetry') + 600);
    assert.match(fn, /lastManualRetryAt/);
  });

  it('manualRetry clears retry/cold-retry timers (no double-trigger)', () => {
    const fn = playerJs.slice(playerJs.indexOf('function manualRetry'),
                              playerJs.indexOf('function manualRetry') + 600);
    assert.match(fn, /clearTimeout\(\s*retryTimer\s*\)/);
    assert.match(fn, /clearTimeout\(\s*coldRetryTimer\s*\)/);
  });

  it('error overlay declares the retry hint with i18n key', () => {
    const html = fs.readFileSync(path.join(SRC, 'index.html'), 'utf8');
    assert.match(html, /id=["']error-hint["'][^>]+data-i18n=["']errRetryHint["']/);
  });
});

describe('tv-web polish: transient state pill (play/pause feedback)', () => {
  it('pill element + both SVG icons exist in HTML, pill hidden by default', () => {
    const html = fs.readFileSync(path.join(SRC, 'index.html'), 'utf8');
    assert.match(html, /id=["']state-pill["'][^>]*\bhidden\b/,
      'pill must start hidden so it never flashes on load');
    // Two SVGs share the slot; player.js swaps which is visible. Vector
    // glyphs stay crisp at any TV scale; font glyphs (▶/⏸) render fuzzy.
    assert.match(html, /id=["']state-pill-icon-play["'][\s\S]*?<\/svg>/);
    assert.match(html, /id=["']state-pill-icon-pause["'][\s\S]*?<\/svg>/);
    // Older Tizen WebViews don't apply the UA's [hidden]{display:none} rule
    // to inline SVG, so we hide the pause icon via inline style instead.
    assert.match(html, /id=["']state-pill-icon-pause["'][^>]*style=["']display:\s*none["']/,
      'pause SVG must start hidden via inline style (Tizen ignores [hidden] on SVG)');
  });

  it('setupStatePill subscribes to play AND pause events', () => {
    const fn = playerJs.slice(playerJs.indexOf('function setupStatePill'),
                              playerJs.indexOf('function flashStatePill'));
    assert.match(fn, /addEventListener\(\s*['"]play['"]/);
    assert.match(fn, /addEventListener\(\s*['"]pause['"]/);
  });

  it('flashStatePill swaps SVG visibility via style.display (Tizen-safe)', () => {
    // Older Tizen WebViews don't honor the [hidden] attribute on inline SVG;
    // toggling .hidden on the SVG element left both icons drawn on top of
    // each other. style.display is universally honored.
    const fn = playerJs.slice(playerJs.indexOf('function flashStatePill'),
                              playerJs.indexOf('function flashStatePill') + 1000);
    assert.match(fn, /statePillIconPlay\.style\.display/);
    assert.match(fn, /statePillIconPause\.style\.display/);
    // No textContent assignment — that would mean we regressed back to
    // setting a unicode glyph instead of toggling the SVGs.
    assert.ok(!/textContent\s*=/.test(fn),
      'flashStatePill must not write textContent (use SVG toggle instead)');
  });

  it('first play event is suppressed (autoplay is not a viewer toggle)', () => {
    // Without this, the pill flashes "▶" on every cold start. That's noise,
    // not feedback — the viewer didn't press anything.
    assert.match(playerJs, /firstPlayHandled/);
    const fn = playerJs.slice(playerJs.indexOf('function setupStatePill'),
                              playerJs.indexOf('function flashStatePill'));
    assert.match(fn, /firstPlayHandled\s*=\s*true/);
  });

  it('pill auto-hides after a brief window (1000-2000ms)', () => {
    assert.match(playerJs, /STATE_PILL_HIDE_MS\s*=\s*(\d+)/);
    const m = playerJs.match(/STATE_PILL_HIDE_MS\s*=\s*(\d+)/);
    assert.ok(Number(m[1]) >= 1000 && Number(m[1]) <= 2000,
      'hide window should be 1-2s; longer feels stuck, shorter is unreadable');
  });

  it('pill animation is suppressed under prefers-reduced-motion', () => {
    assert.match(css, /@media\s*\([^)]*prefers-reduced-motion[^)]*\)[^}]*\{[\s\S]*?\.state-pill[^}]*transform:\s*none/);
  });
});

describe('tv-web polish: loading caption translated', () => {
  it('loading caption uses data-i18n (not hard-coded English)', () => {
    const html = fs.readFileSync(path.join(SRC, 'index.html'), 'utf8');
    assert.match(html, /class=["']loading-caption["'][^>]+data-i18n=["']loadingCaption["']/);
  });
});

describe('tv-web polish: audio-only feature fully removed', () => {
  it('no audio-only chrome of any kind in HTML', () => {
    // Tizen has no PiP or reliable background-audio for non-allowlisted
    // apps, so an "audio only" mode on TV would just be a black screen
    // with the same chrome — pointless. Removed from HTML, CSS, JS, and
    // locales so the surface area stays minimal.
    assert.ok(!/id=["']btn-audio-only["']/.test(html));
    assert.ok(!/id=["']audio-face["']/.test(html));
    assert.ok(!/class=["']audio-toggle/.test(html));
    assert.ok(!/data-i18n(?:-aria)?=["']audioOnly/.test(html));
  });

  it('no audio-only CSS rules left behind', () => {
    assert.ok(!/#audio-face/.test(css));
    assert.ok(!/\.audio-(?:pulse|label|sub|toggle)/.test(css));
    assert.ok(!/body\.audio-only/.test(css));
  });

  it('no audio-only locale keys left behind', () => {
    const en = JSON.parse(fs.readFileSync(path.join(SRC, '_locales/en/messages.json'), 'utf8'));
    const fa = JSON.parse(fs.readFileSync(path.join(SRC, '_locales/fa/messages.json'), 'utf8'));
    assert.ok(!('audioOnlyLabel' in en));
    assert.ok(!('audioOnlySub' in en));
    assert.ok(!('audioOnlyLabel' in fa));
    assert.ok(!('audioOnlySub' in fa));
  });
});

describe('tv-web polish: hls listener hygiene', () => {
  it('the five hls.on subscriptions all use named functions (so destroy can off them)', () => {
    // Inline arrow listeners can't be unsubscribed because there's no stable
    // reference to pass to hls.off(). Promoting them to named functions lets
    // destroy() detach cleanly, so a late-firing event into a half-destroyed
    // hls instance can't throw during app shutdown.
    const expected = [
      ['MANIFEST_PARSED', 'onManifestParsed'],
      ['LEVEL_LOADED', 'onLevelLoaded'],
      ['ERROR', 'onHlsError'],
      ['FRAG_LOADED', 'onFragLoaded'],
      ['LEVEL_SWITCHED', 'onLevelSwitched'],
    ];
    for (const [evt, fn] of expected) {
      const re = new RegExp('hls\\.on\\(\\s*Hls\\.Events\\.' + evt + '\\s*,\\s*' + fn + '\\s*\\)');
      assert.match(playerJs, re, `Hls.Events.${evt} must subscribe ${fn} (named)`);
    }
  });

  it('destroy() unsubscribes every hls listener before hls.destroy()', () => {
    const fn = playerJs.slice(playerJs.indexOf('function destroy'),
                              playerJs.indexOf('function destroy') + 2000);
    const expected = ['onManifestParsed', 'onLevelLoaded', 'onHlsError',
                      'onFragLoaded', 'onLevelSwitched'];
    for (const name of expected) {
      const re = new RegExp('hls\\.off\\([^)]*,\\s*' + name + '\\s*\\)');
      assert.match(fn, re, `destroy() must hls.off(..., ${name})`);
    }
    // Order matters: off() must precede destroy(), otherwise destroy() may
    // already have nulled internal listener tables.
    const offIdx = fn.search(/hls\.off\(/);
    const destIdx = fn.search(/hls\.destroy\(/);
    assert.ok(offIdx > 0 && destIdx > offIdx,
      'hls.off() calls must come before hls.destroy()');
  });
});

describe('tv-web polish: prewarm XHR is abortable', () => {
  it('prewarmStream stores the XHR in a module variable and clears it onloadend', () => {
    // Without a stored reference, destroy() can't abort an in-flight prewarm.
    // The reference is cleared once the request completes so abort() is a
    // no-op for already-finished requests.
    const fn = playerJs.slice(playerJs.indexOf('function prewarmStream'),
                              playerJs.indexOf('function init'));
    assert.match(fn, /prewarmXhr\s*=\s*new\s+XMLHttpRequest/);
    assert.match(fn, /onloadend\s*=\s*function[^}]*prewarmXhr\s*=\s*null/);
  });

  it('destroy() aborts a still-pending prewarm', () => {
    const fn = playerJs.slice(playerJs.indexOf('function destroy'),
                              playerJs.indexOf('function destroy') + 2000);
    assert.match(fn, /prewarmXhr/);
    assert.match(fn, /prewarmXhr\.abort\(\)/);
  });
});

describe('tv-web polish: resume debounce', () => {
  it('maybeResume guards against double-fire from pageshow + visibilitychange', () => {
    // pageshow + visibilitychange can both fire on the same wake event.
    // Without a debounce we'd issue stopLoad/startLoad twice in quick
    // succession, producing a visible re-buffer.
    assert.match(playerJs, /RESUME_DEBOUNCE_MS\s*=\s*(\d+)/);
    const m = playerJs.match(/RESUME_DEBOUNCE_MS\s*=\s*(\d+)/);
    assert.ok(Number(m[1]) >= 30000,
      'debounce must be long enough that double-fires are gated; ~60s is right');
    const fn = playerJs.slice(playerJs.indexOf('function maybeResume'),
                              playerJs.indexOf('function setupResume'));
    assert.match(fn, /lastResumeAt/);
    assert.match(fn, /RESUME_DEBOUNCE_MS/);
  });
});

describe('tv-web polish: state pill fade timer is tracked', () => {
  it('the inner fade-out setTimeout assigns to statePillFadeTimer', () => {
    // Previously this was an orphan setTimeout — destroy() could not clear it,
    // so a teardown mid-fade would leave a callback that touched a stale
    // statePill ref. Tracking it lets destroy() clean up properly.
    const fn = playerJs.slice(playerJs.indexOf('function flashStatePill'),
                              playerJs.indexOf('function flashStatePill') + 1500);
    assert.match(fn, /statePillFadeTimer\s*=\s*setTimeout/);
  });
});

describe('tv-web polish: GPU-friendly CSS', () => {
  it('font-display is swap (no FOIT on cold start over slow Wi-Fi)', () => {
    // `block` would render the splash text invisible until the woff2 lands,
    // which on a slow TV connection can be >100ms. swap shows the system-ui
    // fallback immediately, then swaps in Vazirmatn — invisible to a viewer
    // sitting 3m away, but eliminates the FOIT.
    assert.match(css, /font-display:\s*swap/);
    assert.ok(!/font-display:\s*block/.test(css),
      'no font-display: block (would FOIT on slow TVs)');
  });

  it('state-pill backdrop-filter drops saturate() and uses a smaller blur', () => {
    // backdrop-filter blur radius and the saturate() pass are both GPU-bound
    // on weak Tizen SoCs. 12px without saturate looks identical to 18px+sat
    // at 10-foot viewing distance.
    const block = css.match(/\.state-pill\s*\{[\s\S]*?\}/)[0];
    assert.match(block, /backdrop-filter:\s*blur\(12px\)\s*;/);
    assert.ok(!/backdrop-filter:[^;]*saturate/.test(block),
      'state-pill backdrop-filter must not include saturate() (GPU-expensive)');
  });

  it('state-pill icon drop-shadow uses a tight blur radius', () => {
    // drop-shadow blur is also GPU-bound; 4px is indistinguishable from 12px
    // at TV distance. Smaller radius = less per-frame fillrate cost.
    const block = css.match(/\.state-pill-icon\s*\{[\s\S]*?\}/)[0];
    assert.match(block, /drop-shadow\(0\s+1px\s+4px/);
  });
});

describe('tv-web polish: exit confirmation (Samsung review checklist)', () => {
  it('overlay + two buttons + i18n keys exist in HTML, hidden by default', () => {
    // Samsung's review checklist: Back on the main player must either close
    // immediately or surface a confirmation. We do the latter so an
    // accidental Back doesn't drop a viewer out of a live stream.
    assert.match(html, /id=["']overlay-exit["'][^>]*\bhidden\b/,
      'exit overlay must start hidden so it never flashes on load');
    assert.match(html, /id=["']exit-btn-yes["'][^>]+data-i18n=["']exitYes["']/);
    assert.match(html, /id=["']exit-btn-no["'][^>]+data-i18n=["']exitNo["']/);
    assert.match(html, /class=["']exit-title["'][^>]+data-i18n=["']exitTitle["']/);
  });

  it('all three i18n keys are translated in en + fa', () => {
    const en = JSON.parse(fs.readFileSync(path.join(SRC, '_locales/en/messages.json'), 'utf8'));
    const fa = JSON.parse(fs.readFileSync(path.join(SRC, '_locales/fa/messages.json'), 'utf8'));
    for (const k of ['exitTitle', 'exitYes', 'exitNo']) {
      assert.ok(en[k] && en[k].message, `en missing "${k}"`);
      assert.ok(fa[k] && fa[k].message, `fa missing "${k}"`);
    }
  });

  it('Back on the main screen opens the dialog (does not exit immediately)', () => {
    // Samsung reviewers test this manually: a single Back press from the
    // player should NOT exit the app silently. It must surface the
    // confirmation dialog. The exit only happens after explicit OK on
    // the Exit button.
    assert.match(playerJs, /function openExitDialog/);
    assert.match(playerJs, /function closeExitDialog/);
    // The main-screen back branch (last 'case back': in dispatchAction)
    // calls openExitDialog, NOT platformExit.
    const allBack = [...playerJs.matchAll(/case 'back':/g)];
    const mainBack = playerJs.slice(allBack[allBack.length - 1].index,
                                    playerJs.indexOf("case 'stop':", allBack[allBack.length - 1].index));
    assert.match(mainBack, /openExitDialog\(\)/);
    assert.ok(!/platformExit\(\)/.test(mainBack),
      'main-screen Back must open the dialog, not exit directly');
  });

  it('OK on the focused Exit button calls platformExit; OK on Cancel dismisses', () => {
    // The dialog branch must dispatch on exitFocus: 'yes' → platformExit,
    // 'no' → close. Without this, OK would always do the same thing.
    const dispatchStart = playerJs.indexOf('function dispatchAction');
    const dispatchEnd = playerJs.indexOf('function setupKeyboard');
    const dispatch = playerJs.slice(dispatchStart, dispatchEnd);
    // The exit-dialog branch is gated on exitOpen and contains both paths.
    assert.match(dispatch, /if\s*\(\s*exitOpen\s*\)/);
    assert.match(dispatch, /exitFocus\s*===\s*['"]yes['"][\s\S]*?platformExit\(\)/);
    assert.match(dispatch, /closeExitDialog\(\)/);
  });

  it('LEFT/RIGHT toggle which button is focused', () => {
    // On a TV remote there is no pointer, so dialog navigation is purely
    // directional. LEFT focuses Exit (the first/default), RIGHT focuses
    // Cancel. Without this the dialog is unreachable for a viewer who
    // accidentally pressed Back and wants to dismiss.
    const dispatchStart = playerJs.indexOf('function dispatchAction');
    const dispatchEnd = playerJs.indexOf('function setupKeyboard');
    const dispatch = playerJs.slice(dispatchStart, dispatchEnd);
    assert.match(dispatch, /case 'left':[\s\S]*?setExitFocus\(\s*['"]yes['"]/);
    assert.match(dispatch, /case 'right':[\s\S]*?setExitFocus\(\s*['"]no['"]/);
  });

  it('LEFT/RIGHT/OK remote keycodes are mapped (37, 39, 13)', () => {
    // Without these the dialog is keyboard-only and unreachable from a
    // real remote. Standard W3C codes work on both Tizen and webOS for
    // the directional pad and OK button.
    const map = playerJs.slice(playerJs.indexOf('REMOTE_KEYCODES'),
                               playerJs.indexOf('};', playerJs.indexOf('REMOTE_KEYCODES')));
    assert.match(map, /37:\s*['"]left['"]/);
    assert.match(map, /39:\s*['"]right['"]/);
    assert.match(map, /13:\s*['"]enter['"]/);
  });

  it('Back while the dialog is open dismisses it (does not exit)', () => {
    // Two-Back-presses-to-exit is a valid pattern, but more confusingly:
    // a viewer who pressed Back wants to back out, including out of the
    // dialog itself. We close on a second Back so the only way to actually
    // exit is an explicit OK on the Exit button.
    const dispatchStart = playerJs.indexOf('function dispatchAction');
    const dispatchEnd = playerJs.indexOf('function setupKeyboard');
    const dispatch = playerJs.slice(dispatchStart, dispatchEnd);
    // The first 'case back:' in dispatchAction belongs to the exitOpen
    // branch (dispatchAction is structured: if(exitOpen){switch}return;
    // switch(action){...}). It must call closeExitDialog().
    const firstBack = dispatch.indexOf("case 'back':");
    assert.ok(firstBack > 0, "'back' case must appear in dispatchAction");
    const exitBackBlock = dispatch.slice(firstBack, firstBack + 600);
    assert.match(exitBackBlock, /closeExitDialog\(\)/);
  });

  it('opening the dialog pauses playback (audio behind a modal is jarring)', () => {
    const fn = playerJs.slice(playerJs.indexOf('function openExitDialog'),
                              playerJs.indexOf('function closeExitDialog'));
    assert.match(fn, /video\.pause\(\)/);
  });

  it('cancelling the dialog resumes playback', () => {
    const fn = playerJs.slice(playerJs.indexOf('function closeExitDialog'),
                              playerJs.indexOf('function closeExitDialog') + 600);
    assert.match(fn, /safePlay\(\)/);
  });

  it('focused button gets a clearly-visible accent ring + scale (10-foot UI)', () => {
    // Samsung checklist: focus must be "extremely obvious — glowing border
    // or scale effect". Both, in our case.
    assert.match(css, /\.exit-btn\.focused\s*\{[\s\S]*?border-color:\s*var\(--accent\)/);
    assert.match(css, /\.exit-btn\.focused\s*\{[\s\S]*?transform:\s*scale\(/);
  });

  it('focus animation is suppressed under prefers-reduced-motion', () => {
    assert.match(css,
      /@media\s*\([^)]*prefers-reduced-motion[^)]*\)[\s\S]*?\.exit-btn\.focused[^}]*transform:\s*none/);
  });

  it('overlayExit destructure is present (the JS handle the dialog needs)', () => {
    assert.match(playerJs, /const\s+overlayExit\s*=\s*document\.getElementById\(['"]overlay-exit['"]/);
    assert.match(playerJs, /const\s+exitBtnYes\s*=\s*document\.getElementById\(['"]exit-btn-yes['"]/);
    assert.match(playerJs, /const\s+exitBtnNo\s*=\s*document\.getElementById\(['"]exit-btn-no['"]/);
  });

  it('exit fade-out timer is tracked and cleared in destroy()', () => {
    // Same hygiene rule we apply elsewhere: every setTimeout that the app
    // could outlive must be releasable from destroy().
    assert.match(playerJs, /exitFadeTimer\s*=\s*setTimeout/);
    const destroy = playerJs.slice(playerJs.indexOf('function destroy'),
                                   playerJs.indexOf('function destroy') + 2500);
    assert.match(destroy, /clearTimeout\(\s*exitFadeTimer\s*\)/);
  });
});

describe('tv-web polish: 5% safe-zone (TV overscan)', () => {
  it('LIVE badge sits on the 96px (5%) safe-zone line, not the bezel', () => {
    // Older Tizen sets can crop ~5% via overscan. 1.7% margins risk getting
    // clipped. 96px on a 1920×1080 reference frame is exactly 5%.
    const block = css.match(/\.live-badge\s*\{[\s\S]*?\}/)[0];
    assert.match(block, /top:\s*96px/);
    assert.match(block, /left:\s*96px/);
  });

  it('branding watermark sits on the 96px (5%) safe-zone line', () => {
    const block = css.match(/\.branding\s*\{[\s\S]*?\}/)[0];
    assert.match(block, /top:\s*96px/);
    assert.match(block, /right:\s*96px/);
  });

  it('RTL mirrors keep the 96px margin on the flipped side', () => {
    assert.match(css, /html\[dir="rtl"\]\s+\.live-badge[^}]*right:\s*96px/);
    assert.match(css, /html\[dir="rtl"\]\s+\.branding[^}]*left:\s*96px/);
  });
});

describe('tv-web polish: launcher icon = extension icon', () => {
  it('icon.png is byte-identical to the extension icon (same brand mark)', () => {
    // The TV launcher tile, the platform splash, the in-app HTML splash,
    // and the browser extension all show the same lion. If they diverge,
    // the brand looks inconsistent across surfaces.
    const tv = fs.readFileSync(path.join(SRC, 'icon.png'));
    const ext = fs.readFileSync(path.join(__dirname, '..', '..', '..',
      'extensions', 'inrtv', 'src', 'icons', 'icon128.png'));
    const tvHash = crypto.createHash('sha256').update(tv).digest('hex');
    const extHash = crypto.createHash('sha256').update(ext).digest('hex');
    assert.equal(tvHash, extHash,
      'apps/tv-web/icon.png must equal extensions/inrtv/src/icons/icon128.png');
  });
});
