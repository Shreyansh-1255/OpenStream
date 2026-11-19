/* ======================================================================
   Telegram Mini App integration for OpenStream.

   - Loaded after script.js. In a normal browser it does nothing at all:
     window.Telegram only exists when telegram-web-app.js has loaded and
     the page runs inside a Telegram WebView.
   - Inside Telegram this wires the app into the Mini App shell:
       * ready() + expand() so the app fills the whole screen
       * Telegram's header/background match the app theme (dark / light)
       * the Telegram back button drives the app's own navigation:
         overlays (search, settings, info sheet) first, then in-app
         history, exactly like the in-page Back buttons
       * vertical swipes are disabled so long lists scroll instead of
         closing the app
   ====================================================================== */
(function () {
  var tg = window.Telegram && window.Telegram.WebApp;
  if (!tg || !tg.BackButton) return; // opened outside Telegram: keep the plain website behaviour

  /* ---- match Telegram's chrome to the app theme (colors from style.css / the theme-color meta) ---- */
  var BG = { dark: '#100e0c', light: '#f3ecdc' };
  function isLight() { return document.documentElement.getAttribute('data-theme') === 'light'; }
  function syncColors() {
    try {
      var c = BG[isLight() ? 'light' : 'dark'];
      if (tg.setHeaderColor) tg.setHeaderColor(c);
      if (tg.setBackgroundColor) tg.setBackgroundColor(c);
    } catch (_) {}
  }

  /* ---- Telegram back button mirrors the in-page back logic ---- */
  function overlayOpen() {
    return document.getElementById('searchOverlay').classList.contains('open')
        || document.getElementById('setOverlay').classList.contains('open')
        || document.getElementById('infoModal').classList.contains('open');
  }
  function closeTopOverlay() {
    try {
      if (document.getElementById('searchOverlay').classList.contains('open')) { closeSearch(); return true; }
      if (document.getElementById('setOverlay').classList.contains('open')) { closeSettings(); return true; }
      if (document.getElementById('infoModal').classList.contains('open')) { closeInfo(); return true; }
    } catch (_) {}
    return false;
  }
  function syncBack() {
    try {
      var home = document.getElementById('view-home').style.display !== 'none';
      if (overlayOpen() || !home) tg.BackButton.show();
      else tg.BackButton.hide();
    } catch (_) {}
  }
  tg.BackButton.onClick(function () {
    try { if (tg.HapticFeedback) tg.HapticFeedback.impactOccurred('light'); } catch (_) {}
    if (closeTopOverlay()) { syncBack(); return; }
    try { goBack(); } catch (_) {}
    setTimeout(syncBack, 0); // goBack may use replaceState, which fires no events
  });
  // script.js registers its own hashchange/popstate listeners first, so by the
  // time these fire the views are already switched and the state is final
  window.addEventListener('hashchange', syncBack);
  window.addEventListener('popstate', syncBack);

  /* ---- init ---- */
  try { tg.ready(); } catch (_) {}
  try { tg.expand(); } catch (_) {}
  try { if (tg.disableVerticalSwipes) tg.disableVerticalSwipes(); } catch (_) {}
  syncColors();
  syncBack();
  // keep Telegram's header in sync when the in-app theme toggle is used
  var tb = document.getElementById('themeBtn');
  if (tb) tb.addEventListener('click', function () { setTimeout(syncColors, 0); });
})();
