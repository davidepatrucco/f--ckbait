# Store listings (5 brand)

Copy pronta per la pubblicazione. Generata da `store/generate-listings.mjs`
(nome/tagline/categoria/URL da `brands/<brand>/brand.json` + copy tarata per posizionamento).

```
node store/generate-listings.mjs            # rigenera store/<brand>/listing.md
node store/generate-listings.mjs scout      # solo un brand
```

Per brand: `store/<brand>/listing.md` con nome store, categoria, descrizione breve
(≤132 char) e dettagliata, keywords, giustificazione permessi, URL privacy/termini/supporto,
shot-list screenshot.

## Cosa è pronto (facciamo noi)
- ✅ Testi: nome, tagline, short/long description, keywords, giustificazione permessi.
- ✅ URL legali/supporto (da brand.json, già hostati su S3).

## Cosa richiede l'estensione in esecuzione (fase QA / tua macchina)
- ⬜ Screenshot 1280×800 (o 640×400): catturarli con la build del brand caricata nel browser.
- ⬜ Immagini promo (marquee 1400×560, tile 440×280): grafica con wordmark + tagline.

## Pacchetto per lo store
```
node scripts/package-brand.mjs <brand>            # zip chromium, env=prod (default)
node scripts/package-brand.mjs <brand> --browser firefox
```
Lo zip punta a **prod** (`__BRAND__.apiBase`). Prima della submission: aggiungere l'origin
dell'estensione pubblicata (`chrome-extension://<id>`) a `ALLOWED_ORIGINS` di prod.

## Store per brand
- Chrome Web Store (Chromium: Chrome/Edge/Brave/Arc/Opera) — pacchetto chromium.
- Firefox Add-ons (AMO) — pacchetto firefox.
- Safari (App Store) — conversione via `xcrun safari-web-extension-converter` (Xcode).
