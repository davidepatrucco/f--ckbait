# Reading Intelligence Platform — dossier per audit (revisione 2)

**Per:** lo sviluppatore che ha eseguito la prima revisione.
**Commit:** `main` @ 235 test verdi. **Data:** settembre 2026.

Questa revisione nasce dai tuoi reperti. La prima versione del dossier attribuiva ad
alcune protezioni garanzie che il codice non offriva: quelle affermazioni sono
corrette qui sotto, non riscritte in silenzio.

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
| `POST /analytics/event` | utente | tipi di evento in allowlist | no |

---

## 7. La causa strutturale che hai indicato

La misura, prima dell'intervento: `80000` duplicato in 3 file, `120000` in 4, `40000`
in 3; **40 variabili d'ambiente lette dal codice contro 14 presenti nel template**,
cioè 26 override solo teorici.

`backend/src/policy.mjs` è ora la dichiarazione unica di policy commerciali, limiti di
trascrizione, soglie di contenuto e media, rate limit e soglia di routing. I moduli
importano invece di ridichiarare, e le soglie dell'estensione sono **generate** da
quella fonte al build (`policy-config.js` nel pacchetto): il browser non contiene più
numeri scritti a mano.

Sei test lo proteggono, incluso uno che **falsifica la propagazione** (cambio la
fonte, il browser deve adottare il nuovo valore) e uno di coerenza reciproca (il
worker non può produrre più segmenti di quanti ne accetti il limite).

---

## 8. Cosa resta aperto

1. **SSRF nel worker**: ffmpeg riceve l'URL e i suoi accessi successivi (segmenti HLS)
   non passano dal guard JavaScript. Attenuazione verificata: le Lambda **non sono in
   VPC** e Lambda non espone IMDS, quindi non c'è rotta verso reti private. Resta un
   buco di principio se il deployment cambiasse.
2. **Limite job non rigido**: il controllo è leggi-poi-scrivi. Sotto concorrenza
   perfetta qualche richiesta in più può passare. È protezione di costo, non vincolo
   di sicurezza. Il tuo suggerimento del contatore atomico resta valido.
3. **Budget minuti stimato dai segmenti**, non dalla durata reale del media: un video
   rifiutato dopo il download non consuma budget, uno troncato lo consuma per intero.
4. **`/admin/dashboard` pubblica** (solo shell, ispezionata: nessun dato né segreto).
5. **Copertura test**: OAuth completo, ciclo Stripe end-to-end e UI dell'estensione
   oltre al popup restano non coperti da test automatici. I test sui contatori
   aggiunti ora sono **strutturali** (verificano l'espressione DynamoDB), non
   comportamentali: la verifica comportamentale è quella end-to-end su staging.
6. **Prod**: allineato fino al lotto precedente. L'ultimo lotto (abbonamenti, Stripe,
   budget minuti, idempotenza) è su dev e staging; il deploy in produzione richiede
   un'approvazione esplicita non ancora data.

---

## 9. Domande per il secondo giro

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
