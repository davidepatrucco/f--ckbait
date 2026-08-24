# QA runtime browser (Gap #4) — da eseguire sulla tua macchina

Non eseguibile nell'ambiente agent (nessun browser/Xcode). Build già prodotte da `scripts/build-brand.mjs`.

## Prerequisiti
```
node scripts/build-brand.mjs <brand> --browser chromium   # dist/<brand>
node scripts/build-brand.mjs <brand> --browser firefox    # dist/<brand>-firefox
```

## Chrome / Edge (Chromium)
1. `chrome://extensions` (o `edge://extensions`) → Developer mode → Load unpacked → `dist/<brand>/`.
2. Smoke: icona toolbar → popup (tema/nome brand corretti) → login → "Riassumi" su un articolo → verifica output del brand (Lemon=bullet; Scout=attention score; ecc.).
3. Quota: ripeti fino al limite free → 429 con messaggio; verifica isolamento tra brand diversi (login stesso account su due build).
4. Edge: stesso pacchetto Chromium.

## Firefox
1. `about:debugging#/runtime/this-firefox` → Load Temporary Add-on → `dist/<brand>-firefox/manifest.json`.
2. Verifica che l'adapter `browser-polyfill.js` renda funzionanti le `chrome.*` con await (login, storage, summarize).
3. Smoke completo come sopra. Nota: niente `sidePanel` (usa popup + modale in-page).

## Safari (richiede Xcode)
```
node scripts/build-brand.mjs <brand>            # dist/<brand> (WebExtension)
xcrun safari-web-extension-converter dist/<brand> \
  --project-location safari/<brand> --app-name "<Nome>" --bundle-identifier digital.bifa.<brand>
```
Poi: aprire il progetto in Xcode → firmare (Apple Developer) → Safari → Sviluppo → "Consenti estensioni non firmate" → smoke test → notarizzare/submit al Mac App Store.

## Criterio di chiusura
Per ogni browser × brand: install pulito, popup brandizzato, login, summarize con output corretto per schema, quota/errori corretti, nessun errore console non atteso. Registrare esito per (browser, brand).
