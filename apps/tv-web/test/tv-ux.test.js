'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..');
const playerJs = fs.readFileSync(path.join(SRC, 'player.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(SRC, 'index.html'), 'utf8');

describe('tv-web TV UX: minimal chrome', () => {
  it('no docked control bar / play button / audio button in HTML', () => {
    // The app intentionally has no persistent chrome at the bottom of the
    // screen. Play state is communicated via the transient state pill.
    // Audio-only / "radio" mode is fully removed: Tizen has no PiP and no
    // reliable background-audio path, so the feature would just be a black
    // screen with the same chrome.
    assert.ok(!/id=["']control-bar["']/.test(indexHtml));
    assert.ok(!/id=["']btn-play["']/.test(indexHtml));
    assert.ok(!/id=["']btn-audio["']/.test(indexHtml));
    assert.ok(!/id=["']audio-face["']/.test(indexHtml));
  });

  it('no software volume bar (TV platform owns volume UI)', () => {
    // Hardware volume keys on the TV remote are routed to the platform's own
    // volume control, not the WebView. Drawing a software bar would be
    // confusing because it never reflects what the viewer actually changed.
    assert.ok(!/id=["']volume-bar["']/.test(indexHtml));
    assert.ok(!/showVolumeBar/.test(playerJs));
    assert.ok(!/adjustVolume/.test(playerJs));
  });

  it('keyboard handler does not bind ArrowUp/Down (no software volume)', () => {
    // ArrowUp/Down would silently mutate video.volume (HTML5 gain) which is
    // multiplied by the TV master and confusing relative to the platform OSD.
    const kb = playerJs.slice(playerJs.indexOf('function setupKeyboard'),
                              playerJs.indexOf('// --- Platform integration ---'));
    assert.ok(!/case\s+['"]ArrowUp['"]/.test(kb));
    assert.ok(!/case\s+['"]ArrowDown['"]/.test(kb));
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

  it('maps W3C media transport keycodes for play/pause', () => {
    // All transport codes collapse to a single 'playpause' toggle — there is
    // no distinct 'play' or 'pause' state to navigate to from the remote.
    assert.match(playerJs, /415\s*:\s*['"]playpause['"]/);
    assert.match(playerJs, /19\s*:\s*['"]playpause['"]/);
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

  it('Back opens the exit confirmation and consumes the event', () => {
    // Per Samsung's review checklist, Back on the main player must either
    // close immediately or surface a confirmation. We do the latter so an
    // accidental Back doesn't drop the viewer out of a live stream. The
    // event must still be preventDefault-ed so Tizen's platform Back
    // handler doesn't also fire and exit behind our dialog.
    //
    // We slice the *main* (non-exitOpen) branch of dispatchAction here,
    // anchored at the second occurrence of `case 'back':` to skip the
    // exit-dialog handler that sits earlier in the function.
    const allBackCases = [...playerJs.matchAll(/case 'back':/g)];
    assert.ok(allBackCases.length >= 2, "expected separate 'back' cases for dialog open vs. closed");
    const mainStart = allBackCases[allBackCases.length - 1].index;
    const block = playerJs.slice(mainStart, playerJs.indexOf("case 'stop':", mainStart));
    assert.match(block, /openExitDialog\(\)/);
    assert.match(block, /preventDefault/, 'must consume Back so platform does not also exit');
  });

  it('Stop key bypasses the exit dialog (deliberate "I am done" press)', () => {
    // The hardware Stop key is a deliberate end-of-watching gesture, not a
    // navigation hiccup. Going through the dialog for it would feel laggy.
    const stopIdx = playerJs.lastIndexOf("case 'stop':");
    const block = playerJs.slice(stopIdx, stopIdx + 200);
    assert.match(block, /platformExit\(\)/);
  });
});

describe('tv-web TV UX: platform integration', () => {
  it('feature-detects Tizen and webOS — never assumes either is present', () => {
    // Touching tizen.* or webOS.* unguarded throws ReferenceError in browsers
    // and on the other vendor's TV. Every reference must be typeof-guarded.
    const hits = [...playerJs.matchAll(/\b(tizen|webOS)\b/g)];
    assert.ok(hits.length > 0, 'platform globals must be referenced somewhere');
    assert.match(playerJs, /typeof\s+tizen\s*!==\s*['"]undefined['"]/);
    assert.match(playerJs, /typeof\s+webOS\s*!==\s*['"]undefined['"]/);
  });

  it('platformExit tries Tizen, then webOS, then no-ops cleanly', () => {
    const fn = playerJs.slice(playerJs.indexOf('function platformExit'),
                              playerJs.indexOf('// --- Branding fade ---'));
    assert.match(fn, /tizen\.application[\s\S]*\.exit\(\)/);
    assert.match(fn, /webOS\.platformBack\(\)/);
    assert.match(fn, /try\s*\{[\s\S]*\}\s*catch/);
  });

  it('Tizen media keys are explicitly registered (otherwise system swallows them)', () => {
    assert.match(playerJs, /tizen\.tvinputdevice\.registerKey/);
    assert.match(playerJs, /MediaPlay/);
    assert.match(playerJs, /MediaPause/);
  });
});
