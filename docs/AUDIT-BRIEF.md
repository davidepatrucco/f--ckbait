# Reading Intelligence Platform — dossier per audit esterno

**Destinatario:** sviluppatore esterno incaricato della peer review finale prima della pubblicazione.
**Stato del codice:** commit `1bbbd0c` su `main`. 131 commit, 218 test automatici verdi.
**Data:** settembre 2026.

Questo documento è scritto per chi non conosce il progetto. Contiene ciò che serve per
metterlo in discussione: architettura, decisioni prese e perché, ciò che è stato
verificato e **come**, e soprattutto ciò che è noto essere debole o incompleto.

Dove un'affermazione è stata misurata, è indicato. Dove non lo è, è indicato lo stesso.

---

## 1. Cos'è

Estensione browser (Chrome/Firefox, MV3) che riassume una pagina web, un video o un PDF,
appoggiandosi a un backend serverless su AWS che chiama un LLM.

Particolarità: **una sola codebase genera cinque prodotti** (`lemonsqueezer`, `scout`,
`signal`, `briefly`, `nobull`). Cambiano nome, colori, icona, prompt e schema di output;
l'identità utente è condivisa, ma **quota, piano e abbonamento sono indipendenti per
brand**. Il primo a essere pubblicato è LemonSqueezer.

| | |
|---|---|
| Backend | ~6.800 righe (Node ESM, AWS Lambda) |
| Estensione | ~4.500 righe (JS, nessun framework, nessun bundler) |
| Test | 218, in 32 file |
| Endpoint | 25 |
| Lingue UI | 5 (153 chiavi) |

---

## 2. Architettura

```
Estensione (MV3)                        AWS (eu-west-1)
┌────────────────────────┐              ┌─────────────────────────────────┐
│ popup.js    UI, login  │              │ API Gateway (REST)              │
│ content.js  estrazione │──HTTPS──────▶│   └─ Lambda "summarize"         │
│ service_worker  rete   │              │        (router, 25 endpoint)    │
│ source-decision  scelta│              │   └─ Lambda "transcribe-worker" │
│ summary.html  risultati│              │        (async, ffmpeg, 15')     │
└────────────────────────┘              │ DynamoDB ×9  ·  SSM  ·  S3      │
                                        └─────────────────────────────────┘
```

**Tre ambienti isolati** — dev, staging, prod. Stack CloudFormation separati, tabelle e
segreti separati. `dev → staging` è automatico a ogni push su `main`; **prod richiede
approvazione manuale** (GitHub Environments).

**Scelta non ovvia: l'estrazione del testo avviene nel browser, non sul server.**
Il backend faceva il fetch della pagina e l'estrazione con JSDOM+Readability, ma su
pagine grandi superava il limite di 29 secondi di API Gateway (HTTP 504), e vedeva una
pagina diversa da quella dell'utente (paywall, contenuti dietro login, SPA). Ora il
content script legge il DOM già renderizzato e invia il testo. Il fetch server-side resta
come fallback per i link aperti dal menu contestuale.

---

## 3. Dove guardare per primo

In ordine di rischio decrescente. Sono i punti dove un errore costa di più.

| # | Area | File | Perché conta |
|---|------|------|--------------|
| 1 | Quota e prove gratuite | `backend/src/auth.mjs`, `dynamodb.mjs` | Un errore qui significa riassunti illimitati gratis (costo) o utenti bloccati a torto |
| 2 | Decisione della fonte | `extension/source-decision.js` | Decide *cosa* riassumere. Un errore = riassunto silenziosamente sbagliato |
| 3 | Job di trascrizione | `backend/lambda/transcribe-worker.mjs`, `src/transcribe-jobs.mjs` | Unico path con costo per minuto; limiti anti-abuso |
| 4 | SSRF / input non fidati | `backend/src/web-fetcher.mjs`, `transcribe.mjs` | Gli URL arrivano dalla pagina visitata, quindi da un potenziale attaccante |
| 5 | Prompt injection | `backend/src/prompts/untrusted.mjs` | Il testo della pagina e i sottotitoli finiscono nel prompt |

---

## 4. Decisioni di progetto e loro motivazione

Elencate perché sono i punti su cui vorrei più dissenso, non conferma.

**4.1 Quota: 5 prove iniziali, poi 1 riassunto al giorno.**
Due contatori distinti sull'entitlement per-brand: `trial_remaining` (una tantum, non si
ricarica) e `usage_used` (giornaliero, reset a mezzanotte UTC). Le prove precedono la
quota. Motivo: 1/giorno secco non permette di capire se il prodotto serve.

**4.2 Prenota-poi-agisci sulla quota.**
La quota viene decrementata *prima* di chiamare l'LLM, con un aggiornamento condizionale
DynamoDB (`usage_used < limit`), e **rimborsata** se il riassunto fallisce. L'alternativa
(incrementare dopo il successo) consente a richieste concorrenti di superare il limite.
`refundUsage` deve restituire *ciò che è stato consumato*: incrementUsage lo annota su
`lastConsumption`. **Questo è un punto fragile: è stato messo tardi, va guardato.**

**4.3 Il piano non sta nel JWT.**
Il token contiene solo `userId` ed `email`. Il piano viene riletto dal database a ogni
richiesta. Un token rubato non può auto-promuoversi a premium.

**4.4 Video: i sottotitoli prima della trascrizione.**
Se la pagina espone una traccia WebVTT, si usa quella: gratis, istantanea, **nessun
limite di durata**, e funziona anche con stream protetti (la traccia è separata dal
video). Solo in assenza di sottotitoli si trascrive l'audio, che costa per minuto ed è
riservato al premium.

**4.5 Decisione della fonte come funzione pura con regole ordinate.**
`probe (DOM) → decide (puro) → esegui`. Le regole sono ordinate e chiuse da un catch-all,
quindi ogni input mappa a esattamente un'azione. La catena di degrado (sottotitoli
falliti, STT non disponibile, piano sbagliato) è implementata **ri-decidendo su un
inventario ridotto**, così termina sempre e riusa la logica già testata.

**4.6 Contenuti troppo lunghi: errore esplicito, non riassunto parziale.**
Oltre 80.000 caratteri si rifiuta con un messaggio. Un riassunto che ignora metà del
documento senza dirlo è peggio di un rifiuto. **Conseguenza accettata**: niente libri.

**4.7 L'interfaccia segue la lingua del browser, l'output la scelta dell'utente.**
Sono due cose diverse: `chrome.i18n` per la UI (5 lingue), un selettore per la lingua del
riassunto.

---

## 5. Sicurezza — cosa è stato verificato, con quale metodo

Tutto ciò che segue è stato **eseguito** contro l'ambiente staging reale, non dedotto.

| Verifica | Metodo | Esito |
|---|---|---|
| SSRF | 11 vettori (IMDS `169.254.169.254`, `localhost`, `::1`, 10/172/192.168, `0.0.0.0`, `file://`, `gopher://`, `metadata.google.internal`) | 11/11 bloccati prima di qualunque fetch |
| Prompt injection | Trascrizione contenente "ignora le istruzioni precedenti" **più** un tentativo di uscire dai marcatori `⟦/SORGENTE⟧` | Respinta: ha riassunto il contenuto vero |
| Autenticazione | 5 endpoint senza token; token con firma manomessa | 401 su tutti |
| Ownership dei job | Lettura del job di un altro utente | 404 (indistinguibile da inesistente) |
| Gate premium | Utente **free reale** creato in DynamoDB, poi rimosso | Respinto su entrambi i path video |
| Quota | Utente free, due richieste | 200 poi 429 |
| Prove gratuite | Utente nuovo, 7 richieste consecutive | 6× 200 (5 prove + 1 quota), poi 429 |
| Limite di concorrenza job | 5 job in parallelo | 2 accettati, 3 respinti |
| Esposizione dati | Vista pubblica del job | Non espone `mediaUrl` (contiene firme CDN) né `userId` |

**Difese in essere:** guard SSRF condiviso (risoluzione DNS, non solo parsing), contenuto
non fidato racchiuso tra marcatori con istruzione esplicita al modello, confronto a tempo
costante per la chiave admin, segreti solo in SSM (mai nel codice né nei pacchetti),
`Cache-Control: no-store` sulle risposte.

---

## 6. Problemi noti e non risolti

Sezione più importante del documento. Sono consapevoli, non dimenticanze.

**6.1 [MEDIA] Il limite di job concorrenti non è un tetto rigido.**
Il controllo è leggi-poi-scrivi: sotto concorrenza perfetta qualche richiesta in più può
passare prima che i job precedenti siano visibili. Nel test si è fermato esattamente a 2,
ma **non è garantito**. È una protezione di costo, non un vincolo di sicurezza. Un tetto
rigido richiede un contatore atomico sul record utente.

**6.2 [MEDIA] Nessun budget di minuti per la trascrizione.**
Esiste il limite di job concorrenti (2) e giornalieri (20), ma non un tetto ai *minuti*
trascritti. 20 job da 3 ore al giorno restano ~20 $/giorno per utente premium a 1,99 €/mese.

**6.3 [BASSA] `/admin/dashboard` è pubblica.**
Serve la shell HTML senza autenticazione. Ispezionata: nessun dato, nessuna chiave,
nessuna email, nessun endpoint interno. I dati stanno su `/admin/metrics`, che risponde
401. È divulgazione dell'esistenza della dashboard.

**6.4 [BASSA] Il margine del contatore nella catena di degrado è esattamente sufficiente.**
Simulando 3.072 stati iniziali con ogni tentativo fallito: 0 cicli, massimo 4 passi
contro un budget di 4. Esaurirlo è comunque sicuro (si finisce su `INSUFFICIENT_CONTENT`),
ma non c'è margine per un livello di degrado in più.

**6.5 Stripe non è configurato in produzione.**
Le chiavi sono in modalità test e nessun brand ha price id reali. Il checkout risponde
**500** (verificato). Mitigazione attuale: il backend espone `configured: false` e il
client **non mostra** la CTA di acquisto. Da completare prima del lancio commerciale.

**6.6 Copertura di test disomogenea.**
Backend e logica pura sono coperti bene. **Non coperti da test automatici**: il flusso
OAuth completo, il webhook Stripe end-to-end, e la UI dell'estensione oltre al popup.

**6.7 Non supportati (per scelta o per limite).**
Twitter/X (richiede login), documenti oltre ~30 pagine dense, video lunghi senza
sottotitoli oltre 3 ore, dirette in corso, Google Docs in modalità modifica. Tutti
producono un messaggio esplicito, non un errore tecnico.

**6.8 Le icone degli altri 4 brand.**
Corrette tutte e 5, ma solo LemonSqueezer ha screenshot per lo store.

---

## 7. Come verificare in autonomia

```bash
cd backend && npm ci && node --test        # 218 test, nessuna credenziale richiesta
node scripts/build-brand.mjs lemonsqueezer --env prod --browser chromium --store
node qa/i18n-runtime.mjs                   # 5 lingue in un browser reale (richiede Playwright)
node qa/extract-qa.mjs                     # euristiche di estrazione
```

Ambienti pubblici (nessuna credenziale necessaria per `/health` e `/pricing`):
- staging `https://rjayfeyebe.execute-api.eu-west-1.amazonaws.com/staging`
- prod `https://l6ykaxiveh.execute-api.eu-west-1.amazonaws.com/prod`

**Note sui test, per giudicarne il valore:**
- Il test di esaustività della decisione gira sul **prodotto cartesiano** di 7.760
  combinazioni e verifica che nessuna produca un'azione, un codice o una nota indefiniti.
- I test i18n leggono **il file realmente spedito** (`extension/source-decision.js`
  caricato in un sandbox `vm`), non una copia.
- I test aggiunti di recente sono stati **falsificati**: reintrodotto il difetto, il test
  fallisce; ripristinato, torna verde. Un test che non è mai stato visto fallire non
  dimostra nulla.

---

## 8. Domande su cui vorrei un parere

1. **Prenota-poi-rimborsa** (4.2): il meccanismo `lastConsumption` che distingue prova da
   quota è corretto in tutti i percorsi di errore, o esiste un caso in cui si rimborsa la
   cosa sbagliata?
2. **Job concorrenti** (6.1): vale la pena del contatore atomico, o il limite morbido è
   proporzionato al rischio?
3. **Permessi ampi**: `host_permissions` su `http://*/*` e `https://*/*`. Necessari per
   leggere qualunque pagina, ma sono il punto di attrito numero uno nella review dello
   store. Esiste un'alternativa praticabile con `activeTab`?
4. **Cinque estensioni quasi identiche**: rischio concreto di violare la policy
   "contenuto ripetitivo" del Chrome Web Store. Vale la pena pubblicarne una sola e
   vedere l'esito prima di esporre il portfolio?
5. **Contenuti lunghi** (4.6): rifiutare è la scelta giusta, o è preferibile un
   map-reduce (riassunti per sezione, poi fusione) accettando più token e più latenza?
6. **Cosa manca in questo documento** che ti servirebbe per dare un giudizio.

---

## 9. Stato rispetto al lancio

Pronto: 3 ambienti allineati, 5 brand, pipeline con approvazione manuale su prod,
i18n, dashboard interna, documenti legali pubblicati, pacchetto store, screenshot per
LemonSqueezer, copy e giustificazione permessi.

Mancante: Stripe LIVE, dominio per i siti e gli URL di ritorno del checkout, account
sviluppatore Chrome Web Store, screenshot per gli altri 4 brand, pacchetto Safari.

Nessun utente reale su produzione: il momento per cambiare idea su qualsiasi cosa è
adesso.
