# Guida al lancio — passo passo

**Aggiornata:** 19 settembre 2026 · **Codice:** `main` (tutti e tre gli ambienti allineati) · **Test:** 285, 0 fallimenti

Come leggerla:

- **[tu]** richiede il tuo account, la tua console o una decisione.
- **[io]** lo eseguo in sessione, senza bisogno di altro.
- **Verifica** dice come controllare che il passo sia riuscito, e cosa ci si aspetta di vedere.
- **Non verificato** segna ciò che non ho potuto controllare da qui (console di terzi, account). Non è un'ipotesi che funzioni: è un punto da controllare.
- Importi, commissioni e tempi sono **stime** da riverificare sulle pagine ufficiali prima di decidere.

Indice: A) lancio gratuito su Chrome · B) pagamenti · C) sito · D) altri 4 brand · E) Firefox e Safari · F) operatività · G) rischi e decisioni · H) appendice.

---

## 0. Punto di partenza

### Già pronto e verificato

| Area | Stato |
|---|---|
| Backend | dev, staging e prod sullo stesso codice. Smoke reale in prod: utente nuovo → 5 riassunti di prova + 1 al giorno → poi 429 |
| Piano free | 5 riassunti di prova una tantum, poi 1 al giorno. Valori modificabili senza rilascio (`POST /admin/config`) |
| Pagamenti | Spenti: nessun price id configurato → `/pricing` risponde `configured=false` → l'estensione nasconde il pulsante di acquisto. Si accende da sola quando Stripe è configurato |
| Sicurezza | 3 giri di audit esterno chiusi: bypass di autenticazione, SSRF, contatori, Stripe, limiti di costo |
| Pacchetti | 10 zip in `dist/`: 5 Chrome per lo store (senza `key` nel manifest) + 5 Firefox. Analisi statica: 0 problemi. Lint Firefox: 0 errori |
| Legali | Termini v2.1 e Privacy v2.2, IT+EN, per i 5 brand, pubblicati su S3; link "Termini · Privacy" nel login dell'estensione |
| Scheda store | Testi generati per 5 brand; 6 screenshot 1280×800 per LemonSqueezer, 2 per gli altri 4 |

### Corretto oggi (e perché conta per il lancio)

1. **Nome del brand nella modale.** "LemonSqueezer - TL;DR" era scritto fisso in modale, notifica e titolo popup: ogni altro brand mostrava il nome sbagliato.
2. **Analytics conservava email, URL completo e titolo di ogni pagina riassunta, senza scadenza**, e la privacy non lo dichiarava. Ora si salva solo il dominio, gli eventi scadono dopo 13 mesi, i 379 record esistenti sono stati ripuliti (prod 25, staging 261, dev 93; verificato 0 residui).
3. **Contatore prove nel popup** mostrava "0/1" con 5 prove libere; e gli altri brand mostravano la quota di LemonSqueezer.
4. **URL di ritorno del checkout** era unico per tutti i brand: un acquirente Scout sarebbe atterrato su "Benvenuto in LemonSqueezer Premium". Ora accetta il segnaposto `{brand}`.
5. **Runbook e script Stripe errati**: chiavi price id di Lemon obsolete (Lemon sarebbe rimasto senza prezzi), URL del webhook non quello reale (i clienti avrebbero pagato senza diventare Premium), 3 eventi invece di 6.
6. **Login Google su Firefox** non poteva funzionare (redirect URI non valido). Corretto con `identity.getRedirectURL()`; su Chrome il valore è identico a prima (verificato in browser).
7. **Firefox/AMO**: mancava `data_collection_permissions`, obbligatorio per le nuove estensioni dal 3 novembre 2025.

---

# PARTE A — Lancio gratuito di LemonSqueezer su Chrome (unlisted, poi pubblico)

Un solo brand, un solo store, senza pagamenti. Obiettivo: ottenere l'approvazione e i primi utenti reali con il rischio minimo. I passi A1–A3 possono procedere in parallelo.

## A1. Account sviluppatore Chrome Web Store — [tu]

1. Vai su <https://chrome.google.com/webstore/devconsole> con l'account Google che deve possedere l'estensione. Consiglio un account di **team** (non personale), perché il proprietario dell'item non si cambia facilmente. Se manca, crea `chrome-store@bifa.digital` o simile.
2. Accetta il contratto per sviluppatori e paga la quota di registrazione (**5 USD una tantum**, stima).
3. Attiva la verifica in due passaggi sull'account (richiesta per pubblicare).
4. In **Account** compila e verifica l'email di contatto (arriva un codice).
5. **Stato di trader (UE).** La console richiede di dichiarare se sei un "trader" ai fini del Digital Services Act. Bifa SRLS è un'impresa: dichiara trader e inserisci indirizzo, telefono ed email, che verranno mostrati nella scheda per gli utenti UE. *Non verificato:* nome e posizione esatta del campo nella console.

**Verifica:** la console si apre e mostra il pulsante "New item".

## A2. Google Cloud: schermata di consenso e client OAuth — [tu]

Il login usa un client OAuth di tipo Web con id `610186850503-ju23nfsjc48jfn607j9cjsanl6fulour.apps.googleusercontent.com` (in `extension/oauth-config.js`; il segreto è in SSM `/reading-intelligence/prod/google-web-client-secret`).

1. Google Cloud Console → progetto che contiene quel client → **API e servizi → Schermata consenso OAuth**.
2. Compila: nome app (`LemonSqueezer`), email di assistenza utenti, email di contatto sviluppatore.
3. **Non caricare un logo.** Con un logo Google richiede la verifica del marchio, che allunga i tempi di settimane.
4. **Scope**: solo `openid`, `email`, `profile` (sono scope non sensibili; non serve la verifica dell'app). Non aggiungerne altri.
5. **Link legali**: informativa privacy `https://reading-intelligence-legal.s3.eu-west-1.amazonaws.com/privacy-policy.html`, termini `…/terms.html`.
   - *Non verificato:* Google può richiedere che i link stiano su un dominio autorizzato e verificato. Un bucket S3 non è verificabile. Se il salvataggio dà errore sul dominio, usa la variante B qui sotto.
   - **Variante B — [io] + [tu]:** sposto le pagine legali su `https://bifa.digital/legal/lemonsqueezer/…` (il dominio è sul tuo account AWS: CloudFront `E2GJS3BOS5H9OT`, bucket `bifa-landing-page-1748613593`). Tu verifichi `bifa.digital` in Google Search Console con un record TXT sul DNS (gestito da register.it) e lo aggiungi ai **Domini autorizzati** della schermata di consenso. Poi io aggiorno `brands/*/brand.json`, ricostruisco i pacchetti e ripubblico. Dimmi se serve.
6. Imposta lo stato di pubblicazione su **"In produzione"**. Se resta "In test", possono accedere solo gli utenti di test elencati (max 100) e ogni altro utente vede un errore.

**Verifica:** stato "In produzione" visibile nella pagina della schermata di consenso.

## A3. Prima del caricamento — [io]

Già fatto: pacchetto `dist/lemonsqueezer-chromium-prod-store-1.3.2.zip` (93 KB). Contenuto verificato: manifest MV3, `default_locale: en`, nessuna `key`, API su prod, nessun file `_old`/`.map`/test, nessuno script remoto o inline.

Se vengono fatte altre modifiche al codice prima dell'invio, si ricostruisce con:

```bash
node scripts/build-brand.mjs lemonsqueezer --env prod --browser chromium --store
cd dist/lemonsqueezer && zip -r -q ../lemonsqueezer-chromium-prod-store-1.3.2.zip . -x '*/.DS_Store'
```

**Perché senza `key`:** lo store assegna l'ID dell'estensione. Una `key` nel manifest può far rifiutare il caricamento.

## A4. Bozza e ID — [tu]

1. Console → **New item** → carica `dist/lemonsqueezer-chromium-prod-store-1.3.2.zip`.
2. **Non inviare ancora.** Il caricamento crea la bozza e assegna l'**Item ID** (32 lettere minuscole). Copialo e mandamelo.

**Verifica:** la bozza compare con nome "LemonSqueezer — TL;DR", versione 1.3.2, e l'ID visibile nell'URL.

## A5. Registrare il redirect OAuth — [tu] · blocca il login

Senza questo passo il login Google fallisce con `redirect_uri_mismatch`.

1. Google Cloud → API e servizi → **Credenziali** → il client Web `610186850503-…`.
2. **URI di reindirizzamento autorizzati** → aggiungi `https://<Item ID>.chromiumapp.org/` (con la `/` finale).
3. Salva. Google può impiegare da pochi minuti a qualche ora per propagare la modifica.

**Verifica:** scarica la bozza come zip di prova dalla console (o carica l'estensione non pacchettizzata con lo stesso ID) e fai login. Se vedi `redirect_uri_mismatch`, l'URI non corrisponde carattere per carattere (controlla la `/` finale e l'ID).

## A6. Origini CORS di prod — [io] · non blocca

Aggiungo `chrome-extension://<Item ID>` a `ALLOWED_ORIGINS` di prod. È igiene: **misurato** che l'estensione funziona anche senza, perché `host_permissions` esenta le sue richieste dal CORS.

## A7. Scheda dello store — [tu]

Tutti i testi sono in `store/lemonsqueezer/listing.md` (generato da `store/generate-listings.mjs`).

**Scheda del prodotto**

| Campo | Valore |
|---|---|
| Nome | `LemonSqueezer — TL;DR` (già nel manifest) |
| Descrizione breve (≤132) | "TL;DR di qualsiasi pagina in un clic: i punti chiave, senza rumore. Riassunti nella tua lingua." (95 caratteri) |
| Descrizione dettagliata | Sezione "Descrizione dettagliata" del listing (menziona PDF, video con sottotitoli e trascrizione Premium) |
| Categoria | Produttività |
| Lingua | Italiano (vedi nota sotto) |
| Icona | 128×128 dal pacchetto (`assets/icon-128.png`) |
| Screenshot | Carica i 6 file di `store/lemonsqueezer/screenshots/` (1280×800). Minimo 1, massimo 5 per lingua: scegline 5 |
| Sito web | `https://bifa.digital` (o la landing del brand quando esiste) |
| Email di assistenza | `contact@bifa.digital` |

> **Nota lingua.** La scheda è oggi solo in italiano, l'interfaccia in 5 lingue con inglese come predefinita. Per un reviewer e per gli utenti non italiani conviene aggiungere la scheda in inglese. Posso generarla: dimmelo. Non blocca l'approvazione.

**Scheda "Privacy" — campo per campo**

1. **Scopo unico** (testo suggerito): *"Riassumere la pagina web, il PDF o il video che l'utente sta guardando, su sua richiesta, e mostrare il riassunto nella pagina."*
2. **Giustificazione dei permessi**, uno per uno (i testi sono già nel listing):
   - `host_permissions` (`http://*/*`, `https://*/*`): leggere il testo della pagina attiva solo quando l'utente chiede un riassunto, e scaricare i sottotitoli del video della pagina. Nessuna lettura in background.
   - `scripting`: inserire lo script che legge la pagina e mostra il riassunto, su richiesta.
   - `activeTab`: dichiarato ma oggi non usato dal codice; è innocuo, ma se il reviewer lo contesta si può rimuovere dal manifest.
   - `storage`: salvare il token di sessione, la lingua e il livello di sintesi.
   - `identity`: login con Google (OAuth) per gestire quota e piano.
   - `contextMenus`: voce "Riassumi" sul menu contestuale di pagine e link, attivata dall'utente.
   - `notifications`: avviso quando un'analisi lunga termina con il popup chiuso.
3. **Codice remoto**: *No.* L'estensione non carica né esegue codice da server (verificato: nessuno script remoto o inline).
4. **Uso dei dati — categorie da spuntare**, in base a ciò che il prodotto invia o salva davvero:
   - **Informazioni personali identificabili** (email, nome: account Google).
   - **Informazioni di autenticazione** (login OAuth, token di sessione).
   - **Contenuto del sito web e risorse** (testo della pagina, sottotitoli, audio del video, testo del PDF, inviati al backend su richiesta e a OpenAI per la generazione).
   - **Attività di navigazione web** (dominio della pagina riassunta, salvato in analytics; l'URL completo non viene più salvato).
   *Non verificato:* i nomi esatti delle categorie nella console possono differire leggermente da questi.
5. **Certificazioni** (le tre caselle): dati non venduti a terzi; non usati per scopi estranei alla funzione dell'estensione; non usati per determinare il merito creditizio. Sono vere per il prodotto attuale.
6. **URL informativa privacy**: `https://reading-intelligence-legal.s3.eu-west-1.amazonaws.com/privacy-policy.html` (o l'URL su `bifa.digital` se scegli la variante B).

> **Rischio da conoscere.** La policy dati utente dello store chiede che, per dati non strettamente legati alla funzione descritta, l'informazione sia mostrata **nel prodotto** con un consenso esplicito, e non solo nell'informativa. L'invio del testo della pagina quando l'utente preme "Riassumi" è la funzione stessa; il dominio in analytics è dato marginale. Ritengo il rischio basso, ma è una valutazione mia, non una garanzia. Se il reviewer lo contesta, la risposta è una schermata di consenso al primo avvio (circa mezza giornata di lavoro per me). Non la aggiungo preventivamente.

**Istruzioni per il reviewer** (campo "Test instructions") — incolla:

```
Login: Google sign-in only. Any Google account works; no special credentials needed.
Free plan: 5 trial summaries + 1 per day, so the reviewer can test without payment.
How to test: open any long article (for example a Wikipedia page), click the extension
icon, sign in with Google, then press "Summarize this page". A modal appears on the
page with the summary. Video transcription without subtitles is a Premium feature and
is not needed to evaluate the extension. Privacy policy and terms are linked in the
login screen.
```

## A8. Distribuzione e invio — [tu]

1. Scheda **Distribution**: visibilità **Unlisted** (visibile solo a chi ha il link, non compare nella ricerca). La review è la stessa della pubblica. Regioni: tutte. Prezzo: gratuito.
2. **Submit for review.** Tempi tipici: da poche ore a qualche giorno. Le richieste di chiarimento arrivano per email all'indirizzo di contatto: rispondi entro pochi giorni.
3. Scegli **pubblicazione manuale** dopo l'approvazione, così controlli prima di renderla disponibile.

**Cosa può rallentare la review:** i permessi host `*://*/*`. La giustificazione è già nel listing. Se lo store chiede di ridurli, la strada è `activeTab` + permessi opzionali (lavoro sostanziale: non un ritocco al manifest).

## A9. Test dopo l'approvazione — [tu] + [io]

Con un **account Google nuovo** (mai usato con l'estensione), installa dal link unlisted.

| # | Prova | Atteso |
|---|---|---|
| 1 | Login Google | Popup mostra il tuo nome e "5 riassunti di prova rimasti" |
| 2 | Riassunto di un articolo lungo | Modale con riassunto, titolo del brand, fonte "testo della pagina" |
| 3 | Contatore | Riapri il popup: "4 riassunti di prova rimasti" |
| 4 | PDF online (link a un `.pdf`) | Riassunto del documento |
| 5 | PDF locale (`file://`) | Il popup propone "Scegli questo PDF dal disco" |
| 6 | Video YouTube con sottotitoli | Riassunto con fonte "video" |
| 7 | 6 riassunti totali | Il sesto è l'ultimo; il settimo mostra il messaggio di limite giornaliero |
| 8 | Lingua del browser diversa | Interfaccia nella lingua (5 supportate) |
| 9 | Pulsante di acquisto | **Non deve comparire** (Stripe non configurato) |
| 10 | Link Termini/Privacy nel login | Si aprono le pagine |

**[io]** Controllo in dashboard (`https://l6ykaxiveh.execute-api.eu-west-1.amazonaws.com/prod/admin/dashboard?key=<chiave>`) che compaiano gli eventi `login_completed` e i riassunti; e che negli eventi ci sia solo il dominio. La chiave è in SSM `/reading-intelligence/prod/dashboard-admin-key`.

## A10. Rendere pubblica — [tu]

Solo se A9 è tutto verde. Scheda Distribution → cambia in **Public**. Passa una nuova, breve review in alcuni casi.

---

# PARTE B — Pagamenti (Stripe)

Si fa **dopo** il lancio gratuito, ma le decisioni B1 e i lavori [io] possono partire subito. Fino a B9 l'estensione non mostra alcun pulsante di acquisto.

## B1. Decisioni prima di toccare Stripe — [tu]

1. **Prezzi.** Deciso: €1,99/mese e €14,99/anno per tutti i brand. Conferma se valgono **IVA inclusa** (consigliato per i consumatori).
2. **IVA.** Bifa SRLS applica IVA italiana al 22% alle vendite ai consumatori italiani. Per i consumatori di altri paesi UE la regola generale è l'IVA del paese del cliente, salvo la soglia annua di 10.000 € di vendite transfrontaliere B2C sotto la quale si può applicare l'IVA italiana. **Da confermare con il commercialista.** Decidi se attivare Stripe Tax (calcolo e incasso automatico dell'IVA, a pagamento) o gestirla a mano.
3. **Margine reale (stima).** Con IVA inclusa:

   | | Mensile | Annuale |
   |---|---|---|
   | Prezzo pagato | 1,99 € | 14,99 € |
   | Al netto IVA 22% | 1,63 € | 12,29 € |
   | Commissione Stripe carta UE (1,5% + 0,25 €, stima) | 0,28 € | 0,47 € |
   | **Netto incassato** | **≈ 1,35 €** | **≈ 11,82 € (≈ 0,98 €/mese)** |

   La commissione fissa pesa il 14% sul mensile.
4. **Limite di costo della trascrizione video (Premium).** Oggi ogni Premium può trascrivere fino a **120 minuti al giorno** (`transcription.maxMinutesPerDay`). Al costo indicativo di 0,003 $/minuto (stima, verificare sul listino OpenAI) sono 0,36 $/giorno, cioè **circa 10,8 $/mese nel caso peggiore, contro un incasso netto di ≈ 1,35 €**. Il pareggio sta intorno ai **17 minuti al giorno** in media. I riassunti di testo costano invece frazioni di centesimo. Decidi il tetto **prima** di abilitare i pagamenti. Si cambia senza rilascio:

   ```bash
   KEY=$(aws ssm get-parameter --name /reading-intelligence/prod/dashboard-admin-key --with-decryption --region eu-west-1 --query Parameter.Value --output text)
   curl -X POST "https://l6ykaxiveh.execute-api.eu-west-1.amazonaws.com/prod/admin/config?key=$KEY" \
     -H 'Content-Type: application/json' \
     -d '{"values":{"transcription.maxMinutesPerDay":20},"updatedBy":"owner"}'
   ```

   Un tetto **mensile** in minuti non esiste: se serve un limite più stretto sul caso peggiore, è una piccola modifica (la aggiungo io).
5. **Limite di spesa OpenAI.** Imposta nella dashboard OpenAI un **limite mensile di budget** sul progetto usato dal backend, con avviso per email. È la protezione finale contro qualunque errore di quota. [tu]

## B2. Cosa manca nel codice prima di incassare — [io]

| # | Lavoro | Perché | Stato |
|---|---|---|---|
| 1 | **Disdetta dell'abbonamento dall'utente.** L'endpoint `POST /payments/cancel` esiste, ma nell'estensione non c'è nessun pulsante né link al portale di gestione Stripe | La normativa UE sui contratti online richiede una disdetta semplice; senza, l'unica via è scrivere a `contact@bifa.digital` | Da fare: endpoint per il portale clienti Stripe + pulsante "Gestisci abbonamento" nel popup, 5 lingue (circa mezza giornata) |
| 2 | **Consenso ai termini e rinuncia al recesso al checkout.** Il checkout non raccoglie oggi alcun consenso | Per i contenuti digitali il consumatore deve accettare esplicitamente e riconoscere la perdita del diritto di recesso prima dell'esecuzione | Da fare dopo B3: il testo esatto lo deve dare un legale. Tecnicamente si abilita `consent_collection.terms_of_service` sul checkout, e Stripe richiede l'URL dei termini impostato nel dashboard |
| 3 | **Pulsante "Elimina account".** Esiste l'endpoint, non l'interfaccia. La privacy dice "su richiesta" via email, quindi è coerente, ma è scomodo | Buona pratica GDPR e richiesta di alcuni store | Da fare (circa un'ora) |
| 4 | **Pagine di ritorno per brand** su `bifa.digital` | Vedi B6 | Da fare |
| 5 | **Allarmi e budget** su AWS | Oggi non esiste nessun budget AWS né allarme CloudWatch | Da fare: dammi un'email per gli avvisi |

## B3. Revisione legale — [tu]

Prima di incassare, un legale rivede Termini e Privacy: recesso sui contenuti digitali, minori, foro competente (oggi Torino), e le clausole di rinnovo. Il testo tecnico è allineato al prodotto, ma **non è una revisione legale**. Il testo del consenso al recesso (B2.2) esce da qui.

## B4. Account Stripe LIVE — [tu]

1. Crea/apri l'account Stripe intestato a **Bifa SRLS**.
2. **Attiva l'account** (verifica dell'attività): partita IVA, dati della società, rappresentante legale con documento, IBAN per gli accrediti. Stripe può impiegare giorni; iniziare presto.
3. Impostazioni → **Dettagli pubblici**: nome dell'attività, sito, email e telefono di assistenza, **descrizione sull'estratto conto** (es. `LEMONSQUEEZER`, max 22 caratteri: appare sull'estratto del cliente e riduce le contestazioni).
4. Impostazioni → **Email**: attiva le ricevute per i pagamenti riusciti.
5. Impostazioni → **Portale clienti**: attiva il portale, abilita "annulla abbonamento" e la cronologia fatture. Serve al pulsante B2.1.
6. Impostazioni → **Termini di servizio**: inserisci l'URL dei termini (serve al consenso B2.2).

## B5. Prova completa in modalità TEST su staging — [tu] + [io]

Si prova tutto con carte finte, sull'ambiente di staging, **prima** di toccare il LIVE.

1. **[tu]** Nel dashboard Stripe in modalità **Test**, per **almeno due brand** (consiglio Lemon e Scout): Prodotti → aggiungi prodotto → due prezzi ricorrenti (mensile 1,99 €, annuale 14,99 €) → copia i `price_…`. Aggiungi ai prezzi il metadato `brand=<idbrand>`.
2. **[tu]** Sviluppatori → **Webhook** → aggiungi endpoint con URL dello stack di staging:

   ```bash
   aws cloudformation describe-stacks --stack-name lemonsqueezer-staging --region eu-west-1 \
     --query "Stacks[0].Outputs[?OutputKey=='StripeWebhookUrl'].OutputValue" --output text
   ```
   Ora è `https://7ahiwbijckloc4n5inc65r4fyu0jaebd.lambda-url.eu-west-1.on.aws/`, ma leggilo sempre dallo stack. Eventi da selezionare, **tutti e 6**: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_succeeded`, `invoice.payment_failed`. Copia il **segreto di firma** `whsec_…`.
3. **[io]** Imposto i parametri SSM di staging con lo script (che ora scrive i nomi corretti):

   ```bash
   ENV=staging STRIPE_SECRET_KEY=sk_test_… STRIPE_WEBHOOK_SECRET=whsec_… \
   LEMON_M=price_… LEMON_Y=price_… SCOUT_M=price_… SCOUT_Y=price_… \
   STRIPE_SUCCESS_URL='https://bifa.digital/{brand}/thank-you.html' \
   STRIPE_CANCEL_URL='https://bifa.digital/{brand}/canceled.html' \
   bash infra/setup-stripe-live.sh
   ```
   Poi ridispiego staging per invalidare la cache dei segreti.
4. **Verifica** che il prezzo sia visibile: `curl https://rjayfeyebe.execute-api.eu-west-1.amazonaws.com/staging/pricing` deve mostrare `configured: true` per i brand configurati.
5. **[tu]** Installa la build di staging (`node scripts/build-brand.mjs lemonsqueezer --env staging`, estensione non pacchettizzata) e prova questi casi con le carte di test Stripe:

   | Caso | Carta di test | Atteso |
   |---|---|---|
   | Acquisto riuscito | `4242 4242 4242 4242` | Torni alla pagina di ritorno del **brand giusto**; entro pochi secondi il popup mostra Premium; nessun limite di riassunti |
   | Carta rifiutata | `4000 0000 0000 0002` | Checkout mostra l'errore; l'utente resta free |
   | Autenticazione 3D Secure | `4000 0025 0000 3155` | Richiede la conferma; poi come il caso 1 |
   | Rinnovo che fallisce | `4000 0000 0000 0341` | L'acquisto iniziale riesce; al rinnovo (usa un *test clock* di Stripe per avanzare il tempo) arriva `invoice.payment_failed` e lo stato cambia |
   | Disdetta | dal portale | Premium fino a fine periodo, poi torna free (`customer.subscription.deleted`) |
   | Secondo brand | acquista Scout con lo stesso utente | Premium **solo** su Scout; Lemon resta free (indipendenza commerciale) |

6. **[io]** Dopo ogni caso controllo la tabella degli abbonamenti (`reading-intelligence-subscriptions-staging`): un record per brand, con il `brand` giusto e lo stato atteso. E nel dashboard Stripe → Webhook → **tutti gli eventi con risposta 200**.

**Se qualcosa non torna:** Stripe → Webhook → l'evento → "Reinvia". Il codice è idempotente (un evento ripetuto non duplica nulla).

## B6. Pagine di ritorno per ogni brand — [io]

Il checkout rimanda a una pagina di ringraziamento e a una di annullamento. Oggi su `bifa.digital/lemonsqueezer/` esistono `thank-you.html` e `canceled.html` (del 24 ottobre 2025: testo e stile vecchi, solo per Lemon). Per gli altri brand `bifa.digital/<brand>/` risponde 403.

- Genero le due pagine per i 5 brand da un modello unico (nome, colori e link del brand) e le pubblico nel bucket `bifa-landing-page-1748613593` (regione `eu-central-1`) con invalidazione della cache CloudFront `E2GJS3BOS5H9OT`.
- Il parametro `stripe-success-url` usa `{brand}` (già supportato dal codice), quindi ogni brand atterra sulla propria pagina.

**Verifica:** `curl -I https://bifa.digital/scout/thank-you.html` → 200, e il testo cita Scout.

## B7. Passaggio a LIVE — [tu] + [io]

Solo dopo B3 (legale), B4 (account attivo) e B5 (prove verdi).

1. **[tu]** Stripe in modalità **Live**: per ogni brand un prodotto con prezzo mensile e annuale (stessi importi del test); copia i `price_…` LIVE.
2. **[tu]** Webhook LIVE con l'URL dello stack **prod** e gli stessi 6 eventi; copia il `whsec_…` LIVE.
3. **[tu]** Chiave segreta LIVE (`sk_live_…`): Sviluppatori → Chiavi API. Non incollarla in chat né in file: passa i valori come variabili d'ambiente nel comando.
4. **[io]** Applico:

   ```bash
   ENV=prod STRIPE_SECRET_KEY=sk_live_… STRIPE_WEBHOOK_SECRET=whsec_… \
   LEMON_M=… LEMON_Y=… SCOUT_M=… SCOUT_Y=… SIGNAL_M=… SIGNAL_Y=… BRIEFLY_M=… BRIEFLY_Y=… NOBULL_M=… NOBULL_Y=… \
   STRIPE_SUCCESS_URL='https://bifa.digital/{brand}/thank-you.html' \
   STRIPE_CANCEL_URL='https://bifa.digital/{brand}/canceled.html' \
   bash infra/setup-stripe-live.sh
   ```
   Poi ridispiego prod.
5. **Verifica:** `/prod/pricing` → `configured: true`; l'estensione mostra il pulsante di acquisto (senza ricompilare nulla).
6. **[tu]** **Acquisto reale** di prova con una carta vera sul mensile di un brand (1,99 €): Premium attivo, ricevuta email arrivata, record in `reading-intelligence-subscriptions-prod`, evento `subscription_activated` in dashboard. Poi **rimborsa** dal dashboard Stripe e verifica che la disdetta riporti l'utente a free.
7. Ripeti su un secondo brand per confermare l'isolamento.

## B8. Se serve spegnere i pagamenti — [io]

Togliere (o svuotare) i price id di un brand in SSM e ridispiegare: `configured` torna `false` e l'estensione nasconde il pulsante, senza rilasciare una nuova versione. Gli abbonamenti esistenti restano validi; le disdette continuano a funzionare.

## B9. Monitoraggio dei pagamenti — [tu] + [io]

- Stripe → Webhook: controlla ogni giorno, nella prima settimana, che non ci siano consegne fallite.
- Stripe → **Radar**: lascia le regole predefinite.
- **[io]** Allarme CloudWatch su errori 5xx della Lambda webhook e della Lambda API (dopo che mi dai l'email per gli avvisi).

---

# PARTE C — Sito marketing su bifa.digital

`bifa.digital` è già servito da CloudFront sul tuo account AWS e ha una landing aziendale (`index.html`, blog, privacy). Le pagine dei brand vanno in sottocartelle.

1. **[io]** Genero le pagine: `node apps/website/generate-site.mjs --all` → `apps/website/dist/<brand>/{landing,pricing,faq}.html`, con i prezzi inseriti nei modelli (`apps/website/template/pricing.html`).
2. **[tu]** Decisione: dove pubblicare. Consiglio `bifa.digital/<brand>/` (nessuna spesa né DNS in più). L'alternativa è un dominio per brand (costa e richiede DNS, certificato e una distribuzione CloudFront ciascuno).
3. **[io]** Carico nel bucket `bifa-landing-page-1748613593` e invalido `E2GJS3BOS5H9OT`.
4. **Verifica:** le pagine rispondono 200 e il link "Aggiungi a Chrome" punta all'URL pubblico dell'estensione (disponibile solo dopo A10).

Il sito non blocca A né B: serve per il marketing e come URL "sito web" della scheda.

---

# PARTE D — Gli altri 4 brand (Scout, NoBull, Briefly, Signal)

## D1. Non lanciarli insieme a Lemon

La policy dello store sui contenuti ripetitivi valuta l'esperienza offerta: cinque estensioni con lo stesso codice e cambiando colori e prompt rischiano di essere trattate come duplicati, con il pericolo di rifiuto o di sospensione dell'**account sviluppatore intero** (quindi anche di Lemon). Attendi l'esito e qualche settimana di vita di Lemon, poi procedi **uno alla volta**: Scout → NoBull → Briefly → Signal.

Prima di ciascuno, dimostra un caso d'uso riconoscibile (ogni brand ha un prompt e uno schema di output propri: usali nella scheda con esempi reali).

## D2. Per ogni brand

1. **Screenshot "risultato"**: mancano per i 4 brand (la sessione deve essere autenticata). Due strade:
   - **[tu]** Fai login Google su una build di staging del brand, leggi `authToken` dalla console del service worker (`chrome.storage.local.get('authToken')`), poi **[io]** `node qa/store-screenshots.mjs <brand> <token>`;
   - oppure autorizzi esplicitamente **[io]** a generare un token di test di staging (la generazione non è automatica: la sessione secondaria è stata correttamente bloccata quando ha provato a farlo da sola).
2. Ripeti la Parte A per il brand: nuovo item (nuovo ID) → nuovo redirect OAuth `https://<ID>.chromiumapp.org/` → scheda → review → test.
3. Ripeti B5–B7 per il brand: price id LIVE dedicati.

---

# PARTE E — Firefox e Safari

## E1. Firefox (addons.mozilla.org)

Pacchetti pronti: `dist/<brand>-firefox-prod-1.3.2.zip`. Lint (`web-ext`): 0 errori; restano 8 avvisi `innerHTML` (contenuto sempre passato da `esc()`; non bloccanti).

1. **[tu]** Account su <https://addons.mozilla.org/developers/> (gratuito).
2. **Login Google su Firefox.** Il redirect OAuth ora usa `identity.getRedirectURL()`, che su Firefox produce `https://<hash>.extensions.allizom.org/`. *Non verificato in un vero Firefox.* Dopo il primo caricamento, leggi l'URL effettivo (console del popup: `browser.identity.getRedirectURL()`), registralo tra gli URI autorizzati del client Google e prova il login. **Senza questo il login non funziona su Firefox.**
3. Submit: carica lo zip, scegli distribuzione **Su AMO** (pubblica) o **Autodistribuita** (firmato ma non elencato), compila la scheda dai listing e indica l'informativa privacy.
4. Il consenso ai dati è già dichiarato nel manifest (`data_collection_permissions`): dati richiesti *autenticazione, identificazione personale, contenuto del sito, attività di navigazione*; opzionale *tecnici e di interazione*. Versione minima Firefox 140 (desktop) e 142 (Android).
5. AMO chiede il **codice sorgente** solo se il pacchetto è ottenuto con strumenti di build/minificazione. Qui i file sono copie non minificate più `brand-config.js`/`policy-config.js` generati: in caso di richiesta si allega il repository e `scripts/build-brand.mjs`.

## E2. Safari

Richiede macOS + Xcode e l'**Apple Developer Program (99 USD/anno)**. Passi: `node scripts/build-brand.mjs <brand> --env prod`, poi `xcrun safari-web-extension-converter dist/<brand>`, firma in Xcode, prova, e invio da App Store Connect (l'estensione è distribuita dentro un'app contenitore). Ultima priorità.

---

# PARTE F — Operatività dopo il lancio

## F1. Cosa guardare

| Cosa | Dove | Frequenza |
|---|---|---|
| Funnel, retention, riassunti per brand | `/prod/admin/dashboard?key=…` | Giornaliera nella prima settimana |
| Errori Lambda | CloudWatch Logs `reading-intelligence-summarize-prod` | Se arrivano segnalazioni |
| Consegne webhook | Stripe → Webhook | Giornaliera dopo B7 |
| Spesa OpenAI | Dashboard OpenAI | Settimanale |
| Costo AWS | Cost Explorer | Settimanale |

## F2. Modificare i limiti senza rilasciare

`GET/POST /prod/admin/config?key=…` con chiave amministrativa: 15 parametri (prove, quota giornaliera, minuti di trascrizione, soglie di contenuto, rate limit). I valori vengono validati (fuori intervallo = rifiutato) e ogni modifica è una nuova versione: lo storico è leggibile. Per tornare al default si rimuove la voce.

## F3. Aggiornare l'estensione

1. Modifica il codice, sali di versione in `extension/manifest.json` (lo store rifiuta la stessa versione due volte).
2. Ricostruisci il pacchetto (A3), caricalo come nuova versione nell'item esistente, invia in review. Le modifiche ai permessi o ai dati raccolti fanno ripartire una review completa e mostrano un avviso agli utenti.

## F4. Backup e ripristino

Misurato il 19 settembre: il **Point-in-Time Recovery** (ripristino a qualunque istante degli ultimi 35 giorni) era attivo solo su `users`; `subscriptions`, `payments` e `config` non avevano alcun backup. Ora è abilitato nel template su queste tre tabelle e viene applicato dal deploy. Verifica: `aws dynamodb describe-continuous-backups --table-name reading-intelligence-subscriptions-prod --region eu-west-1`. La protezione dalla cancellazione della tabella non è attiva su nessuna: si valuta a parte, perché può bloccare un futuro aggiornamento dello stack che richieda di sostituire una tabella.

---

# PARTE G — Rischi aperti e decisioni

| # | Punto | Gravità | Azione |
|---|---|---|---|
| 1 | Nessun budget né allarme AWS/OpenAI | Alta | Budget AWS + limite OpenAI + allarmi (B1.5, B9). Servono le tue email |
| 2 | Costo di trascrizione nel caso peggiore superiore all'incasso | Alta prima dei pagamenti | Decidere il tetto (B1.4) |
| 3 | Nessuna disdetta in-app né consenso al recesso | Alta prima dei pagamenti | B2.1 e B2.2 |
| 4 | Link legali su S3 e consenso Google | Media | Variante B in A2 se Google rifiuta il dominio |
| 5 | Review Chrome: permessi host ampi | Media | Giustificazione pronta; alternativa `activeTab` = lavoro grosso |
| 6 | Divulgazione dati "nel prodotto" | Bassa/media | Schermata di consenso solo se contestata (A7) |
| 7 | 5 estensioni con codice identico | Media | Lanciarle in sequenza (D1) |
| 8 | Login Google su Firefox mai provato in un vero Firefox | Media | E1.2 |
| 9 | Backup dei dati: mancavano su `subscriptions`, `payments`, `config` | Media | Chiuso nel template (F4); da verificare dopo il deploy |
| 10 | Schede store solo in italiano | Bassa | Posso generare inglese |
| 11 | `activeTab` dichiarato e non usato | Bassa | Rimovibile se contestato |
| 12 | Tetto sui job concorrenti basato su un contatore che può restare alto se un worker muore | Bassa | Si riconcilia da solo alla prima richiesta rifiutata (verificato) |

---

# APPENDICE H — Valori e comandi di riferimento

**Ambienti**

| | dev | staging | prod |
|---|---|---|---|
| API | `https://4jo5gamel9.execute-api.eu-west-1.amazonaws.com/dev` | `https://rjayfeyebe.execute-api.eu-west-1.amazonaws.com/staging` | `https://l6ykaxiveh.execute-api.eu-west-1.amazonaws.com/prod` |
| Deploy | automatico a ogni push su `main` | automatico dopo dev | manuale con approvazione: `gh workflow run deploy-prod.yml -f confirm=prod` |
| SSM | `/reading-intelligence/dev/` | `/reading-intelligence/staging/` | `/reading-intelligence/prod/` |

**Chiavi SSM Stripe per brand** (nomi esatti letti dal codice; le vecchie `stripe-premium-*` non sono più lette):
`stripe-<brand>-premium-monthly-price-id` e `stripe-<brand>-premium-yearly-price-id`, con `<brand>` ∈ `lemonsqueezer`, `scout`, `signal`, `briefly`, `nobull`. Più `stripe-secret-key`, `stripe-webhook-secret`, `stripe-success-url`, `stripe-cancel-url`.

**Pacchetti**

```
dist/<brand>-chromium-prod-store-1.3.2.zip   # Chrome Web Store (senza key)
dist/<brand>-firefox-prod-1.3.2.zip          # AMO
```

**Verifica rapida dello stato di prod**

```bash
P=https://l6ykaxiveh.execute-api.eu-west-1.amazonaws.com/prod
curl -s $P/health            # 200
curl -s $P/config            # limiti pubblici in vigore
curl -s $P/pricing           # configured=false finché Stripe non è attivo
```

**Test**

```bash
cd backend && node --test                       # 285 test, 0 fallimenti
RUN_INTEGRATION=1 npm run test:integration      # OAuth e ciclo Stripe contro DynamoDB di staging
node qa/ui-e2e.mjs                              # UI dell'estensione in un browser reale
node qa/i18n-runtime.mjs                        # 5 lingue in browser reale
```

**Documenti collegati:** `docs/go-live-checklist.md` (riepilogo), `docs/store-publishing.md` (store), `docs/runbooks/stripe-live-setup.md` (Stripe), `docs/AUDIT-BRIEF.md` (esito degli audit).
