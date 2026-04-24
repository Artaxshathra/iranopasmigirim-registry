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
    const expectedKeys = [' ', 'k', 'm', 'f', 'p', 'r', 'ArrowUp', 'ArrowDown'];
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

  it('keyboard handler ignores events with modifier keys', () => {
    assert.match(playerJs, /e\.ctrlKey\s*\|\|\s*e\.metaKey\s*\|\|\s*e\.altKey/,
      'keyboard handler must bail on Ctrl/Meta/Alt to avoid hijacking browser shortcuts');
  });

  it("keyboard handler includes '?' for help overlay", () => {
    assert.ok(playerJs.includes("'?'"), "keyboard handler must handle '?' key");
    assert.ok(playerJs.includes('toggleHelp') || playerJs.includes('showHelp'),
      'keyboard handler must toggle/show help overlay');
  });

  it('hls config tunes live-edge playback', () => {
    const m = playerJs.match(/new\s+Hls\(\{([\s\S]*?)\}\)/);
    assert.ok(m, 'hls config block must exist');
    const cfg = m[1];
    const back = cfg.match(/backBufferLength\s*:\s*(\d+)/);
    assert.ok(back, 'backBufferLength must be set');
    assert.ok(Number(back[1]) <= 30, 'backBufferLength must be <= 30s');
    assert.match(cfg, /maxLiveSyncPlaybackRate\s*:/, 'maxLiveSyncPlaybackRate must be configured');
    assert.match(cfg, /maxBufferLength\s*:/, 'maxBufferLength must be configured');
  });

  it('controls auto-hide via idle class on inactivity', () => {
    assert.ok(playerJs.includes("'mousemove'"), 'must listen for mousemove to track activity');
    assert.ok(playerJs.includes("classList.add('idle')"),
      'must add idle class after inactivity timer');
    assert.ok(playerJs.includes("classList.remove('idle')"),
      'must remove idle class on activity');
  });

  it('double-click on the player toggles fullscreen', () => {
    assert.match(playerJs, /playerContainer\.addEventListener\(\s*['"]dblclick['"]/,
      'playerContainer must bind a dblclick handler');
    const dblBlock = playerJs.slice(playerJs.indexOf("'dblclick'"));
    assert.ok(dblBlock.includes('toggleFullscreen'),
      'dblclick handler must call toggleFullscreen');
  });

  it('radio mode: setRadio toggles the body.radio class', () => {
    assert.ok(playerJs.includes('toggleRadio'), 'toggleRadio must be defined');
    assert.ok(playerJs.includes('setRadio'), 'setRadio must be defined');
    assert.match(playerJs, /classList\.toggle\(\s*['"]radio['"]\s*,/,
      'setRadio must set body class "radio" via classList.toggle(name, force)');
  });

  it('radio mode: button is registered and bound to toggleRadio', () => {
    assert.match(playerJs, /btnRadio\.addEventListener\(\s*['"]click['"]\s*,\s*toggleRadio/,
      'btn-radio must bind click to toggleRadio');
  });

  it('radio mode: keyboard shortcut "r" toggles radio', () => {
    const kbBlock = playerJs.slice(
      playerJs.indexOf('setupKeyboard'),
      playerJs.indexOf('function showHelp')
    );
    assert.match(kbBlock, /case\s+['"]r['"]\s*:\s*toggleRadio/,
      "keyboard 'r' case must call toggleRadio");
  });

  it('radio mode: aria-label announces the next action (switch to video/radio)', () => {
    // The button is a switch-to-other-mode control; its label changes to name
    // what clicking it will do now. Icon follows via CSS.
    const fn = playerJs.slice(
      playerJs.indexOf('function setRadio'),
      playerJs.indexOf('function toggleRadio')
    );
    assert.ok(fn.includes('Switch to video') && fn.includes('Switch to radio'),
      'setRadio must set aria-label to "Switch to video" or "Switch to radio"');
    assert.match(fn, /setAttribute\(\s*['"]aria-label['"]/,
      'setRadio must call setAttribute("aria-label", ...)');
  });

  it('radio mode: exits fullscreen when enabled', () => {
    const fn = playerJs.slice(
      playerJs.indexOf('function setRadio'),
      playerJs.indexOf('function toggleRadio')
    );
    assert.ok(fn.includes('document.exitFullscreen'),
      'entering radio mode must exit fullscreen if active');
  });

  it('radio mode: minimizes the popup window on entry, restores on exit', () => {
    assert.ok(playerJs.includes('setWindowState'),
      'must define a setWindowState helper');
    assert.match(playerJs, /setWindowState\(\s*on\s*\?\s*['"]minimized['"]\s*:\s*['"]normal['"]\s*\)/,
      'setRadio must minimize on entry and restore on exit');
    assert.ok(playerJs.includes("state: 'minimized'"),
      'must request the minimized window state');
    assert.ok(playerJs.includes("state: 'normal'"),
      'must request the normal window state on restore');
  });

  it('radio mode: listens for set-radio messages from the popup', () => {
    assert.ok(playerJs.includes('chrome.runtime.onMessage.addListener'),
      'must register a chrome.runtime.onMessage listener');
    assert.match(playerJs, /type\s*===\s*['"]set-radio['"]/,
      'listener must handle type "set-radio"');
    assert.match(playerJs, /setRadio\(\s*!!\s*msg\.on\s*\)/,
      'listener must forward msg.on to setRadio');
    // The popup's sendMessage callback fires only when a receiver calls
    // sendResponse OR when there are no receivers. A silent listener would
    // leave the popup's window.close() pending until port disconnect.
    assert.match(playerJs, /sendResponse\(\s*\{[^}]*ok/,
      'listener must call sendResponse so the popup callback completes');
  });

  it('radio mode: ?radio=1 URL param enters radio mode on boot', () => {
    assert.match(playerJs, /URLSearchParams\(location\.search\)\.get\(\s*['"]radio['"]\s*\)\s*===\s*['"]1['"]/,
      'init must check ?radio=1 and enter radio mode');
    assert.match(playerJs, /setRadio\(\s*true\s*\)/,
      'boot-time radio path must call setRadio(true)');
  });

  it('radio mode: toggleFullscreen is a no-op while radio is on', () => {
    const fn = playerJs.slice(
      playerJs.indexOf('function toggleFullscreen'),
      playerJs.indexOf('function toggleRadio')
    );
    assert.match(fn, /isRadioOn\(\)\s*\)\s*return/,
      'toggleFullscreen must early-return when radio mode is on');
  });

  it('radio mode: togglePip is a no-op while radio is on', () => {
    const fn = playerJs.slice(
      playerJs.indexOf('function togglePip'),
      playerJs.indexOf('function toggleFullscreen')
    );
    assert.match(fn, /isRadioOn\(\)\s*\)\s*return/,
      'togglePip must early-return when radio mode is on');
  });

  it('radio mode: button label names the function, not the action', () => {
    // aria-pressed carries on/off state; the label must stay stable so screen
    // readers don't announce a contradictory "Video mode, pressed".
    const fn = playerJs.slice(
      playerJs.indexOf('function setRadio'),
      playerJs.indexOf('function toggleRadio')
    );
    assert.ok(!fn.includes("'Video mode'"),
      "setRadio must not swap the button's aria-label to 'Video mode'");
  });

  it('fullscreen targets the player container, not the whole document', () => {
    assert.ok(playerJs.includes('playerContainer.requestFullscreen'),
      'fullscreen must target playerContainer');
    assert.ok(!playerJs.includes('documentElement.requestFullscreen'),
      'must not fullscreen the entire document');
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
