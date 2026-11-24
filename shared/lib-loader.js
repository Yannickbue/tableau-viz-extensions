// Loads the real Tableau Extensions API, or the offline mock when the page URL
// carries ?mock=<fixture.json>. Must be included as a plain (non-async) <script>
// in <head>, before bleckmann-ext.js, so document.write runs during parsing.
(function () {
  'use strict';
  var base = document.currentScript.src.replace(/shared\/lib-loader\.js.*$/, '');
  var mock = new URLSearchParams(window.location.search).get('mock');
  var src = mock
    ? base + 'shared/tableau-mock.js'
    : base + 'lib/tableau.extensions.1.latest.min.js';
  document.write('<script src="' + src + '"><\/script>');
})();
