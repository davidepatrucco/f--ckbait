# Reading Intelligence Platform — dossier per audit (revisione 3)

**Per:** lo sviluppatore che ha eseguito le prime due revisioni.
**Commit:** `main` @ 259 test verdi. **Data:** settembre 2026.

Questa revisione nasce dai reperti del secondo giro. Cinque correzioni che avevo
dichiarato concluse non reggevano alle tue prove: sono riaperte, corrette e
verificate qui sotto. **Non resta nulla di aperto per scelta**: l'unico punto che
avevo classificato "funzionalità da dimensionare" — la configurazione amministrabile
a runtime — è stato realizzato.

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

## 8c. Cosa resta aperto — e perché

1. **SSRF nel worker**: ffmpeg riceve l'URL e i suoi accessi successivi (segmenti HLS)
   non passano dal guard JavaScript. Attenuazione **verificata**: le Lambda non sono
   in VPC e Lambda non espone IMDS, quindi non esiste rotta verso reti private. È un
   buco di principio, che diventerebbe reale solo cambiando il modello di deployment.
2. **Limite job non rigido**: il controllo è leggi-poi-scrivi, quindi sotto
   concorrenza perfetta qualche richiesta in più può passare. Protezione di costo, non
   vincolo di sicurezza.
3. **Minuti stimati** dai segmenti per i job asincroni (il sincrono usa la durata
   reale): un video interrotto a metà consuma budget per intero.
4. **`/admin/dashboard` pubblica** (solo shell, ispezionata: nessun dato né segreto).
5. **Copertura test**: OAuth completo, ciclo Stripe end-to-end e UI dell'estensione
   oltre al popup restano senza test automatici.
6. **Prod**: dev e staging sono allineati; il deploy in produzione richiede
   un'approvazione esplicita non ancora data.

Nessuno di questi è una correzione rinviata: sono limiti dichiarati, con la ragione.

## 9. Domande per il terzo giro

1. La ricevuta `{type, brandId, period}` copre tutti i percorsi di errore del rimborso,
   o resta un caso in cui si restituisce la cosa sbagliata?
2. Il compare-and-swap sul reset con ritentativo come incremento normale: esiste una
   sequenza concorrente che lo scavalca?
3. `claimJob` rende il worker idempotente rispetto alla doppia consegna, ma un'invocazione
   che muore dopo il claim lascia il job `running` fino alla finestra di 20 minuti. È un
   compromesso accettabile o serve un heartbeat?
4. Il budget minuti stimato dai segmenti (§8.3) è sufficiente, o va misurata la durata
   prima di iniziare?
5. Sulla proposta dei permessi: `activeTab` + iniezione su richiesta è praticabile, ma
   perdiamo il menu contestuale sui link e la lettura dei sottotitoli da CDN terze.
   Vale lo scambio?
6. Cosa manca ancora in questo dossier.
