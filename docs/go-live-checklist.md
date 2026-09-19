# Go-live checklist — decisioni + passi

Prodotto funzionalmente completo. Da qui è **configurazione + QA**. Prima le decisioni,
poi i passi operativi in ordine.

---

## A. Decisioni da chiudere (bloccano i passi)

| # | Decisione | Note / raccomandazione | Blocca |
|---|-----------|------------------------|--------|
| A1 | **Prezzi** | ✅ DECISO: **uniforme €1.99/mo · €14.99/anno** per tutti i brand (frictionless, sopra il floor Stripe). Impostato: display `getBrandProducts` + pricing sito. Restano da creare i **price id Stripe LIVE** (Fase 1.2). | Stripe LIVE |
| A2 | **Cosa sblocca il Premium** | ✅ DECISO (MVP): uso illimitato, stesse funzioni. | — |
| A3 | **Quota Free** | ✅ DECISO e IN PROD: **5 riassunti di prova una tantum, poi 1/giorno** (reset giornaliero UTC). Valori modificabili senza rilascio da `POST /admin/config`. | — |
| A4 | **Store del primo lancio** | Consiglio: **Chrome Web Store** per primo (review più rapida), poi Firefox (AMO), Safari (App Store, richiede Xcode) ultimo. | QA, submission |
| A5 | **Dominio sito + URL ritorno checkout** | Serve un dominio (es. sotto `bifa.digital`) per landing/pricing e per `stripe-success-url`/`stripe-cancel-url`. Legali già su S3. | sito, Stripe |
| A6 | **Timing go-live prod** | ✅ Prod allineato; i pacchetti store sono buildati `--env prod`. | — |

Già decise (chiuse): ordine lancio (Lemon→Scout→NoBull→Briefly→Signal, wave unica),
modello LLM (nano→gpt-5.4-nano economy / luna premium), host permissions ampie,
dashboard interna, entità **Bifa SRLS**, support `contact@bifa.digital`.

---

## B. Passi operativi (aggiornato 19 set 2026)

Legenda: **[tu]** = richiede il tuo account/console · **[io]** = lo faccio in sessione · ✅ = fatto e verificato.

### Già fatto ✅
- Backend allineato su dev/staging/prod (`973e06b`), smoke prod reale: 5 prove + 1/giorno, poi 429.
- Piano free-only: Stripe non configurato → CTA acquisto nascosta (si accende da sola con `configured=true`).
- 3 giri di audit esterno chiusi (SSRF worker, tetto job atomico, minuti reali, dashboard protetta, Stripe, test OAuth/Stripe/UI). 283 test verdi.
- Legali v2.1 pubblicati per 5 brand; link Termini/Privacy nel login dell'estensione.
- 10 pacchetti in `dist/` (5 Chrome `--store` senza `key`, 5 Firefox). Analisi statica: 0 problemi. Lint Firefox: 0 errori.
- Copy store aggiornata (PDF, video, trascrizione); screenshot Lemon 4, altri brand 2 (pagina + popup).

### Fase 1 — Lancio privato Lemon su Chrome (unlisted)
1. **[tu]** Account [Chrome Web Store developer](https://chrome.google.com/webstore/devconsole): 5 USD una tantum, verifica identità, 2FA. *Non verificato se esiste.*
2. **[tu]** Google Cloud → schermata consenso OAuth: stato **"In production"** (se resta "Testing" loggano solo i test user); scope solo `openid email profile`; link privacy + termini `…/privacy-policy.html` e `…/terms.html`. *Non verificato:* Google può chiedere un dominio autorizzato per quei link (un bucket S3 non è verificabile). Se blocca → serve il dominio (decisione A5).
3. **[tu]** CWS → New item → carica `dist/lemonsqueezer-chromium-prod-store-1.3.2.zip` come **bozza** (non inviare). Copia l'**Item ID**.
4. **[tu]** Google Cloud → client OAuth Web `610186850503-…` → URI di reindirizzamento: `https://<Item ID>.chromiumapp.org/`. **Senza, il login non funziona.**
5. **[io]** Aggiungo `chrome-extension://<ID>` a `ALLOWED_ORIGINS` prod. Igiene, non blocca (misurato: `host_permissions` esenta l'estensione dal CORS).
6. **[tu]** Scheda: testo da `store/lemonsqueezer/listing.md`, 6 screenshot 1280×800, categoria Productivity, privacy URL, giustificazione permessi (già nel listing).
7. **[tu]** Tab **Privacy practices**: dichiara i dati raccolti — informazioni personali identificabili (email, nome), informazioni di autenticazione (login Google), contenuto del sito (testo/sottotitoli/audio inviati al backend su richiesta), cronologia web (URL e dominio in analytics). Nessuna vendita a terzi. Spunta le certificazioni Limited Use.
8. **[tu]** Distribuzione: **Unlisted**. Note per il reviewer: login solo Google (qualsiasi account), piano free = 5 riassunti di prova + 1/giorno, provare su un articolo.
9. **[tu]** *Submit for review* (da ore a qualche giorno; host `*://*/*` può allungare o generare richieste di chiarimento).
10. **[tu+io]** Approvata → installa dallo store con un account Google nuovo: login, riassunto articolo, PDF, video con sottotitoli, contatore "N di prova rimasti", limite dopo il 6°. **[io]** controllo eventi in dashboard.
11. **[tu]** Cambia visibilità in **Public**.

### Fase 2 — Pagamenti (non blocca il lancio free)
12. **[tu]** Decisione A5: dominio per sito e URL di ritorno checkout.
13. **[io]** Sito: prezzi nei template, `node apps/website/generate-site.mjs --all`, hosting.
14. **[tu]** Stripe LIVE (`docs/runbooks/stripe-live-setup.md`): prodotti/prezzi per i 5 brand, webhook, URL T&C nel dashboard Stripe + consenso al recesso al checkout. **[io]** `infra/setup-stripe-live.sh`, deploy prod; verifica `configured=true`.
15. **[tu]** Revisione legale di T&C/privacy (recesso su contenuti digitali, minori, foro) prima di incassare.
16. **[io]** Pulsante "Elimina account" nell'estensione (l'endpoint esiste; oggi la cancellazione è solo via email).

### Fase 3 — Altri 4 brand
17. Attendere l'esito della review di Lemon (policy "contenuto ripetitivo": 5 estensioni con codice identico). Se passa, ripetere Fase 1 per Scout → NoBull → Briefly → Signal.
18. Screenshot "risultato" per i 4 brand: serve una sessione loggata per brand. **[tu]** login Google su build staging + `authToken` da `chrome.storage.local`, **[io]** `node qa/store-screenshots.mjs <brand> <token>`; oppure autorizzi token di test staging.

### Fase 4 — Altri store
19. **Firefox AMO**: zip pronti (`dist/<brand>-firefox-prod-1.3.2.zip`), lint 0 errori, consenso dati dichiarato nel manifest, Firefox ≥140 desktop / ≥142 Android. **[tu]** account AMO + submit.
20. **Safari**: Xcode + Apple Developer, `xcrun safari-web-extension-converter`.

### Fase 5 — Post-lancio
21. Dashboard interna (`/prod/admin/dashboard?key=…`): funnel, retention.
22. Con dati reali: unit economics, soglie via `POST /admin/config` (senza rilascio), MRR per brand.

## C. Stato asset
- **Brand**: ✅ completi (5 pack, icone, nomi/tagline/colori, validate 0/0). Legali su S3 **v2.1** (19 set 2026, coprono PDF/video/trascrizione), pubblicati per tutti i 5 brand; la card di login dell'estensione ora linka Termini/Privacy.
- **Sito**: ✅ Lemon live su <https://lemonsqueezer.app> (5 lingue, dark mode, legali e pagine di ritorno checkout sul dominio; `apps/website/`, `infra/site.yaml`). ⬜ altri 4 brand su `bifa.digital/<brand>/`.
- **Store copy**: ✅ testi pronti (`store/`); screenshot: lemonsqueezer pronti (4, senza account interni), altri brand 2 (manca il "risultato").
