# Dashboard Analytics per Brand — Specifica

> Stato: **parzialmente implementato (#4)**. AGGIORNAMENTO 2026-08-25: da questa spec
> è stato implementato l'MVP: il campo `event_type` **ora esiste** e il funnel è
> **strumentato** (`extension_installed/opened`, `login_completed`, `summary_completed`,
> `checkout_started`, `subscription_activated`). L'aggregazione è in
> `backend/src/dashboard.mjs` (Scan+filtro in-memory) esposta da **`GET /admin/metrics`**
> (admin-gated) e resa da **`GET /admin/dashboard`** (shell HTML same-origin). I §0.1
> "gap noti" qui sotto sono in gran parte **superati** (event_type presente); resta valido
> il §0.2 (GSI `BrandDateIndex` per scalare oltre lo Scan). Definizioni metriche
> autoritative: commenti in `backend/src/dashboard.mjs`.

## 0. Sorgente dati

Tabella DynamoDB: `reading-intelligence-analytics-<env>` (region `eu-west-1`).

| Componente | Chiave | Tipo | Note |
|---|---|---|---|
| Tabella (PK) | `eventId` | S | UUID v4, unico per evento |
| GSI `TimestampIndex` | `timestamp` (HASH) | N | epoch ms. **Solo HASH** |
| GSI `UserEventsIndex` | `userId` (HASH) + `timestamp` (RANGE) | S + N | query per-utente su finestra temporale |

Attributi per evento (da `backend/src/analytics.mjs`, `buildAnalyticsEvent`):
`eventId`, `userId`, `timestamp` (N, epoch ms), `created_at` (ISO), `brand_id`, `email`,
`plan`, `url`, `url_domain`, `title`, `language`, `chars_input`, `chars_output`,
`duration_ms`, `date_partition` (`YYYY-MM-DD`), `user_agent`, `browser`,
`client_version`, `success` (bool), `error_code`.

### 0.1 Gap noti dello schema (leggere prima di implementare)

1. **Nessun campo `event_type`.** Oggi la tabella registra **un solo tipo di evento**:
   il completamento di un'analisi/riassunto (`logSummaryEvent`). Gli eventi di funnel
   `install`, `open`, `login`, `paid` **non sono attualmente scritti**. Le metriche che
   li richiedono (install, activation, conversion, retention basata su install) sono
   qui specificate ma **richiedono instrumentazione aggiuntiva** (vedi §5).
2. **`TimestampIndex` è solo-HASH su `timestamp`.** Una GSI con solo chiave HASH
   supporta esclusivamente `KeyConditionExpression` di **uguaglianza esatta**
   (`timestamp = :t`). **Non** supporta range (`BETWEEN`, `>=`) né ordinamento. Quindi
   non è utilizzabile per aggregazioni su intervallo temporale. Le query per-brand su
   finestra temporale richiedono oggi un **`Scan` + `FilterExpression`** su
   `date_partition` e `brand_id`.
3. **Nessuna GSI su `brand_id` o `date_partition`.** L'aggregazione per brand è quindi
   `Scan`-based (costo proporzionale alla dimensione tabella, non al result set).

### 0.2 Indici raccomandati (miglioria, fuori scope di questo scaffold)

Per rendere le query per-brand efficienti si raccomanda di aggiungere:

- **GSI `BrandDateIndex`**: HASH `brand_id` (S) + RANGE `date_partition` (S).
  Abilita `Query` per brand su intervallo di date senza `Scan`.
- **GSI `BrandTimestampIndex`**: HASH `brand_id` (S) + RANGE `timestamp` (N).
  Alternativa con granularità ms.
- Campo `event_type` (S) + **GSI `BrandEventTypeIndex`**: HASH `brand_id`,
  RANGE `event_type#date_partition` (chiave composita sintetica) per il funnel.

Nel seguito ogni metrica indica **(A)** la query eseguibile **oggi** (Scan) e
**(B)** la query ottimale **con** gli indici raccomandati.

---

## 1. Metriche

Convenzioni:
- `env` = ambiente (`dev` | `prod`).
- Finestra temporale espressa come `:from` / `:to` in formato `YYYY-MM-DD`
  (`date_partition`) oppure epoch ms (`timestamp`).
- Tutte le aggregazioni sono **per `brand_id`**.

### 1.1 Install

- **Definizione**: numero di installazioni dell'estensione nella finestra.
- **Prerequisito**: evento `event_type = "install"` (non presente oggi — §5).
- **Calcolo (B)** su `BrandEventTypeIndex`: count degli item con
  `brand_id = :b AND begins_with(event_type_date, "install#")` nella finestra.
- **Fallback oggi**: non calcolabile dalla tabella analytics. Sorgente alternativa:
  Chrome Web Store stats API / store dashboard (dato esterno, non in DynamoDB).

### 1.2 Activation (primo riassunto)

- **Definizione**: numero di utenti distinti che hanno completato **il primo**
  riassunto con successo nella finestra (`success = true`), cioè per cui `min(timestamp)`
  degli eventi di analisi cade nella finestra.
- **Calcolo (A) — oggi**: `Scan` filtrando `brand_id`, `success = true`,
  `date_partition BETWEEN :from AND :to`; raggruppare per `userId`; per ogni utente
  verificare che non esistano eventi precedenti a `:from` (secondo `Scan`/`Query` su
  storico utente via `UserEventsIndex`).
- **Metrica derivata**: `activation_rate = activation / install`.

Esempio (A):
```
Scan reading-intelligence-analytics-<env>
  FilterExpression: brand_id = :b AND success = :ok AND date_partition BETWEEN :from AND :to
  ExpressionAttributeValues:
    :b    = "lemonsqueezer"
    :ok   = true
    :from = "2026-08-01"
    :to   = "2026-08-31"
```
Verifica "primo assoluto" per utente (via GSI, per-utente):
```
Query reading-intelligence-analytics-<env>
  IndexName: UserEventsIndex
  KeyConditionExpression: userId = :u AND #ts < :fromMs
  ExpressionAttributeNames:  { "#ts": "timestamp" }
  ExpressionAttributeValues: { ":u": "<userId>", ":fromMs": 1754006400000 }
Select: COUNT   # se COUNT = 0 → il primo riassunto è nella finestra → attivato
```

### 1.3 Daily summaries

- **Definizione**: numero di riassunti completati per giorno (`date_partition`),
  per brand. Base per serie temporali e medie.
- **Calcolo (A) — oggi**: `Scan` con filtro brand + intervallo, poi `GROUP BY
  date_partition` lato applicazione. `success` opzionale (distinguere completati vs
  tentati).
- **Calcolo (B)**: `Query` su `BrandDateIndex` per `brand_id = :b AND date_partition
  BETWEEN :from AND :to`, aggregazione per `date_partition`.

Esempio (A):
```
Scan reading-intelligence-analytics-<env>
  FilterExpression: brand_id = :b AND date_partition BETWEEN :from AND :to
  ProjectionExpression: date_partition, success
  ExpressionAttributeValues: { ":b": "scout", ":from": "2026-08-01", ":to": "2026-08-31" }
```
Esempio (B):
```
Query reading-intelligence-analytics-<env>
  IndexName: BrandDateIndex
  KeyConditionExpression: brand_id = :b AND date_partition BETWEEN :from AND :to
  ExpressionAttributeValues: { ":b": "scout", ":from": "2026-08-01", ":to": "2026-08-31" }
```

### 1.4 Free → Paid conversion

- **Definizione**: quota di utenti attivi passati da `plan = "free"` a un piano a
  pagamento nella finestra.
  `conversion = utenti_con_evento_paid / utenti_attivi_free`.
- **Prerequisito completo**: evento di upgrade (`event_type = "paid"`, §5) oppure
  webhook Stripe. Lo Stripe webhook handler esiste
  (`backend/lambda/handler.mjs::stripeWebhookHandler`) ma **non** scrive oggi in questa
  tabella.
- **Proxy calcolabile oggi (A)**: usare l'attributo `plan` presente in ogni evento.
  - Numeratore ≈ utenti distinti con almeno un evento a `plan != "free"` nella finestra.
  - Denominatore ≈ utenti distinti con almeno un evento `plan = "free"` prima o durante
    la finestra.
  Limite: `plan` è lo stato al momento dell'evento, non un evento di transizione;
  sottostima chi converte ma non genera analisi dopo l'upgrade.

Esempio (A) — utenti paganti attivi nella finestra:
```
Scan reading-intelligence-analytics-<env>
  FilterExpression: brand_id = :b AND date_partition BETWEEN :from AND :to AND #p <> :free
  ExpressionAttributeNames:  { "#p": "plan" }
  ExpressionAttributeValues: { ":b": "lemonsqueezer", ":from": "2026-08-01", ":to": "2026-08-31", ":free": "free" }
  ProjectionExpression: userId, #p
```

### 1.5 Retention D1 / D7 / D30

- **Definizione**: quota di utenti che ritornano (≥1 evento di analisi) esattamente
  N giorni dopo il giorno di attivazione (cohort per `date_partition` di attivazione).
  D1 = giorno +1, D7 = giorno +7, D30 = giorno +30 (finestra ±0, "classic" retention;
  usare "rolling" se si vuole ≥N).
- **Calcolo (A/B)**:
  1. Determinare la cohort: utenti con activation in `date_partition = :cohortDay`.
  2. Per ciascun utente, `Query` su `UserEventsIndex` sul giorno target.
  3. `retention_Dn = utenti_cohort_attivi_al_giorno_target / |cohort|`.

Esempio (passo 2, per-utente, giorno target D7):
```
Query reading-intelligence-analytics-<env>
  IndexName: UserEventsIndex
  KeyConditionExpression: userId = :u AND #ts BETWEEN :dayStart AND :dayEnd
  ExpressionAttributeNames:  { "#ts": "timestamp" }
  ExpressionAttributeValues:
    :u        = "<userId>"
    :dayStart = 1754611200000   # 00:00:00.000 del giorno D7 (epoch ms)
    :dayEnd   = 1754697599999   # 23:59:59.999 del giorno D7 (epoch ms)
Select: COUNT   # COUNT >= 1 → utente trattenuto a D7
```
Nota: la cohort richiede definire "activation". Se `install` non è tracciato (§1.1),
la retention è calcolata rispetto al **primo riassunto** (activation-based), non
rispetto all'install.

### 1.6 Cache hit rate

- **Definizione**: quota di richieste servite dalla cache dei riassunti rispetto al
  totale richieste. `cache_hit_rate = cache_hits / (cache_hits + cache_misses)`.
- **Gap**: questa tabella **non** registra hit/miss di cache. Il flag di cache vive in
  `backend/src/cache.mjs` (`cache_version`, campo `CACHE_VERSION = "summary-v3"`) e nella
  tabella `reading-intelligence-summary-cache-<env>`. Non c'è oggi un `cache_hit` boolean
  sull'evento analytics.
- **Proxy debole calcolabile oggi (A)**: `duration_ms` basso + `chars_output > 0` è
  correlato a un hit, ma **non affidabile**. Da non usare per KPI.
- **Raccomandazione**: aggiungere `cache_hit` (bool) all'evento analytics (in
  `buildAnalyticsEvent`) — modifica al backend, fuori scope di questo scaffold. Dopo la
  modifica:
```
Scan reading-intelligence-analytics-<env>
  FilterExpression: brand_id = :b AND date_partition BETWEEN :from AND :to
  ProjectionExpression: cache_hit
  # rate = count(cache_hit = true) / count(*)
```

### 1.7 Costo / token per brand

- **Definizione**: costo OpenAI stimato e token consumati per brand nella finestra.
- **Gap**: la tabella **non** registra i token effettivi (`prompt_tokens`,
  `completion_tokens`) restituiti dall'API OpenAI. Sono disponibili `chars_input` e
  `chars_output`.
- **Stima calcolabile oggi (A)**: approssimazione token da caratteri
  (`tokens ≈ chars / 4` per testo latino; costante da tarare per lingua). Costo =
  `token_input * prezzo_input + token_output * prezzo_output` con i prezzi del modello
  configurato (`OPENAI_MODEL`, default `gpt-5-nano` in `backend/src/cache.mjs`). I prezzi
  vanno mantenuti in una tabella di configurazione della dashboard, **non** hardcoded.
- **Raccomandazione**: aggiungere `tokens_input` / `tokens_output` all'evento (dai campi
  `usage` della risposta OpenAI) per costo esatto — modifica backend, fuori scope.

Esempio (A) — somma caratteri per stima:
```
Scan reading-intelligence-analytics-<env>
  FilterExpression: brand_id = :b AND date_partition BETWEEN :from AND :to AND success = :ok
  ProjectionExpression: chars_input, chars_output
  ExpressionAttributeValues: { ":b": "signal", ":from": "2026-08-01", ":to": "2026-08-31", ":ok": true }
# token_in  ≈ sum(chars_input)  / 4
# token_out ≈ sum(chars_output) / 4
# cost = token_in/1e6 * price_in_per_Mtok + token_out/1e6 * price_out_per_Mtok
```

---

## 2. Funnel

`install → open → analysis_completed → login → paid`

| Step | Evento sorgente | Stato oggi |
|---|---|---|
| install | `event_type="install"` | **non tracciato** (§5) — fallback store stats |
| open | `event_type="open"` (apertura popup) | **non tracciato** (§5) |
| analysis_completed | evento di riassunto con `success=true` | **tracciato** (`logSummaryEvent`) |
| login | `event_type="login"` (auth completata) | **non tracciato** (§5) |
| paid | `event_type="paid"` / webhook Stripe | **non tracciato** in questa tabella (§5) |

### 2.1 Calcolo funnel (con instrumentazione completa, B)

Per ogni step, count di **utenti distinti** con almeno un evento di quel tipo nella
finestra, per brand:
```
Query reading-intelligence-analytics-<env>
  IndexName: BrandEventTypeIndex
  KeyConditionExpression: brand_id = :b AND begins_with(event_type_date, :prefix)
  ExpressionAttributeValues: { ":b": "lemonsqueezer", ":prefix": "analysis_completed#2026-08" }
  # dedup su userId lato applicazione
```
Conversion tra step: `rate(step_i → step_{i+1}) = distinct_users(step_{i+1}) /
distinct_users(step_i)`. Nota: il funnel corretto vincola gli utenti dello step i+1 a
essere un sottoinsieme di quelli dello step i (stesso `userId`, timestamp successivo);
la formula sopra è l'approssimazione "step-to-step" senza vincolo di sequenza. Per il
funnel sequenziale, intersecare gli insiemi di `userId` per step.

### 2.2 Calcolo funnel oggi (A, parziale)

Solo lo step `analysis_completed` è calcolabile dalla tabella:
```
Scan reading-intelligence-analytics-<env>
  FilterExpression: brand_id = :b AND success = :ok AND date_partition BETWEEN :from AND :to
  ProjectionExpression: userId
# distinct(userId) = utenti che hanno completato ≥1 analisi
```
`install`/`open`/`login` da fonti esterne o non disponibili; `paid` via Stripe.

---

## 3. Wireframe ASCII — Dashboard per brand

```
+===========================================================================+
|  [<brand> wordmark]   Reading Intelligence — Analytics        env: prod   |
|  Brand: [ LemonSqueezer v ]   Periodo: [ 2026-08-01 -> 2026-08-31 ]  [Go] |
+===========================================================================+
|                                                                           |
|  +-----------+  +-----------+  +-----------+  +-----------+  +-----------+ |
|  | INSTALL   |  | ACTIVATION|  | DAILY SUM |  | CONV f->p |  | CACHE HIT | |
|  |  12,480   |  |   8,120   |  |   1,932   |  |   4.7 %   |  |  61.3 %   | |
|  |  +6.2% w  |  | 65.1% rate|  |  avg/day  |  |  +0.4pt   |  | (proxy*)  | |
|  +-----------+  +-----------+  +-----------+  +-----------+  +-----------+ |
|                                                                           |
|  RETENTION                         FUNNEL (utenti distinti, mese)         |
|  +-----------------------------+   +-----------------------------------+  |
|  | D1  ####################  42%|   | install          ############ 12480| |
|  | D7  ###########       23%    |   | open             ##########    9310| |
|  | D30 #####             11%    |   | analysis_compl.  ########      8120| |
|  +-----------------------------+   | login            #####         3970| |
|                                    | paid             #             590 | |
|  DAILY SUMMARIES (serie temporale) +-----------------------------------+  |
|  +---------------------------------------------------------------------+  |
|  | 2.0k |                                    .*.                       |  |
|  | 1.5k |                     .*.    .*.  .*'   '*.   .*.               |  |
|  | 1.0k |        .*.   .*'  .'   '*.'   '*'        '*'   '*.            |  |
|  | 0.5k |  .*.'     '*'                                     '*.        |  |
|  |      +--------------------------------------------------------------|  |
|  |       01   05   09   13   17   21   25   29                         |  |
|  +---------------------------------------------------------------------+  |
|                                                                           |
|  COST / TOKEN (stima*)              TOP DOMAINS                           |
|  +-----------------------------+   +-----------------------------------+  |
|  | tokens_in   ~ 41.2 M        |   | youtube.com          ####### 31%  |  |
|  | tokens_out  ~  6.8 M        |   | medium.com           ####    18%  |  |
|  | cost (est.) ~ $184.50       |   | nytimes.com          ###     12%  |  |
|  | model: gpt-5-nano           |   | (altro)              ####    39%  |  |
|  +-----------------------------+   +-----------------------------------+  |
|                                                                           |
|  * proxy/stima: metrica derivata da dati incompleti (vedi dashboard-spec) |
+===========================================================================+
```

---

## 4. Note di implementazione

- **Paginazione Scan/Query**: gestire sempre `LastEvaluatedKey`; i `Scan` su tabella
  completa vanno paginati e idealmente eseguiti in batch notturni con materializzazione
  dei risultati (tabella di rollup giornaliero) per evitare costi ripetuti.
- **Materializzazione consigliata**: job schedulato (EventBridge → Lambda) che ogni notte
  produce un record di rollup per `(brand_id, date_partition)` con i contatori
  aggregati, così la dashboard legge rollup (`Query`) invece di `Scan` sul raw.
- **Dedup utenti**: eseguito lato applicazione dopo la query (Set di `userId`), perché
  DynamoDB non fa `COUNT DISTINCT`.
- **Timezone**: `date_partition` è generato server-side (vedi `getDatePartition` in
  `backend/src/analytics.mjs`); confermare la timezone di generazione prima di
  confrontare con finestre locali del brand.

## 5. Instrumentazione mancante (riepilogo azioni backend, fuori scope scaffold)

Per abilitare tutte le metriche/funnel, il backend dovrebbe (modifiche a `backend/**`,
NON incluse in questo scaffold):

1. Aggiungere `event_type` a ogni evento; scrivere eventi `install`, `open`, `login`,
   `paid` oltre a `analysis_completed`.
2. Aggiungere `cache_hit` (bool) in `buildAnalyticsEvent` popolato dall'esito cache.
3. Aggiungere `tokens_input` / `tokens_output` dai dati `usage` di OpenAI.
4. Far scrivere allo Stripe webhook handler un evento `paid` (o una tabella
   subscription) correlabile a `userId`.
5. Aggiungere le GSI `BrandDateIndex` / `BrandEventTypeIndex` (§0.2) per eliminare gli
   `Scan`.
