# Backlog Progress Tracker

Fonte: `Document_14B_Engineering_Task_Backlog_v1.0` (192 task, E01-E18) + `Document_14_Sprint_Backlog_v1.0`.
Riferimenti di design adottati: Doc 1-20. **17 Brand Packs** + **18 Figma Design System** vincolano `brand.json` (design token: colors/spacing/radius/typography/elevation, asset SVG→PNG). **19 Testing Bible** guida la copertura (unit/integration/contract/e2e/visual + regression Lemon + cross-brand isolation). **15 Launch / 16 Operations / 20 Scaling** = fase E18+ (launch/ops/scaling).
Regola hard-gate: **LemonSqueezer regression-zero** su ogni package.

Legenda: ✅ done · 🟡 partial · ⬜ todo

Aggiornato: 2026-08-24 · Ultimo commit rilevante: CP1 backend scaffold + completamento Wave 1 (E02-E06 core).

## Wave 1 — Multi-brand backend scaffold (E01-E06)

### E01 — Architecture Baseline & Safety Net
- ✅ E01-002 test suite backend verde (71/71) · E01-005 version constant (`src/config.mjs` + health espone architectureVersion/apiVersion/environment/brands) · E01-009/010 legacy user compat test (shim provato, `test/wave1-residuals.test.mjs`)
- 🟡 E01-003 smoke estensione Lemon (manuale)
- ⬜ E01-001 tag baseline · E01-004 inventario env/SSM · E01-006 requestId middleware (parziale: health versionato) · E01-007 structured logger · E01-008 fixtures pagine

### E02 — Brand Registry & Request Context  → ✅ core
- ✅ E02-001 `src/brands.mjs` · E02-003 getBrand · E02-004 isValidBrand · E02-005 listBrands
- ✅ E02-006 resolveBrand (X-Brand > body.brand > lemonsqueezer) · E02-007 invalid → 400 INVALID_BRAND · E02-008 brand nel context
- ✅ E02-010 test precedenza/validità (brands.test.mjs)
- ⬜ E02-002 schema validation config · E02-009 brand in health diagnostics

### E03 — Shared Identity / Per-brand Entitlements  → ✅ core
- ✅ E03-001 shape entitlement · E03-002 no plan globale in auth · E03-003 canUserSummarize(user,brand) · E03-004 incrementUsage(user,brand)
- ✅ E03-005 ensureEntitlement (dynamodb) · E03-008 no plan nel JWT · E03-009 verify legge stato fresco · E03-010 reset date helper · E03-012 test quota indipendente
- 🟡 E03-006/007 brand al login (ora default lemonsqueezer; init lazy per altri brand al primo uso)
- ⬜ E03-011 shared-login integration test (richiede mock DynamoDB)

### E04 — DynamoDB Multi-brand Persistence  → ✅ core
- ✅ E04-001 createUser con brand · E04-002 sintesi legacy (shim) · E04-003 shim read-only · E04-004 incrementBrandUsage · E04-006 updateUserPlan(userId,brand,plan) · E04-009 formatUser entitlements
- 🟡 E04-005 reset per-brand (integrato in increment; manca funzione standalone) · E04-007 updateSubscriptionState (via `updateUserPlan` extra) · E04-008 init concorrente (if_not_exists)
- ⬜ E04-010 unit test DynamoDB entitlements (mock)

### E05 — Quota, Usage & Rate Limits  → ✅ core (path estensione)
- ✅ E05-001 free limit nel registry · E05-002 reset mensile lazy per-brand · E05-003 usage response per-brand · E05-006 errore USAGE_LIMIT_EXCEEDED · E05-004 rate-limit key brand-aware (`createRateLimitKey(apiKey,window,brand)` + test)
- ⬜ E05-005 policy anonimi

### E06 — Brand-aware Cache & Analytics  → ✅ core
- ✅ E06-001 brandId in cache input · E06-002 promptProfile in key · E06-003 outputSchema/version in key · E06-004 test stessa URL brand diversi · E06-005 brandId negli eventi analytics · E06-006 campi browser/client_version · E06-007 audit anti-leak (buildAnalyticsEvent: solo metadati, mai contenuto grezzo) · E06-008 analytics schema test (`test/wave1-residuals.test.mjs`)

> ✅ **Risolto in E13**: l'I/O analytics era disallineato con lo schema tabella (scriveva `id`/`user_id`/`timestamp`-ISO; tabella: PK `eventId`, GSI `userId`+`timestamp`-N, `UserEventsIndex`) → PutItem falliva e le query non tornavano dati. Corretto: vedi sezione E13.

## Wave 2 — Prompt/output + commercial isolation (E07-E08)

### E07 — Prompt Profiles & Output Schemas  → 🟡 core (Lemon + Scout)
- ✅ E07-001 prompt Lemon estratto (`src/prompts/summary.standard.mjs`) · E07-002 registry (`src/prompts/index.mjs`)
- ✅ E07-003 schema summary (`src/schemas/summary.mjs`) · E07-004 coerceBullets→parser summary (re-export compat) · E07-005 interfaccia parser (`src/schemas/index.mjs`)
- ✅ E07-006 prompt Scout (`scout.evaluate`) · E07-007 schema/parser Scout (`attention`, con responseFormat + clamp/enum/reasons)
- ✅ E07-014 `summarizeWithOpenAI` instrada profilo/schema da brand config (no if/else brand) · E07-015 retry su output non valido
- ✅ E07-008/009 Signal (`signal.insights` + schema `insights`) · E07-010/011 NoBull (`nobull.noise` + `noise`) · E07-012/013 Briefly (`briefly.brief` + `brief`) — parser difensivi + responseFormat strict
- ✅ E07-016 golden/adversarial tests per tutti i profili (`test/prompts-schemas.test.mjs`, `test/brand-schemas.test.mjs`). 91/91 verdi
- ✅ Renderer estensione (`updateModalWithBrandOutput`) generico: copre **attention/insights/noise/brief** via view-model per schema + DOM sicuro (textContent). Tutti e 5 i brand rendono end-to-end (Lemon summary + 4 schemi strutturati)
- Handler: gestisce shape generico `output` (Scout → 200 envelope), cache gata a schema summary. 55/55 test verdi.

### E08 — Payments & Commercial Isolation  → ✅ core (codice)
- ✅ E08-001 price key per brand in `brands.mjs` · E08-003 `createCheckoutSession(userId,email,brand,planType)` seleziona i price del brand
- ✅ E08-004/005 `metadata.brand` su Checkout Session e Subscription · E08-006/007/008 webhook (`resolveStripeBrand`) aggiornano l'entitlement del **brand corretto** (checkout/updated/deleted); downgrade free solo per quel brand
- ✅ E08-010 idempotenza (SET/PUT naturalmente idempotenti) · E08-012 checkout con brand non valido → errore (test) · E09-012 `X-Brand` su create-checkout (estensione)
- ✅ handler `/payments/create-checkout` risolve X-Brand → brand del checkout · validazione planType up-front
- Test: `test/payments-brand.test.mjs` (brand resolution, cross-brand, invalid brand). 64/64 verdi.
- ⬜ E08-009 policy stripe_customer per-brand vs globale (ora per-brand nell'entitlement) · **E18-005** creare prodotti/prezzi Stripe Scout + parametri SSM `stripe-scout-*` (task di lancio; il codice è brand-ready)

## Wave 3 — One extension codebase, five builds (E09-E10) → ✅ core (Lemon + Scout)
- ✅ E09-002 `brands/<brand>/brand.json` con **design token** (Doc 17/18): `lemonsqueezer` + `scout` · E09-003 asset convention (icon.svg+16/48/128; Scout icone generate)
- ✅ E09-004 `brand-config.js` generato (`globalThis.__BRAND__`) consumato da popup/content/SW
- ✅ E09-005..008 rimossi gli hardcode: nome/tagline/wordmark/colori (CSS var da token) e logo (icon-48) brand-driven
- ✅ E09-009/010 `X-Brand` su summarize (SW) · E09-012 X-Brand su billing · E09-013/014 renderer brand-specifico generico (attention/insights/noise/brief)
- ✅ validator `scripts/validate-brands.mjs`
- ✅ E10-001 `build-brand.mjs` (dist/<brand> deterministico + integrity) · E10-004 `package-brand.mjs` (zip) · E10-006 integrity check · E10-008 Lemon dal pipeline con **parità verificata** · E10-009 build Scout
- 🟡 E09-001 sorgente resta in `extension/` (non spostata in `extension/src`: scelta per non rompere il dev unpacked; build copia da `extension/`) · E09-011/012 X-Brand su auth/billing (SW summarize fatto; auth/billing da completare in E08)
- Test: `test/build-brand.test.mjs` (integrity, branding Scout, **parità Lemon**, icone distinte). 59/59 verdi.
- Deviazione tracciata: no `extension/src` move (E09-001) per zero-regression sul dev unpacked.

## Wave 4 — Cross-browser, contracts, telemetry, security (E11-E14) → 🟡 avviato
### E13 — Analytics, Funnels & Cost Telemetry
- ✅ Fix persistenza: `buildAnalyticsEvent` scrive `eventId`/`userId`/`timestamp`(N)+`created_at`(ISO); `success` booleano reale. Query allineate: `getUserStats` → `UserEventsIndex` + `userId` + epoch; `getGlobalStats`/`getTrendingDomains` → `userId`, proiezioni/alias corretti; `getDailyBreakdown` usa `created_at`. Test `test/analytics-schema.test.mjs`. 75/75 verdi.
- ✅ E13-002/003 brand tag su eventi + latenza (`duration_ms` + `brand_id`) · campi client (browser/client_version)
- ⬜ E13-005 costo/token per brand · E13-006/007 funnel/retention dashboard (richiede storage query + UI)
### E12 — API Contracts & Error Model  → ✅ core
- ✅ E12-001 brand via header X-Brand (fallback body) · E12-002 `brand` nei metadata di risposta
- ✅ E12-003 `src/errors.mjs` catalogo centralizzato (codici stabili + status) · E12-004 USAGE_LIMIT_EXCEEDED arricchito (brand/plan/resetDate) · E12-005 OUTPUT_SCHEMA_ERROR/PAYMENT_BRAND_MISMATCH definiti
- ✅ `request_id` in ogni envelope di risposta (set da `requestContext.requestId`) — copre anche E01-006 (correlazione)
- ✅ E12-008 contract test (`test/errors-contract.test.mjs`: codici/status stabili). 80/80 verdi.
- ⬜ E12-007 OpenAPI examples (doc)

### E11 / E14 → ⬜ (cross-browser, security hardening)
## Wave 5 — Test hardening & deployment automation (E15-E16) → ⬜
## Wave 6 — Assets & first multi-brand launch (E17-E18) → ⬜

## Milestones (Doc 14)
- ✅ M1 Backend multi-brand complete — E02-E08 core fatti (registry, entitlement per-brand, quota, cache/analytics, prompt/schema, billing per-brand). Restano sotto-task minori + config di lancio (SSM Scout).
- ⬜ M2 Extension multi-brand · M3 First non-Lemon live (Scout) · M4 Five stores · M5 First paying customer · M6 Public launch

## Prossimo passo consigliato
CP2 = **E09-E10** (extension scaffold + build pipeline) oppure E07 (prompt/schema, sblocca il primo brand Scout). Scelta utente: primo brand = **Scout** (forza uno schema output diverso da Lemon).
