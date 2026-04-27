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
