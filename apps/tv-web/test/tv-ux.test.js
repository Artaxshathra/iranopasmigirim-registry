'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..', 'src');
const playerJs = fs.readFileSync(path.join(SRC, 'player.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(SRC, 'index.html'), 'utf8');

describe('tv-web TV UX: control bar', () => {
  it('control bar exists, is hidden by default, and is labelled', () => {
    assert.match(indexHtml, /<nav[^>]+id=["']control-bar["'][^>]*\bhidden\b[^>]*aria-label=/);
  });

  it('exposes Play and Audio-only as the only two D-pad targets', () => {
    const ids = [...indexHtml.matchAll(/<button[^>]+id=["']([^"']+)["']/g)].map(m => m[1]);
    assert.deepEqual(ids, ['btn-play', 'btn-audio']);
  });

  it('Audio button declares aria-pressed (state, not just label)', () => {
    assert.match(indexHtml, /id=["']btn-audio["'][^>]*aria-pressed=["']false["']/);
  });

  it('player keeps aria-pressed in sync with audio-only state', () => {
    assert.match(playerJs, /btnAudio\.setAttribute\(\s*['"]aria-pressed['"]\s*,\s*on\s*\?\s*['"]true['"]\s*:\s*['"]false['"]/);
  });

  it('control bar has its own focus styles (visible at 10 feet)', () => {
    const css = fs.readFileSync(path.join(SRC, 'player.css'), 'utf8');
    assert.match(css, /\.ctrl:focus(-visible)?\s*[,{]/);
    assert.match(css, /box-shadow[^;]*rgba\(196,\s*30,\s*58/, 'focus ring uses brand accent');
  });
});

describe('tv-web TV UX: idle auto-hide', () => {
  it('idle timeout is at least 8s (longer than mouse-driven UI)', () => {
    const m = playerJs.match(/IDLE_HIDE_MS\s*=\s*(\d+)/);
    assert.ok(m, 'IDLE_HIDE_MS must be defined');
    assert.ok(Number(m[1]) >= 8000, 'remote users need a longer idle window than mouse users');
  });

  it('idle timer is reset on every showBar/resetIdle', () => {
    assert.match(playerJs, /function resetIdle\(\)\s*\{[\s\S]*clearTimeout\(idleTimer\)[\s\S]*setTimeout\(hideBar/);
  });

  it('hideBar clears the idle timer (no zombie timeouts)', () => {
    const fn = playerJs.slice(playerJs.indexOf('function hideBar'),
                              playerJs.indexOf('function resetIdle'));
    assert.match(fn, /clearTimeout\(idleTimer\)/);
    assert.match(fn, /idleTimer\s*=\s*null/);
  });

  it('destroy() also clears idleTimer', () => {
    const fn = playerJs.slice(playerJs.indexOf('function destroy'),
                              playerJs.indexOf('function destroy') + 600);
    assert.match(fn, /clearTimeout\(\s*idleTimer\s*\)/);
  });
});

describe('tv-web TV UX: D-pad and remote keycodes', () => {
  it('maps Tizen + webOS Back keycodes (461, 10009) and Backspace (8)', () => {
    // The Back key arrives as a numeric keyCode without a meaningful e.key
    // on most TV firmware. Missing any of these strands the user in the app.
    assert.match(playerJs, /461\s*:\s*['"]back['"]/);
    assert.match(playerJs, /10009\s*:\s*['"]back['"]/);
    assert.match(playerJs, /8\s*:\s*['"]back['"]/);
  });

  it('maps the W3C media transport keycodes (Play=415, Pause=19)', () => {
    assert.match(playerJs, /415\s*:\s*['"]play['"]/);
    assert.match(playerJs, /19\s*:\s*['"]pause['"]/);
  });

  it('numeric remote codes are checked BEFORE named keys', () => {
    // Otherwise a Back press (e.key === '') would fall through the named
    // switch as no-op while the platform keeps thinking we handled it.
    const kb = playerJs.slice(playerJs.indexOf('function setupKeyboard'));
    const remoteIdx = kb.indexOf('REMOTE_KEYCODES[');
    const switchIdx = kb.indexOf('switch (e.key)');
    assert.ok(remoteIdx > 0 && switchIdx > 0);
    assert.ok(remoteIdx < switchIdx, 'remote-code lookup must precede named-key switch');
  });

  it('Back dismisses the bar when visible, exits when hidden', () => {
    const block = playerJs.slice(playerJs.indexOf("case 'back':"),
                                 playerJs.indexOf("case 'stop':"));
    assert.match(block, /isBarVisible\(\)/);
    assert.match(block, /hideBar\(\)/);
    assert.match(block, /platformExit\(\)/);
    assert.match(block, /preventDefault/, 'must consume Back when handled, so platform does not also exit');
  });

  it('Arrow keys move focus when bar is visible, reveal it when hidden', () => {
    const block = playerJs.slice(playerJs.indexOf("case 'left':"),
                                 playerJs.indexOf("case 'enter':"));
    assert.match(block, /isBarVisible\(\)/);
    assert.match(block, /moveFocus\(-1\)/);
    assert.match(block, /moveFocus\(1\)/);
    assert.match(block, /showBar\(\)/);
  });

  it('moveFocus wraps around the button list', () => {
    assert.match(playerJs, /\(\s*i\s*\+\s*dir\s*\+\s*buttons\.length\s*\)\s*%\s*buttons\.length/);
  });
});

describe('tv-web TV UX: platform integration', () => {
  it('feature-detects Tizen and webOS — never assumes either is present', () => {
    // Touching tizen.* or webOS.* unguarded throws ReferenceError in browsers
    // and on the other vendor's TV. Every reference must be try/catch + typeof.
    const hits = [...playerJs.matchAll(/\b(tizen|webOS)\b/g)];
    assert.ok(hits.length > 0, 'platform globals must be referenced somewhere');
    // Each platform reference must sit inside a typeof guard.
    assert.match(playerJs, /typeof\s+tizen\s*!==\s*['"]undefined['"]/);
    assert.match(playerJs, /typeof\s+webOS\s*!==\s*['"]undefined['"]/);
  });

  it('platformExit tries Tizen, then webOS, then no-ops cleanly', () => {
    const fn = playerJs.slice(playerJs.indexOf('function platformExit'),
                              playerJs.indexOf('// --- Branding fade ---'));
    assert.match(fn, /tizen\.application[\s\S]*\.exit\(\)/);
    assert.match(fn, /webOS\.platformBack\(\)/);
    // Must not throw if neither global is present.
    assert.match(fn, /try\s*\{[\s\S]*\}\s*catch/);
  });

  it('Tizen media keys are explicitly registered (otherwise system swallows them)', () => {
    assert.match(playerJs, /tizen\.tvinputdevice\.registerKey/);
    assert.match(playerJs, /MediaPlay/);
    assert.match(playerJs, /MediaPause/);
  });
});

describe('tv-web TV UX: state sync', () => {
  it('Play button label/icon track the actual <video> play state', () => {
    const fn = playerJs.slice(playerJs.indexOf('function setupControlBar'),
                              playerJs.indexOf('// --- Keyboard'));
    assert.match(fn, /video\.addEventListener\(\s*['"]play['"]/);
    assert.match(fn, /video\.addEventListener\(\s*['"]pause['"]/);
    assert.match(fn, /video\.paused/);
  });
});
