# Cross-browser (E11)

Una sola codebase (`extension/`) → build per browser via `scripts/build-brand.mjs <brand> --browser <target>`.

## Stato per browser
| Browser | Stato codice | QA runtime | Note |
|---|---|---|---|
| **Chrome** | ✅ pronto | ✅ (dev unpacked) | MV3, `service_worker`, `sidePanel`-ready. Target primario. |
| **Edge / Brave / Arc / Opera** | ✅ pronto | ⬜ da fare | Stesso pacchetto Chromium (`--browser chromium`). Nessuna modifica codice. |
| **Firefox** | 🟡 build prodotta | ⬜ **richiede QA reale** | Manifest event-page (`background.scripts`), `browser_specific_settings.gecko.id`, adapter `browser-polyfill.js`. Non testato a runtime in questo ambiente. |
| **Safari** | ⬜ spike documentato | ⬜ | Richiede Xcode + `safari-web-extension-converter` (macOS). Vedi sotto. |

## Adapter
`extension/browser-polyfill.js` (caricato per primo in popup, content script e background): su Firefox allinea `chrome` all'API promise-based `browser`; su Chromium è no-op. Permette di mantenere le chiamate `chrome.*` con `await` senza refactor dei call site.

## Differenze note (permessi/API)
- `background.service_worker` (Chromium) vs `background.scripts` event-page (Firefox) — gestito da `build-brand`.
- `sidePanel` è solo Chromium; la UI attuale usa un modale in-page + popup, quindi non è un blocco per Firefox.
- `chrome.identity.launchWebAuthFlow` (OAuth) funziona su entrambi ma il redirect `https://<id>.chromiumapp.org/` va autorizzato per l'ID di **ogni** build/brand.
- `host_permissions *://*/*`: valutare minimizzazione (E14-001) per la review dei singoli store.

## Comandi
```
node scripts/build-brand.mjs <brand>                 # chromium (Chrome/Edge/…)
node scripts/build-brand.mjs <brand> --browser firefox
node scripts/package-brand.mjs <brand> --browser firefox   # -> dist/<brand>-firefox-<ver>.zip
```

## Safari (spike E11-007)
Impacchettare la build Chromium/WebExtension con `xcrun safari-web-extension-converter dist/<brand>` per generare un progetto Xcode (wrapper sottile). Mantenere il codice WebExtension neutro; fornire un fallback pannello (no `sidePanel`). Da eseguire su macOS con Xcode — non effettuato qui.

## QA richiesta prima della pubblicazione (non eseguibile in questo ambiente)
- Firefox: caricamento temporaneo (`about:debugging`), smoke test del flusso completo (login, riassunto, quota), verifica promesse `chrome.*` via adapter.
- Edge: install da pacchetto Chromium.
- Safari: build wrapper Xcode + test.
