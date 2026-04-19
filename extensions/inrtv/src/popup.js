'use strict';

document.getElementById('btn-watch').addEventListener('click', function () {
  chrome.windows.create({
    url: 'player.html',
    type: 'popup',
    width: 960,
    height: 560
  });
});

document.getElementById('link-site').addEventListener('click', function (e) {
  e.preventDefault();
  chrome.tabs.create({ url: 'https://iranopasmigirim.com/en/iran-national-revolution-tv' });
});
