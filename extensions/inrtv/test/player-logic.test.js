'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..', 'src');
const playerJs = fs.readFileSync(path.join(SRC, 'player.js'), 'utf8');
const playerHtml = fs.readFileSync(path.join(SRC, 'player.html'), 'utf8');

describe('player.js logic', () => {
  it('starts with use strict', () => {
    assert.ok(playerJs.trimStart().startsWith("'use strict'"),
      'player.js must begin with use strict');
  });

  it('STREAM_URL is https and well-formed', () => {
    const m = playerJs.match(/STREAM_URL\s*=\s*['"]([^'"]+)['"]/);
    assert.ok(m, 'STREAM_URL must be defined');
    const url = new URL(m[1]);
    assert.equal(url.protocol, 'https:');
    assert.ok(url.pathname.endsWith('.m3u8'), 'stream should be .m3u8');
  });

  it('all DOM getElementById calls reference IDs in player.html', () => {
    const idRefs = [...playerJs.matchAll(/getElementById\(['"]([^'"]+)['"]\)/g)]
      .map(m => m[1]);
    assert.ok(idRefs.length > 0, 'must reference DOM elements');

    for (const id of idRefs) {
      const pattern = new RegExp(`id=["']${id}["']`);
      assert.ok(pattern.test(playerHtml),
        `player.js references #${id} but it's not in player.html`);
    }
  });

  it('registers pagehide cleanup handler', () => {
    assert.ok(playerJs.includes("'pagehide'"),
      'must register pagehide event listener');
  });

  it('pagehide handler clears statsInterval', () => {
    assert.ok(playerJs.includes('clearInterval(statsInterval)'),
      'pagehide must clear statsInterval');
  });

  it('pagehide handler destroys hls instance', () => {
    assert.ok(playerJs.includes('hls.destroy()'),
      'pagehide must destroy hls');
  });

  it('volume is clamped to [0, 1] on arrow keys', () => {
    assert.ok(playerJs.includes('Math.min(1'), 'ArrowUp must clamp to max 1');
    assert.ok(playerJs.includes('Math.max(0'), 'ArrowDown must clamp to min 0');
  });

  it('keyboard handler covers all expected keys', () => {
    const expectedKeys = [' ', 'k', 'm', 'f', 'p', 'ArrowUp', 'ArrowDown'];
    for (const key of expectedKeys) {
      assert.ok(playerJs.includes(`'${key}'`),
        `keyboard handler must handle '${key}'`);
    }
  });

  it('arrow keys unmute when muted', () => {
    // Both ArrowUp and ArrowDown blocks should contain unmute logic
    const arrowUpBlock = playerJs.slice(
      playerJs.indexOf("'ArrowUp'"),
      playerJs.indexOf("'ArrowDown'")
    );
    assert.ok(arrowUpBlock.includes('video.muted = false'),
      'ArrowUp must unmute');

    const arrowDownBlock = playerJs.slice(
      playerJs.indexOf("'ArrowDown'"),
      playerJs.indexOf("'ArrowDown'") + 200
    );
    assert.ok(arrowDownBlock.includes('video.muted = false'),
      'ArrowDown must unmute');
  });

  it('updates aria-label on play/pause toggle', () => {
    assert.ok(playerJs.includes("setAttribute('aria-label', 'Pause')"),
      'play event must set aria-label to Pause');
    assert.ok(playerJs.includes("setAttribute('aria-label', 'Play')"),
      'pause event must set aria-label to Play');
  });

  it('toggles play button via data-state attribute', () => {
    assert.ok(playerJs.includes("setAttribute('data-state', 'playing')"),
      'play event must set data-state to playing');
    assert.ok(playerJs.includes("setAttribute('data-state', 'paused')"),
      'pause event must set data-state to paused');
  });

  it('updates aria-label on mute/unmute toggle', () => {
    assert.ok(playerJs.includes("setAttribute('aria-label', video.muted ? 'Unmute' : 'Mute')"),
      'updateMuteIcon must update aria-label');
  });

  it('toggles mute button via data-state attribute', () => {
    assert.ok(playerJs.includes("setAttribute('data-state', video.muted ? 'muted' : 'unmuted')"),
      'updateMuteIcon must set data-state');
  });

  it('shows play prompt on autoplay failure', () => {
    assert.ok(playerJs.includes('.catch(showPlayPrompt)'),
      'play() must catch with showPlayPrompt');
  });

  it('hides play prompt when video plays', () => {
    assert.ok(playerJs.includes('hidePlayPrompt'),
      'play event must hide play prompt overlay');
  });

  it('play overlay responds to click', () => {
    assert.ok(playerJs.includes("overlayPlay.addEventListener('click'"),
      'play overlay must have click handler');
  });

  it('play overlay responds to keyboard (Enter/Space)', () => {
    assert.ok(playerJs.includes("overlayPlay.addEventListener('keydown'"),
      'play overlay must have keydown handler');
  });

  it('listens for volumechange to sync slider', () => {
    assert.ok(playerJs.includes("addEventListener('volumechange'"),
      'must listen for volumechange events');
  });

  it('caps fatal error retries', () => {
    assert.ok(playerJs.includes('MAX_FATAL_RETRIES'),
      'must define a fatal retry cap');
    assert.ok(playerJs.includes('fatalRetries >= MAX_FATAL_RETRIES'),
      'must check retry cap before retrying');
  });

  it('resets fatal retry counter on successful load', () => {
    assert.ok(playerJs.includes('fatalRetries = 0'),
      'fatalRetries must reset on FRAG_LOADED');
  });

  it('consolidates native canplay into a single { once: true } listener', () => {
    const nativeBlock = playerJs.slice(
      playerJs.indexOf('function loadNative'),
      playerJs.indexOf('function startStats')
    );
    const canplayMatches = nativeBlock.match(/addEventListener\('canplay'/g);
    assert.equal(canplayMatches && canplayMatches.length, 1,
      'loadNative must have exactly one canplay listener');
  });
});
