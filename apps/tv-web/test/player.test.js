'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..');
const playerJs = fs.readFileSync(path.join(SRC, 'player.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(SRC, 'index.html'), 'utf8');

describe('tv-web player.js', () => {
  it('starts with use strict', () => {
    assert.ok(playerJs.trimStart().startsWith("'use strict'"));
  });

  it('STREAM_URL is https and well-formed', () => {
    const m = playerJs.match(/STREAM_URL\s*=\s*['"]([^'"]+)['"]/);
    assert.ok(m, 'STREAM_URL must be defined');
    const url = new URL(m[1]);
    assert.equal(url.protocol, 'https:');
    assert.ok(url.pathname.endsWith('.m3u8'), 'stream should be .m3u8');
  });

  it('all DOM getElementById calls reference IDs in index.html', () => {
    const ids = [...playerJs.matchAll(/getElementById\(['"]([^'"]+)['"]\)/g)].map(m => m[1]);
    assert.ok(ids.length > 0);
    for (const id of ids) {
      assert.ok(new RegExp(`id=["']${id}["']`).test(indexHtml),
        `player.js references #${id} but it's not in index.html`);
    }
  });

  it('does not depend on any extension-only API (chrome.*, browser.*)', () => {
    // The TV app must be a clean fork — no MV3 surface should leak in.
    // Strip comments first so prose explanations of the fork can mention
    // "chrome.runtime" without tripping the source-text scan.
    const code = playerJs
      .replace(/\/\/[^\n]*/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(!/\bchrome\./.test(code), 'must not reference chrome.* in code');
    assert.ok(!/\bbrowser\./.test(code), 'must not reference browser.* in code');
  });

  it('teardown: a single destroy() owns all cleanup, fired on pagehide', () => {
    assert.match(playerJs, /function destroy\s*\(\s*\)\s*\{/);
    assert.match(playerJs, /addEventListener\(\s*['"]pagehide['"]\s*,\s*destroy\s*\)/);
  });

  it('teardown: destroy() clears every timer and the hls instance', () => {
    const fn = playerJs.slice(playerJs.indexOf('function destroy'),
                              playerJs.indexOf('function destroy') + 600);
    assert.match(fn, /clearTimeout\(\s*retryTimer\s*\)/);
    assert.match(fn, /clearTimeout\(\s*brandingTimer\s*\)/);
    assert.match(fn, /clearTimeout\(\s*nativeTimeout\s*\)/);
    assert.match(fn, /hls\.destroy\(\)/);
  });

  it('caps fatal NETWORK_ERROR retries (no infinite reload loop)', () => {
    assert.ok(playerJs.includes('MAX_FATAL_RETRIES'));
    assert.match(playerJs, /fatalRetries\s*>=\s*MAX_FATAL_RETRIES/);
    assert.match(playerJs, /fatalRetries\s*=\s*0/, 'must reset on FRAG_LOADED');
  });

  it('caps fatal MEDIA_ERROR recovery (no infinite recoverMediaError loop)', () => {
    // A wedged decoder on a weak TV chip must not strand the user on
    // "Recovering..." forever.
    assert.match(playerJs, /mediaRetries\s*>=\s*MAX_FATAL_RETRIES/);
    assert.match(playerJs, /mediaRetries\s*=\s*0/, 'must reset on FRAG_LOADED');
  });

  it('native path: guards against a stuck spinner with a timeout', () => {
    const block = playerJs.slice(playerJs.indexOf('function loadNative'),
                                 playerJs.indexOf('function safePlay'));
    assert.match(block, /setTimeout/, 'loadNative must schedule a stuck-spinner timeout');
    assert.match(block, /readyState\s*<\s*2/);
  });

  it('retry callback bails when hls has been destroyed', () => {
    // Retry scheduling lives in scheduleRetry() — both NETWORK_ERROR and
    // the cold-retry path go through it. The callback must (a) clear its
    // own timer ref and (b) bail if destroy() ran in the meantime.
    const fn = playerJs.slice(playerJs.indexOf('function scheduleRetry'),
                              playerJs.indexOf('function scheduleRetry') + 400);
    assert.match(fn, /retryTimer\s*=\s*null/, 'callback must clear its own ref');
    assert.match(fn, /if\s*\(\s*!hls\s*\)\s*return/);
  });

  it('audio-only mode: defined and bound to a keyboard key', () => {
    assert.ok(playerJs.includes('toggleAudioOnly'));
    assert.ok(playerJs.includes('setAudioOnly'));
    assert.match(playerJs, /classList\.toggle\(\s*['"]audio-only['"]/);
    // Step 2 routes keys through dispatchAction. The 'a' case must dispatch
    // the 'audio' action (which calls toggleAudioOnly).
    const kb = playerJs.slice(playerJs.indexOf('function setupKeyboard'),
                              playerJs.indexOf('// --- Platform integration ---'));
    assert.match(kb, /case\s+['"]a['"]\s*:[\s\S]*?dispatchAction\(\s*['"]audio['"]/,
      "keyboard 'a' must dispatch the audio action");
  });

  it('volume changes are clamped to [0, 1] and unmute on adjustment', () => {
    assert.match(playerJs, /Math\.max\(0,\s*Math\.min\(1/);
    assert.match(playerJs, /video\.muted\s*=\s*false/);
  });

  it('keyboard handler ignores events with modifier keys', () => {
    assert.match(playerJs, /e\.ctrlKey\s*\|\|\s*e\.metaKey\s*\|\|\s*e\.altKey/);
  });

  it('hls config tunes live-edge playback (matches extension)', () => {
    const m = playerJs.match(/new\s+Hls\(\{([\s\S]*?)\}\)/);
    assert.ok(m, 'hls config block must exist');
    const cfg = m[1];
    const back = cfg.match(/backBufferLength\s*:\s*(\d+)/);
    assert.ok(back && Number(back[1]) <= 30);
    assert.match(cfg, /maxLiveSyncPlaybackRate\s*:/);
    assert.match(cfg, /maxBufferLength\s*:/);
  });
});
