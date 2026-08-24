# Backlog Progress Tracker

Fonte: `Document_14B_Engineering_Task_Backlog_v1.0` (192 task, E01-E18) + `Document_14_Sprint_Backlog_v1.0`.
Regola hard-gate: **LemonSqueezer regression-zero** su ogni package.

Legenda: ✅ done · 🟡 partial · ⬜ todo

Aggiornato: 2026-08-24 · Ultimo commit rilevante: CP1 backend scaffold + completamento Wave 1 (E02-E06 core).

## Wave 1 — Multi-brand backend scaffold (E01-E06)

### E01 — Architecture Baseline & Safety Net
- 🟡 E01-002 test suite backend verde (41/41)
- 🟡 E01-003 smoke estensione Lemon (verificato manualmente in sessione)
- ⬜ E01-001 tag baseline · E01-004 inventario env/SSM · E01-005 version constant · E01-006 requestId middleware · E01-007 structured logger · E01-008 fixtures pagine · E01-009 legacy user fixture · E01-010 compat harness

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
- ✅ E05-001 free limit nel registry · E05-002 reset mensile lazy per-brand · E05-003 usage response per-brand · E05-006 errore USAGE_LIMIT_EXCEEDED
- ⬜ E05-004 rate-limit key brand-aware (solo path legacy /summarize; l'estensione usa la quota) · E05-005 policy anonimi · E05-007/008 test dedicati

### E06 — Brand-aware Cache & Analytics  → ✅ core
- ✅ E06-001 brandId in cache input · E06-002 promptProfile in key · E06-003 outputSchema/version in key · E06-004 test stessa URL brand diversi · E06-005 brandId negli eventi analytics
- ⬜ E06-006 campi browser/client version · E06-007 audit leakage contenuto grezzo · E06-008 analytics schema tests

## Wave 2 — Prompt/output + commercial isolation (E07-E08) → ⬜
- E07 Prompt Profiles & Output Schemas (Lemon estratto, Scout/Signal/NoBull/Briefly + parser)
- E08 Payments & Commercial Isolation (Stripe per-brand, webhook brand-aware, idempotenza)
Nota: `updateUserPlan` è già brand-aware; i webhook usano ancora `lemonsqueezer` (stopgap) → E08-006/007/008 da fare.

## Wave 3 — One extension codebase, five builds (E09-E10) → ⬜
- E09 refactor `extension/src` + brand-config + X-Brand nelle fetch
- E10 build/packaging (`build-brand.mjs`, `package-brand.mjs`), rigenerare Lemon dal pipeline

## Wave 4 — Cross-browser, contracts, telemetry, security (E11-E14) → ⬜
## Wave 5 — Test hardening & deployment automation (E15-E16) → ⬜
## Wave 6 — Assets & first multi-brand launch (E17-E18) → ⬜

## Milestones (Doc 14)
- 🟡 M1 Backend multi-brand complete — scaffold fatto; restano E07/E08 (prompt/schema + billing per-brand)
- ⬜ M2 Extension multi-brand · M3 First non-Lemon live (Scout) · M4 Five stores · M5 First paying customer · M6 Public launch

## Prossimo passo consigliato
CP2 = **E09-E10** (extension scaffold + build pipeline) oppure E07 (prompt/schema, sblocca il primo brand Scout). Scelta utente: primo brand = **Scout** (forza uno schema output diverso da Lemon).
