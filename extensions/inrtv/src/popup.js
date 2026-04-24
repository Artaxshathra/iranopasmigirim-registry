'use strict';

const PLAYER_PATH = 'player.html';

function playerUrl(radio) {
  return PLAYER_PATH + (radio ? '?radio=1' : '');
}

function createPlayer(radio) {
  chrome.windows.create({
    url: playerUrl(radio),
    type: 'popup',
    width: 960,
    height: 560
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
