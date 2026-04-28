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

describe('tv-web polish: live-edge enforcement', () => {
  it('LEVEL_LOADED handler snaps playback to liveSyncPosition on cold start', () => {
    // Without this, hls.js can start a few segments back from live (the
    // manifest's EXT-X-START or the head of the live window), which the
    // viewer perceives as "the app showed yesterday for a few seconds
    // before catching up". Snapping to liveSyncPosition on cold start
    // eliminates the visible drift.
    assert.match(playerJs, /Hls\.Events\.LEVEL_LOADED/);
    const handler = playerJs.slice(playerJs.indexOf('Hls.Events.LEVEL_LOADED'),
                                   playerJs.indexOf('Hls.Events.LEVEL_LOADED') + 600);
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
    const handlerStart = playerJs.indexOf("hls.on(Hls.Events.FRAG_LOADED");
    assert.ok(handlerStart > 0, 'FRAG_LOADED handler must exist');
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
    const enterCase = playerJs.match(/case\s+['"]enter['"]\s*:[\s\S]*?break;/);
    assert.ok(enterCase, "'enter' case must exist in dispatchAction");
    assert.match(enterCase[0], /overlayError\.hidden/);
    assert.match(enterCase[0], /manualRetry\(\)/);
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
