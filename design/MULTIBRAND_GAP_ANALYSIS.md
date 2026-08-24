# Multi-brand Gap Analysis (architettura attuale invariata)

Data: 2026-08-24

## Decisioni registrate
- **Multi-brand: validato.** 5 brand: LemonSqueezer, Signal, Briefly, Scout, NoBull.
- **Architettura backend: resta quella attuale** — Node.js ESM su AWS Lambda (SAM), API Gateway REST, DynamoDB, SSM Parameter Store, OpenAI. Nessun FastAPI/Postgres/Redis/Celery.
- **Quota: per-brand** (conteggio separato per brand).
- **Subscription/Stripe: per-brand** (prodotti e vita commerciale separati).
- **Identità: RISOLTA — login condiviso.** Regola vincolante: **"Shared identity, independent commercial lifecycle per brand."** Un solo account (stesso login/email) valido su tutti i brand; **nessun account separato per brand**. L'**entitlement è sempre la coppia `(user_id, brand_id)`**, con per ogni brand valori separati: `plan`, `usage`, `usage_limit`, `subscription_status`, `stripe_customer_id`, `stripe_subscription_id`.
- **Regole fissate:** stesso login/email · `X-Brand` su ogni richiesta · quota separata · subscription Stripe separata · prezzo separato · webhook Stripe brand-aware · history e analytics brand-tagged · nessun `plan` globale nel JWT.
- **Nota architetturale:** `entitlements[brand]` dentro il record utente è un'**ottimizzazione pragmatica per DynamoDB/MVP**, non il modello dati definitivo. Con crescita o migrazione a storage relazionale, questi dati vanno **normalizzati** in entità separate (`subscriptions`, `usage`, `plans`) con chiave `(user_id, brand_id)`.

## Principio guida
Il brand seleziona **configurazione** (prompt, schema output, tema, prezzi, feature flag). Nessun `if (brand === ...)` nella logica di business: il brand entra via config/strategia tipizzata.

---

## BACKEND — modifiche file per file

### `lambda/handler.mjs`  — [M]
- `summarizeUrlHandler`: leggere `X-Brand` (header, fallback body, default `lemonsqueezer`); validare contro `brands.mjs`.
- Passare `brand` a: `canUserSummarize(user, brand)`, `incrementUsage(user, brand)`, `summarizeWithOpenAI({..., brand})`, `logSummaryEvent({..., brandId})`, `cacheInput.brandId`.
- `summarizeHandler` (endpoint `/summarize` legacy con x-api-key): stesso trattamento o deprecarlo.
- Payments handlers: propagare `brand` (vedi sotto).

### `src/brands.mjs`  — [S] (NUOVO)
Registry di configurazione server:
```
{ lemonsqueezer: { id, promptProfile:'summary.standard', outputSchema:'summary',
                   defaultMode:'standard', freeLimit:10,
                   stripe:{ monthlyPriceKey:'stripe-lemon-premium-monthly-price-id', ... } },
  scout: {...}, signal:{...}, nobull:{...}, briefly:{...} }
```
Funzioni: `getBrand(id)`, `isValidBrand(id)`, `listBrands()`.

### `src/auth.mjs`  — [M]
- `canUserSummarize(user, brand)`: leggere `user.entitlements[brand]` invece di `user.plan`/`user.usage` piatti. Se manca l'entitlement → inizializzarlo (free, limit dal brand).
- `incrementUsage(user, brand)`: `incrementUserUsage(user.id, brand)`.
- Login (`loginWithGoogle`/`loginWithEmail`/`registerWithEmail`): l'utente non nasce più con `plan`/`usage` piatti globali ma con `entitlements` (almeno per il brand corrente al primo accesso). L'oggetto `brand` va passato ai flussi di login (il client invia `X-Brand`).
- JWT: **rimuovere `plan`** dal payload (varia per brand e cambia nel tempo); il piano si legge sempre dal record fresco (già fatto in `verifyAuthToken`).
- Reset mensile: per-brand (`resetUserUsage(userId, brand, date)`); valutare reset lazy per il solo brand richiesto.

### `src/dynamodb.mjs`  — [M]
Passare da attributi piatti (`plan`, `usage_used`, `usage_limit`, `usage_reset_date`) a mappa `entitlements`:
```
entitlements: { lemonsqueezer: { plan, usage_used, usage_limit, usage_reset_date,
                                 stripe_customer_id, subscription_status }, ... }
```
- `createUser`: inizializza `entitlements[brand]`.
- `incrementUserUsage(userId, brand)`: `ADD entitlements.#b.usage_used :1` (ExpressionAttributeNames per il brand).
- `resetUserUsage(userId, brand, date)`: `SET entitlements.#b.usage_used = 0, entitlements.#b.usage_reset_date = :d`.
- `updateUserPlan(userId, brand, plan)`: `SET entitlements.#b.plan = :p`.
- `formatUserFromDynamoDB`: ritorna `{ id, email, name, picture, entitlements }`. **Shim retro-compat**: se `entitlements` manca ma esistono i vecchi attributi piatti, sintetizza `entitlements.lemonsqueezer` da essi (evita migrazione dati one-shot).

### `src/openai.mjs`  — [L] (lavoro ricorrente per brand)
- `summarizeWithOpenAI(content)`: `content.brand` seleziona **prompt** e **schema output**.
- Estrarre i prompt in profili versionati (`src/prompts/<profile>.mjs` o `.md`): `summary.standard` (attuale LemonSqueezer), `scout.evaluate`, `signal.insights`, `nobull.noise`, `briefly.brief`.
- `coerceBullets` diventa lo **schema parser di LemonSqueezer**; ogni brand ha il suo `coerce<Brand>Output(response)` + `response_format` json_schema.
- `buildSummaryPlan`: già gestisce squeeze/video; ok, il target parole resta per il task "summary".

### `src/payments.mjs`  — [M]
- `createCheckoutSession(userId, email, brand, planType)`: price IDs **per brand** da `brands.mjs`/SSM; `metadata.brand` nella sessione e nella subscription.
- Webhook (`handleCheckoutCompleted`/eventi): leggere `metadata.brand` → `updateUserPlan(userId, brand, 'premium')`; `saveSubscription` con `brand`.
- Cancellazione/scadenza subscription: `updateUserPlan(userId, brand, 'free')`.

### `src/cache.mjs`  — [S]
- `buildSummaryCacheKey`: aggiungere `brandId`/`promptProfile` (già hashi model/profile/squeeze/extras). Sintesi di brand diversi non collidono.

### `src/analytics.mjs`  — [S]
- `logSummaryEvent`: aggiungere `brandId`; tabella analytics già `JSONB metadata`-like → nessun cambio schema. (Nota: verificare che NON logghi contenuto grezzo.)

### `src/rate-limit.mjs`  — [S]
- Chiave rate-limit: includere brand se si vogliono limiti separati per brand (altrimenti condivisa per utente).

### `infra/sam-template-simple.yaml` + SSM  — [S]
- Nuovi parametri SSM per-brand: `stripe-<brand>-premium-monthly-price-id`, `-yearly-`, ecc.
- `ALLOWED_ORIGINS`: includere gli ID delle estensioni di tutti i brand pubblicati.
- Nessuna nuova tabella (users/analytics/cache/subscriptions/payments/rate-limit restano).

### Test backend  — [M]
- `brands.mjs` (validazione), entitlement per-brand (canSummarize/increment/reset), cache key per-brand, un `coerce<Brand>Output` per ogni schema.

---

## ESTENSIONE — una codebase → N build

Stato attuale: LemonSqueezer hardcoded (nome, colori, tagline, logo in `popup.html`/`popup.js`/`content.js`; icone in `assets/`).

### Refactor a config  — [M]
- `extension/src/` = sorgente condiviso (sposta gli attuali file).
- `brands/<brand>/brand.json`: `{ id, apiBrand, displayName, tagline, theme:{yellow,black,...}, defaultMode, promptProfile }`.
- `brands/<brand>/assets/`: `icon-16/48/128.png`, `icon.svg`.
- Generare `brand-config.js` iniettato nel bundle; `popup.html`/`content.js` leggono i token (CSS var già presenti per LemonSqueezer → parametrizzare `--ls-*`, nome, tagline, logo).
- Service worker + content: inviare header `X-Brand` in tutte le fetch al backend (`summarizePageData`, `summarizeUrlDirectly`).

### Build pipeline  — [M] (NUOVO)
- `scripts/build-brand.mjs <brand>`: copia `src` → `dist/<brand>/`, sostituisce `manifest.json` (name/description/default_title/icone), inietta `brand-config.js`, copia assets del brand.
- `scripts/package-brand.mjs`: zip `dist/<brand>/` → `{brand}-chrome-{version}.zip`.
- Niente webpack: copia + template substitution. (Un bundler serve solo se si vuole tree-shaking; non necessario ora.)

### Store per brand  — [M ricorrente]
- Listing, privacy URL, screenshot, icone per ciascun brand (riusare `store-assets/` come template).

---

## Lavoro ricorrente per OGNI nuovo brand
1. Prompt profile + output schema + `coerce<Brand>Output` (backend).
2. `brand.json` + tema + icone + `brand-config` (estensione).
3. Prodotti/prezzi Stripe + parametri SSM.
4. Build + listing store + assets + privacy/terms (riuso template legale S3).
Questo è il costo dominante: non l'infrastruttura, ma **prompt+schema+listing per brand**.

---

## Stima effort (indicativa)
| Blocco | Effort |
|---|---|
| `brands.mjs` + `X-Brand` nel handler | S |
| Entitlement per-brand (auth + dynamodb + shim retro-compat) | M |
| Payments per-brand (checkout+webhook+SSM) | M |
| Cache/analytics/rate-limit brand-tagged | S |
| Astrazione prompt + schema LemonSqueezer rifattorizzato | M |
| Estensione: refactor a brand-config | M |
| Build pipeline `build-brand`/`package-brand` | M |
| **Scaffold multi-brand totale (LemonSqueezer come riferimento)** | **~1 settimana** |
| Ogni brand nuovo end-to-end (prompt+schema+tema+listing) | M ciascuno |

## Sequenza consigliata
1. Scaffold backend: `brands.mjs`, `X-Brand`, entitlement per-brand + shim, cache/analytics brand-tagged. LemonSqueezer resta funzionante (regressione zero).
2. Scaffold estensione: brand-config + `build-brand` + `X-Brand`. Rigenera LemonSqueezer dal nuovo pipeline (deve risultare identico).
3. Payments per-brand.
4. Primo brand nuovo end-to-end come template ripetibile.

## Rischi / note
- **Migrazione dati**: gestita dal shim in `formatUserFromDynamoDB` (nessun job one-shot); i vecchi utenti LemonSqueezer continuano a funzionare.
- **JWT**: rimuovere `plan` dal token evita stati stantii per-brand.
- **`/summarize` legacy (x-api-key)**: decidere se deprecarlo o renderlo brand-aware.
- **Store**: fino a 5 listing Chrome separati; ognuno con il proprio ID → `ALLOWED_ORIGINS` e redirect OAuth per ogni brand.
- **Identità**: RISOLTA — login condiviso + entitlement `(user_id, brand_id)`; nessun account separato per brand.
