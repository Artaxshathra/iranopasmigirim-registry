'use strict';

const PLAYER_PATH = 'player.html';
const PLAYER_WIDTH = 960;
const PLAYER_HEIGHT = 560;

function playerUrl(radio) {
  return PLAYER_PATH + (radio ? '?radio=1' : '');
}

function isFirefox() {
  return typeof navigator !== 'undefined' && /\bFirefox\//.test(navigator.userAgent);
}

// Chrome: a sized popup window matches the Watch-Live feel. Firefox: popup-type
// windows ignore requested dimensions and can't reliably minimize, so open the
// player as a regular tab instead — users get full browser chrome and proper
// window controls.
function createPlayer(radio) {
  const url = playerUrl(radio);
  if (isFirefox()) {
    chrome.tabs.create({ url: url }, function () {
      void chrome.runtime.lastError;
      window.close();
    });
    return;
  }
  chrome.windows.create({
    url: url,
    type: 'popup',
    width: PLAYER_WIDTH,
    height: PLAYER_HEIGHT
  }, function () {
    void chrome.runtime.lastError;
    window.close();
  });
}

// Ask any open player to switch mode. If a player responds, we're done —
// it handles its own window state (minimize on radio, restore on video).
// If nobody responds, chrome.runtime.lastError fires and we create a new one.
function openOrSwitch(radio) {
  chrome.runtime.sendMessage({ type: 'set-radio', on: !!radio }, function (response) {
    if (chrome.runtime.lastError || !response || !response.ok) {
      createPlayer(radio);
      return;
    }
    window.close();
  });
}

document.getElementById('btn-watch').addEventListener('click', function () {
  openOrSwitch(false);
});

document.getElementById('btn-listen').addEventListener('click', function () {
  openOrSwitch(true);
});

document.getElementById('link-site').addEventListener('click', function (e) {
  e.preventDefault();
  chrome.tabs.create({ url: 'https://iranopasmigirim.com/en/iran-national-revolution-tv' });
});
