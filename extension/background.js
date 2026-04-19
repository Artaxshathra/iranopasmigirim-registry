/* Service worker — stores detected streams, manages badge, cleans up on navigation */
'use strict';

var TAB_KEY = function (tabId) { return 'tab_' + tabId; };

// Content script sends STREAM_FOUND → we store in session storage
chrome.runtime.onMessage.addListener(function (msg, sender) {
  if (msg.type === 'STREAM_FOUND' && sender.tab && sender.tab.id != null) {
    addStream(sender.tab.id, msg.data);
  }
});

async function addStream(tabId, streamInfo) {
  var key = TAB_KEY(tabId);
  var data = await chrome.storage.session.get(key);
  var streams = data[key] || {};

  if (streams[streamInfo.url]) return; // already stored

  streams[streamInfo.url] = streamInfo;
  await chrome.storage.session.set({ [key]: streams });

  var count = Object.keys(streams).length;
  chrome.action.setBadgeText({ text: String(count), tabId: tabId });
  chrome.action.setBadgeBackgroundColor({ color: '#c41e3a' });
}

// Clear streams on tab close
chrome.tabs.onRemoved.addListener(function (tabId) {
  chrome.storage.session.remove(TAB_KEY(tabId));
});

// Clear streams on navigation (new page load = fresh detection)
chrome.tabs.onUpdated.addListener(function (tabId, changeInfo) {
  if (changeInfo.status === 'loading') {
    chrome.storage.session.remove(TAB_KEY(tabId));
    chrome.action.setBadgeText({ text: '', tabId: tabId });
  }
});
