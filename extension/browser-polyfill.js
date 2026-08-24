// Cross-browser adapter (classic script, caricato per primo in ogni contesto).
// Su Firefox l'API standard è `browser` (promise-based); allineiamo `chrome` ad essa
// così i `chrome.*` usati con await funzionano identici a Chrome.
// Su Chrome/Edge (Chromium) `browser` non esiste: no-op, `chrome` resta invariato.
(function () {
    try {
        if (typeof browser !== 'undefined' && browser && browser.runtime) {
            // eslint-disable-next-line no-global-assign
            globalThis.chrome = browser;
        }
    } catch (e) {
        // Nessun'azione: su Chromium non c'è `browser`.
    }
})();
