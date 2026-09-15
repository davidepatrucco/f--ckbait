# Reading Intelligence Platform — dossier per audit (revisione 4)

**Per:** lo sviluppatore che ha eseguito le prime due revisioni.
**Commit:** `main` @ 282 test, 0 fallimenti. **Data:** settembre 2026.

Questa revisione chiude **tutti** i punti che le due precedenti avevano lasciato
aperti, compresi quelli che avevo dichiarato "limiti noti con la loro ragione".
Nessuno è più tale: SSRF nel worker, tetto rigido sui job, minuti reali, dashboard
protetta, e le tre aree di test scoperte (OAuth, ciclo Stripe, UI dell'estensione).

Scrivere quei test ha fatto emergere tre difetti che nessuna delle revisioni
precedenti aveva visto, incluso un URL non escapato dentro un `href`. Sono elencati
in §8d, perché sono la prova che quelle aree erano scoperte per davvero e non solo
sulla carta.

Regola di lettura: **verificato** = eseguito contro staging o riprodotto con uno
script; **letto** = dedotto dal codice senza esecuzione. Dove ho sbagliato io, è detto.

---

## 1. Esito dei tuoi reperti

| # | Reperto | Verifica indipendente | Esito |
|---|---|---|---|
| 1 | `/summarize` accetta una chiave inventata | **Confermato in live**: chiave arbitraria → HTTP 200 con riassunto reale | **Endpoint rimosso** (route, evento SAM, funzione morta nel client). 404 su dev, staging, prod |
| 2 | SSRF aggirabile | **Confermato**: `::ffff:127.0.0.1`, `::ffff:7f00:1`, `::ffff:169.254.169.254`, `64:ff9b::127.0.0.1` passavano | Normalizzazione IPv4-incapsulato + CGNAT/multicast; redirect seguiti a mano con rivalidazione di ogni salto |
| 3 | Prove, reset e rimborso | **Tutti e tre confermati** | Vedi §2: è il gruppo dove avevo sbagliato la verifica |
| 4 | Signup Google | Quota 10/mese **confermata**; campi `undefined` **NON riprodotti** | Inizializzazione unificata. Vedi §3 |
| 5 | Checkout vecchio riattiva premium | **Confermato** | Ora autenticato, vincolato al proprietario, richiede abbonamento `active`/`trialing`/`past_due` |
| 6a | Price ID per-brand invisibili | **Confermato con prova prima/dopo** su un parametro reale: `undefined` → valore | `getSecret` risolve i nomi non precaricati |
| 6b | Abbonamento indicizzato per solo `user_id` | **Confermato, e peggiore**: vedi §4 | Riscritto sulla tabella corretta, per brand |
| 6c | `subscription_id` vs `stripe_subscription_id` | **Confermato** | Allineato; le due scritture divergenti unificate |
| 6d | Cancellazione account non annulla su Stripe | **Confermato** | Ora annulla ogni abbonamento, poi pulisce |
| 7 | Limiti solo sui job asincroni | **Confermato** | Percorso sincrono e asincrono condividono **un** conteggio. Aggiunto il budget minuti |
| 8 | Riassunti parziali silenziosi | **Confermato** | Copertura esplicita fino alla UI; PDF oltre soglia **rifiutato** |
| 9 | Fonte sbagliata (video) | **Riprodotto il tuo caso esatto** | Guardia su prominenza/durata estesa al ramo STT |

---

## 2. Il gruppo #3: dove la mia verifica era sbagliata, non solo il codice

Avevo dichiarato le prove gratuite "verificate end-to-end su staging". Erano
verificate su un utente creato **senza entitlement**, cioè su un percorso che non
esiste in produzione. Un utente reale passa da `createUser`, che scriveva
l'entitlement **senza** `trial_remaining`; `ensureBrandEntitlement` usa
`if_not_exists` sull'**intera mappa del brand**, quindi il singolo attributo non
veniva mai aggiunto. Il lettore mostrava 5 prove, la scrittura non ne consumava
nessuna.

Il difetto non era nel codice che avevo testato: era nel percorso che **non** avevo
testato. È l'errore di metodo più significativo di questa sessione.

Correzioni: `createUser` inizializza il campo; il consumo lo inizializza comunque in
una sola operazione atomica (`if_not_exists` dentro la `SET`); il reset del periodo
è diventato un compare-and-swap sulla data letta, con ritentativo se perde la corsa;
il rimborso viaggia con una ricevuta `{type, brandId, period}` e senza ricevuta non
rimborsa nulla.

**Riverificato sul percorso reale** (`createUser`, come il signup): 6 riassunti
riusciti (5 prove + 1 quota), settimo 429, stato finale `trial=0, used=1`.

---

## 3. Un tuo reperto che non si riproduce

Il sotto-punto di #4 sui campi `undefined` passati a `createUser`: il document client
tollera gli attributi `undefined` di **primo livello** (l'errore riguarda solo
map/array/set annidati) e il percorso reale funziona. Verificato eseguendo
`createUser` con gli stessi argomenti del signup Google contro staging.

Il mio primo tentativo di riprodurlo era sbagliato — avevo passato un `id` non
definito e ottenuto una `ValidationException` diversa, che stavo per attribuire al
difetto segnalato.

---

## 4. Un difetto che l'audit ha sfiorato ma sottostimato

Il reperto 6b diceva "acquistare un secondo brand sovrascrive il primo". In realtà la
persistenza degli abbonamenti **non funzionava affatto**: `saveSubscription` e
`getUserSubscription` scrivevano e leggevano sulla tabella dei **pagamenti** con
`Key: { user_id }`, mentre quella tabella ha chiave `paymentId`.

Verificato: `ValidationException — Missing the key paymentId in the item`.

Nessun record esisteva in nessun ambiente (0 in dev, staging, prod), quindi non c'era
migrazione da fare. Ora si usa la tabella degli abbonamenti, che ha già la chiave
composta `userId` + `subscriptionId`, con il brand sull'elemento.

---

## 5. Correzioni al dossier precedente

- **§6.4**: avevo scritto "budget di 4". È `numeroTracce + 4`. Errore mio.
- **Prompt injection**: il test era **un caso**, non una garanzia. Lo presento ora
  come evidenza puntuale su quel payload (istruzioni contrarie + tentativo di uscire
  dai marcatori), non come proprietà dimostrata.
- **Test cartesiano**: dimostra che l'azione restituita appartiene al vocabolario
  previsto, **non che sia quella corretta**. È esattamente perché il reperto #9 gli è
  sfuggito, e ora lo dico nel dossier invece di lasciarlo intendere.
- **"11 vettori SSRF"**: erano insufficienti. Ora sono 11 + 7 forme IPv6 incapsulate,
  e resta il limite noto in §8.

---

## 6. Matrice endpoint → autenticazione → limiti → costo

Compilata a mano dai percorsi verificati (una generazione automatica dava righe
sbagliate, quindi non la uso).

| endpoint | autenticazione | limiti applicati | costo esterno |
|---|---|---|---|
| `POST /summarize-url` | utente | prove + quota giornaliera (prenota-poi-rimborsa) | **LLM** |
| `POST /extract-pdf` | utente | dimensione ≤3,5 MB, pagine ≤50, testo ≤80k | parsing locale |
| `POST /transcribe` (sync) | utente + **premium** | job concorrenti, job/giorno, **minuti/giorno** | **STT** |
| `POST /transcribe-job` (async) | utente + **premium** | idem, più presa in carico esclusiva | **STT** |
| `GET /transcribe-job` | utente + **proprietà** | — | no |
| `POST /payments/create-checkout` | utente | — | Stripe |
| `POST /payments/verify-checkout` | utente + **proprietà sessione** | richiede abbonamento attivo | Stripe (lettura) |
| `POST /payments/webhook` | **firma Stripe** | — | no |
| `POST /payments/cancel` | utente | per brand | Stripe |
| `POST /account/delete` | utente | — | annulla su Stripe |
| `GET /pricing` | **pubblico** | — | no |
| `GET /health` | **pubblico** | — | no |
| `GET /admin/dashboard` | **pubblico** (solo shell HTML) | — | no |
| `GET /admin/metrics` | chiave admin (confronto a tempo costante) | — | no |
| `POST /analytics/event` | **opzionale** (eventi pre-login) | tipi di evento in allowlist | no |
| `GET /config` | **pubblico** | — | no |
| `GET/POST /admin/config` | chiave admin | validazione + coerenza | no |

---

## 7. La causa strutturale che hai indicato

La misura, prima dell'intervento: `80000` duplicato in 3 file, `120000` in 4, `40000`
in 3; **40 variabili d'ambiente lette dal codice contro 14 presenti nel template**,
cioè 26 override solo teorici.

`backend/src/policy.mjs` è la dichiarazione unica di policy commerciali, limiti di
trascrizione, soglie di contenuto e media, rate limit e soglia di routing. I moduli
importano invece di ridichiarare, e le soglie dell'estensione sono **generate** da
quella fonte al build (`policy-config.js` nel pacchetto) e poi **allineate a runtime**
con quelle effettive del backend via `GET /config` — vedi §8b: il browser non contiene più
numeri scritti a mano.

Sei test lo proteggono, incluso uno che **falsifica la propagazione** (cambio la
fonte, il browser deve adottare il nuovo valore) e uno di coerenza reciproca (il
worker non può produrre più segmenti di quanti ne accetti il limite).

---

## 8. Esito del secondo giro

I cinque punti che avevi riaperto. Ognuno riprodotto prima di intervenire.

| # | Reperto | Verifica | Correzione |
|---|---|---|---|
| 1 | Il webhook salva un abbonamento senza chiave | **Confermato.** La mia correzione precedente aveva rinominato il campo nel posto sbagliato: il webhook passava `stripe_subscription_id`, il salvataggio leggeva `stripeSubscriptionId` | Id accettato in entrambe le convenzioni e **rifiuto esplicito** se manca. Ordine invertito: prima si scrive, poi si promuove a premium |
| 2 | La verifica checkout salva il brand sbagliato | **Confermato.** `resolveStripeBrand` era chiamata *dopo* il salvataggio | Brand risolto prima |
| 3 | La cancellazione account elimina i dati anche se Stripe falliscono | **Confermato** | Il record locale si rimuove solo ad annullamento riuscito; altrimenti `pending_cancellation` e **503 ritentabile**, senza cancellare nulla |
| 4 | Il budget minuti non copre il sincrono; `UnprocessedKeys` ignorate | **Confermati entrambi** | Entrambi i percorsi scrivono `minutesUsed` (il sincrono dalla durata restituita dalla trascrizione); `UnprocessedKeys` ritentate e, se la lettura resta incompleta, la richiesta è **rifiutata invece di concessa** |
| 5 | I PDF vengono tagliati in silenzio | **Confermato** (59.999 → 40.000, HTTP 200, nessun indicatore) | La risposta espone `truncated`, `characters`, `usedCharacters`; il client mostra l'avviso |

**Test comportamentali**, come richiesto: la forma dell'elemento abbonamento, la
conservazione del brand, il conteggio dei minuti senza segmenti, la parzialità del
PDF e la regola di cancellazione sono estratte in funzioni pure ed esercitate
direttamente. Tutti e cinque **falsificati**: reintroducendo ogni difetto i test
falliscono, e tornano verdi al ripristino.

Rettifiche accolte: `claimJob` ora recupera un job rimasto `running` oltre la
finestra (la sola condizione `pending` lo lasciava bloccato per sempre);
`/analytics/event` ha autenticazione **opzionale** per gli eventi pre-login, con
allowlist dei tipi — la matrice era sbagliata, non il codice; `activeTab` è
attivabile dal menu contestuale, la mia nota era imprecisa.

## 8b. Configurazione: il requisito è ora soddisfatto

Avevi chiesto: persistita, versionata, validata, modificabile senza rilascio, con
cache e pubblicazione al client, e il server come autorità. Tutto realizzato.

- **Persistita e versionata**: tabella dedicata; `active` è il puntatore, `v<n>` le
  versioni storiche. Ogni scrittura crea una versione nuova e le precedenti restano
  leggibili, quindi un cambio sbagliato è ricostruibile.
- **Validata**: 15 parametri dichiarati con tipo, intervallo e descrizione. Un valore
  fuori intervallo è **rifiutato, non limitato in silenzio** — limitarlo farebbe
  credere a chi amministra di aver impostato qualcosa che il sistema non applica.
  Nessuna applicazione parziale: se una voce è invalida, l'intero cambio è respinto.
  Si verifica anche la **coerenza reciproca** sul risultato combinato (valori
  singolarmente validi e insieme incoerenti vengono respinti).
- **Senza rilascio**: `POST /admin/config` con chiave amministrativa. Rimuovere una
  voce riporta al default **senza riavvio**.
- **Cache e autorità del server**: refresh una volta per invocazione, non per
  richiesta; `GET /config` pubblica al client i limiti effettivi, e ogni limite è
  comunque riapplicato lato server.

Verificato in live su staging: `TOO_LONG_CHARS` 80000 → 55555 → 80000 senza alcun
rilascio; un valore fuori intervallo respinto con la ragione; un cambio incoerente
respinto con il problema specifico; lettura senza chiave → 401.

I quattro letterali duplicati che avevi trovato (`MAX_CLIENT_TEXT`, limite di upload
PDF nell'handler e nel popup, soglia `TOO_LONG`) ora vengono dalla fonte, con un test
che impedisce di reintrodurli.

## 8c. I sei punti aperti: chiusi

| # | Punto | Stato | Verifica |
|---|---|---|---|
| 1 | SSRF nel worker (ffmpeg apriva da solo segmenti e chiavi HLS) | **Chiuso** | La playlist viene scaricata e analizzata da `hls-guard.mjs`: ogni URI referenziato (varianti, segmenti, chiavi di cifratura, mappe di inizializzazione) è risolto in assoluto e validato, e a ffmpeg si passa una playlist **locale** con URI già verificati — non risolve più nulla. In più `-protocol_whitelist` confina i protocolli: senza, una playlist ostile poteva indirizzarlo su `file://`. 8 test, falsificati |
| 2 | Limite job non rigido (leggi-poi-scrivi) | **Chiuso** | Il posto si prenota con un incremento condizionale, atomico lato DynamoDB. Verificato in live: **6 richieste simultanee → 2 accettate, 4 rifiutate**. Un worker morto senza rilascio non blocca l'utente: il contatore viene riconciliato con lo stato reale dei job e l'operazione ritentata |
| 3 | Minuti stimati dai segmenti | **Chiuso** | La durata si ricava dai byte prodotti (mp3 CBR 32 kbps: conversione esatta), quindi l'ultimo segmento parziale conta per quello che è. Verificato in live su un job reale: `durationSeconds: 13`, `minutesUsed: 1` — prima lo stesso job avrebbe contato 10 minuti. Il cap di durata è passato a `-t` sull'**ingresso** di ffmpeg: prima un video di 10 ore veniva scaricato e decodificato per intero prima di essere rifiutato |
| 4 | `/admin/dashboard` pubblica | **Chiuso** | Richiede la stessa chiave già necessaria per i dati. Poiché la pagina rimuove la chiave dall'URL dopo il primo caricamento, un reload sarebbe risultato non autenticato: si emette una sessione firmata (HMAC + scadenza, HttpOnly, SameSite=Strict) che **non contiene la chiave**. Verificato in live: senza chiave 401, con chiave 200 + `Set-Cookie` |
| 5 | Copertura test (OAuth, Stripe, UI) | **Chiuso** | Vedi sotto |
| 6 | Prod indietro | Dev e staging allineati; il deploy in produzione attende un'approvazione esplicita |

### Le tre aree di test, e perché di integrazione

- **OAuth — 9 test contro DynamoDB reale.** Primo accesso, accesso successivo, forma
  del token, e quattro **rifiuti veri** dell'id_token: destinatario, emittente,
  scadenza, firma. Per esercitare il caso di successo senza indebolire la verifica, la
  sola **sorgente** delle chiavi pubbliche è iniettabile: firma, emittente e
  destinatario restano controllati da `jose`. Nota di metodo: i quattro rifiuti, in una
  prima stesura, passavano perché il JWKS era irraggiungibile — cioè per il motivo
  sbagliato. Sono diventati significativi solo dopo aver fatto funzionare il caso di
  successo.
- **Ciclo Stripe — 4 test contro DynamoDB reale**, con Stripe sostituito: acquisto su
  un brand non di default, lettura per brand, indipendenza fra brand, cancellazione
  mirata, e il caso in cui l'annullamento su Stripe fallisce.
- **UI dell'estensione — 14 verifiche in un browser reale**, lungo il percorso vero
  (messaggio del popup → content script → modale), non una scorciatoia.

Sono di integrazione perché i difetti di queste aree erano **tutti** nel punto di
contatto con il database o con il browser: un finto client li avrebbe riprodotti senza
segnalarli, essendo scritto con le stesse assunzioni sbagliate del codice. Restano
saltati senza `RUN_INTEGRATION=1`, quindi la CI non richiede credenziali.

## 8d. Difetti trovati dai nuovi test

Prova che quelle aree erano scoperte:

1. **La modale di caricamento stampava `undefined`** al posto dell'URL. Visibile a
   ogni riassunto.
2. **URL non escapati nell'HTML.** Quello nella modale, e soprattutto il link
   all'originale, che finiva dentro un `href`: un URL `javascript:` sarebbe stato
   eseguito al clic. L'URL è controllato da chi pubblica la pagina. Ora i protocolli
   sono limitati a http/https, tutto passa da `esc()`, e i link esterni hanno
   `rel=noopener`.
3. **La risposta di login Google riportava `limit: 10` fisso** invece della quota
   reale dell'entitlement — un valore che non corrisponde a nessun piano.

Nessuno dei tre era stato rilevato dalle due revisioni precedenti né dai 259 test
allora presenti.

## 9. Domande per il giro finale

1. **Guard HLS**: la playlist viene materializzata localmente con URI validati. Resta
   un canale che ffmpeg può aprire e che non ho considerato — per esempio un redirect
   su un segmento, che ffmpeg segue da sé dopo la validazione dell'URL iniziale?
2. **Prenotazione atomica**: il contatore si riconcilia con lo stato reale quando una
   richiesta viene rifiutata. Esiste una sequenza in cui la riconciliazione stessa
   concede più posti del dovuto?
3. **Durata dai byte**: esatta per mp3 CBR. Se un domani si cambiasse il profilo di
   codifica in VBR, il conteggio diventerebbe silenziosamente sbagliato. Vale un
   controllo che leghi il calcolo al bitrate effettivo usato, o è sufficiente il
   commento nel codice?
4. **Sessione della dashboard**: HMAC con scadenza a 8 ore, senza revoca. Per una
   dashboard interna con una sola chiave, è proporzionato?
5. **Test di integrazione**: girano contro staging e sono saltati in CI. Preferiresti
   vederli in CI con credenziali dedicate e una tabella isolata, o va bene che restino
   una verifica manuale documentata?
6. Resta qualcosa che, dal tuo punto di vista, blocca il rilascio.
