# Pubblicazione negli store (per i 5 brand)

Ordine launch wave: **Lemon → Scout → NoBull → Briefly → Signal**, 48–72h.
Store: **Chrome Web Store** (prima), **Firefox AMO**, **Safari App Store** (Xcode).

---

## 0. Prerequisiti (una tantum)
- **Account developer**: Chrome Web Store (fee una-tantum $5), Firefox AMO (gratis), Apple Developer Program ($99/anno, per Safari/App Store).
- **OAuth Google** (punto più delicato): l'estensione fa login via `chrome.identity`. Ogni estensione **pubblicata ha un ID diverso** → il redirect `https://<extension-id>.chromiumapp.org/` cambia. Nel Google Cloud Console vanno aggiunti i redirect di ciascuna estensione pubblicata; `extension/oauth-config.js` deve contenere il client id (vedi `GOOGLE-OAUTH-SETUP.md`). Da fare **dopo** aver ottenuto l'ID pubblicato (§4).
- **Stripe LIVE** già configurato (per l'incasso; vedi `docs/runbooks/stripe-live-setup.md`).
- **Asset pronti**: copy in `store/<brand>/listing.md`, icone in `brands/<brand>/assets/` (16/48/128). Mancano solo gli **screenshot** (1280×800), da catturare con la build caricata nel browser.

---

## 1. Chrome Web Store (Chromium: Chrome/Edge/Brave/Arc/Opera) — per brand
1. **Pacchetto**: `node scripts/package-brand.mjs <brand>` → `dist/<brand>-chromium-prod-<versione>.zip` (env=prod di default).
2. [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole) → **New item** → carica lo zip.
3. **Scheda** (da `store/<brand>/listing.md`): nome, descrizione breve (≤132), descrizione dettagliata, categoria (Productivity), lingua.
4. **Immagini**: icona 128, **screenshot 1280×800** (min 1, consigliati 4 — vedi shot-list nel listing), tile/promo opzionali.
5. **Privacy**: URL privacy (`brand.json` → S3), **giustificazione permessi** (host `*://*/*`: "riassumere qualsiasi pagina su richiesta dell'utente"; storage; identity) — testo pronto nel listing.
6. **Submit for review** (tempi CWS: da ore a qualche giorno).
7. Alla pubblicazione: prendi l'**extension ID** → vai al §4.
8. Ripeti per i 5 brand.

## 2. Firefox Add-ons (AMO) — per brand
1. **Pacchetto Firefox**: `node scripts/package-brand.mjs <brand> --browser firefox` → `dist/<brand>-firefox-prod-<versione>.zip` (manifest event-page + `browser_specific_settings.gecko.id = <brand>@bifa.digital`, già impostato).
2. [addons.mozilla.org](https://addons.mozilla.org/developers/) → **Submit a New Add-on** → carica lo zip.
3. Scheda (riusa la copy del listing). Review AMO (automatica + eventuale manuale).
4. Nota: niente `sidePanel`; il flusso usa popup + modale in-page (già gestito).

## 3. Safari (App Store) — richiede macOS + Xcode — per brand
1. **Build base**: `node scripts/build-brand.mjs <brand> --env prod` → `dist/<brand>`.
2. **Conversione**:
   ```
   xcrun safari-web-extension-converter dist/<brand> \
     --project-location safari/<brand> --app-name "<Nome brand>" \
     --bundle-identifier digital.bifa.<brand>
   ```
3. **Xcode**: apri il progetto → firma con l'Apple Developer team → test in Safari (Sviluppo → "Consenti estensioni non firmate").
4. **App Store Connect**: crea l'app, **notarizza** e invia per la review (l'estensione Safari si distribuisce dentro un'app contenitore).

---

## 4. Post-pubblicazione (per ogni estensione pubblicata)
Ottenuto l'**extension ID** dallo store:
1. **ALLOWED_ORIGINS**: aggiungi `chrome-extension://<id>` alla variabile `ALLOWED_ORIGINS` dell'ambiente **prod** (GitHub → Environment `production` → Variables), poi ridispiega prod (`Deploy backend PROD` manuale). Serve per il CORS del backend.
2. **OAuth Google**: aggiungi il redirect `https://<id>.chromiumapp.org/` agli URI autorizzati del client OAuth (Google Cloud Console) e verifica `extension/oauth-config.js`. Senza questo, il **login non funziona** sull'estensione pubblicata.
3. **Smoke reale**: installa dallo store, login, "Riassumi" su un articolo, verifica output del brand e checkout (Stripe LIVE).

---

## Note trasversali
- **Nessuna commissione store sui pagamenti**: l'incasso è via **Stripe diretto** (checkout in-app), non IAP dello store → il rinnovo resta intero.
- **Versioning**: la `version` nel manifest va incrementata a ogni update ripubblicato.
- **Prima del submit**: `node scripts/validate-brands.mjs` (0 errori) e `node scripts/scan-secrets.mjs` (nessun segreto nei bundle) — già in CI.
- **QA** prima di tutto: `docs/qa-checklist.md`.
