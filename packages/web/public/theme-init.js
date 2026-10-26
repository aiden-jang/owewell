// Runs before paint under the production same-origin script policy. Keep storage rules in sync with src/lib/theme.ts.
(function () {
  var stored = null;
  try {
    stored = localStorage.getItem('owewell:theme');
  } catch (e) {
    // The device preference remains available when storage is blocked.
  }
  try {
    var name =
      stored === 'dark' || stored === 'warm'
        ? stored
        : window.matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'warm';
    document.documentElement.dataset.theme = name;
    if (stored) {
      var color = name === 'dark' ? '#151d1e' : '#f7f4ec';
      document.querySelectorAll('meta[name="theme-color"]').forEach(function (m) {
        m.setAttribute('content', color);
        m.removeAttribute('media');
      });
    }
  } catch (e) {
    /* Private mode, or no matchMedia. The stylesheet's own default still applies. */
  }
})();
