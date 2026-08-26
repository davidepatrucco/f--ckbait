# Go-live checklist — decisioni + passi

Prodotto funzionalmente completo. Da qui è **configurazione + QA**. Prima le decisioni,
poi i passi operativi in ordine.

---

## A. Decisioni da chiudere (bloccano i passi)

| # | Decisione | Note / raccomandazione | Blocca |
|---|-----------|------------------------|--------|
| A1 | **Prezzi** | ✅ DECISO: **uniforme €1.99/mo · €14.99/anno** per tutti i brand (frictionless, sopra il floor Stripe). Impostato: display `getBrandProducts` + pricing sito. Restano da creare i **price id Stripe LIVE** (Fase 1.2). | Stripe LIVE |
| A2 | **Cosa sblocca il Premium** | ✅ DECISO (MVP): uso illimitato, stesse funzioni. | — |
| A3 | **Quota Free** | ✅ DECISO: **1 riassunto/giorno** (reset giornaliero UTC). Implementato (`FREE_PLAN_LIMIT=1` + `getNextResetDate` giornaliero). | — |
| A4 | **Store del primo lancio** | Consiglio: **Chrome Web Store** per primo (review più rapida), poi Firefox (AMO), Safari (App Store, richiede Xcode) ultimo. | QA, submission |
| A5 | **Dominio sito + URL ritorno checkout** | Serve un dominio (es. sotto `bifa.digital`) per landing/pricing e per `stripe-success-url`/`stripe-cancel-url`. Legali già su S3. | sito, Stripe |
| A6 | **Timing go-live prod** | Oggi l'estensione punta a **dev**. Prod va allineato e l'estensione va buildata `--env prod` per la submission. | lancio |

Già decise (chiuse): ordine lancio (Lemon→Scout→NoBull→Briefly→Signal, wave unica),
modello LLM (nano→gpt-5.4-nano economy / luna premium), host permissions ampie,
dashboard interna, entità **Bifa SRLS**, support `contact@bifa.digital`.

---

## B. Passi operativi (in ordine)

### Fase 1 — Backend prod pronto
1. **Allinea prod** al codice corrente (oggi prod è indietro):
   `gh workflow run deploy-prod.yml -f confirm=prod` → approva in Actions → verifica
   `https://l6ykaxiveh.execute-api.eu-west-1.amazonaws.com/prod/health`.
2. **Stripe LIVE** (dopo A1): segui `docs/runbooks/stripe-live-setup.md`:
   crea prodotti/prezzi LIVE per i 5 brand → webhook endpoint → `bash infra/setup-stripe-live.sh`
   con i valori → ridispiega prod.
3. **ALLOWED_ORIGINS prod**: aggiungerai l'id dell'estensione dopo la prima submission
   (vedi Fase 4); per ora salta.

### Fase 2 — Sito marketing (dopo A1, A5)
4. Inserisci i prezzi nei template (`apps/website/template/pricing.html`) o nel generatore.
5. Genera: `node apps/website/generate-site.mjs --all` → `apps/website/dist/<brand>/`.
6. Hosting: carica su S3 (come i legali) sotto il dominio scelto; imposta
   `stripe-success-url`/`stripe-cancel-url` verso il sito.

### Fase 3 — Estensione: build prod, QA, screenshot
7. Build prod per brand:
   `node scripts/build-brand.mjs <brand> --env prod --browser chromium`
   (e `--browser firefox` per AMO).
8. **QA runtime** (tua macchina) su ogni `(browser, brand)` — `docs/qa-checklist.md`:
   install pulito, popup brandizzato, login, summarize con output corretto, quota/errori.
9. **Screenshot store** (con la build caricata): 4 per brand (popup, risultato, opzioni,
   esempio) 1280×800; promo opzionali. Shot-list in `store/<brand>/listing.md`.

### Fase 4 — Submission store (launch wave, ordine A-deciso)
10. Pacchetto: `node scripts/package-brand.mjs <brand>` (env=prod di default) → zip.
11. Submit al Chrome Web Store con la copy di `store/<brand>/listing.md` + screenshot.
    Alla pubblicazione ottieni l'**extension id** → aggiungilo a `ALLOWED_ORIGINS` di prod
    (var GitHub environment/param) e ridispiega prod.
12. Ripeti per Firefox (AMO) e Safari (`xcrun safari-web-extension-converter`, Xcode).
13. Lancia i 5 brand ravvicinati (48–72h) nell'ordine deciso.

### Fase 5 — Post-lancio
14. Monitora la **dashboard interna** (`/prod/admin/dashboard?key=...`) — i funnel si popolano.
15. Con dati reali: rimisura unit economics (`--source analytics`), tara la soglia router,
    valuta MRR/margine per-brand in dashboard, e la GSI se il volume cresce.

---

## C. Stato asset
- **Brand**: ✅ completi (5 pack, icone, nomi/tagline/colori, legali su S3, validate 0/0).
- **Sito**: 🟡 generatore + template pronti; da finalizzare (prezzi) + hostare (dominio).
- **Store copy**: ✅ testi pronti (`store/`); ⬜ screenshot/promo (Fase 3).
