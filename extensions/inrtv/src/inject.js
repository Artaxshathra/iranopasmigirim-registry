/* MAIN world script — intercepts fetch/XHR to capture stream manifest URLs */
(function () {
  'use strict';

  var MANIFEST_RE = /\.(m3u8|mpd)([\?#]|$)/i;

  function post(url) {
    try { window.postMessage({ __inrtv: true, url: url }, '*'); }
    catch (e) { /* noop */ }
  }

  // --- Wrap fetch ---
  var _fetch = window.fetch;
  window.fetch = function (input) {
    try {
      var url = typeof input === 'string' ? input : (input && input.url);
      if (url && MANIFEST_RE.test(url)) post(url);
    } catch (e) { /* noop */ }
    return _fetch.apply(this, arguments);
  };

  // --- Wrap XMLHttpRequest.open ---
  var _open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    try {
      if (url && MANIFEST_RE.test(String(url))) post(String(url));
    } catch (e) { /* noop */ }
    return _open.apply(this, arguments);
  };
})();
