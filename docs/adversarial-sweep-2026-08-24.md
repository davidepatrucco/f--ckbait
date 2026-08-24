# Adversarial sweep — 2026-08-24

Verifica completa dello stato multi-brand dopo gli item A (solo-codice) e D (scaffolding). Numeri reali, non stimati.

## Statico / build
- `node --check` su tutti i file backend/estensione/scripts: OK.
- `scripts/validate-brands.mjs`: **5 brand, 0 errori**, 4 warning (URL privacy/terms placeholder per i brand non-Lemon — atteso).
- Build **5 brand × {chromium, firefox} = 10 pacchetti**: tutti OK + integrity check.
- `scripts/scan-secrets.mjs` su `dist/`: **nessun segreto** (client id Google pubblico non flaggato).
- **Parità LemonSqueezer**: `dist/lemonsqueezer/{popup.html,popup.js,service_worker.js,content.js,browser-polyfill.js}` byte-identici a `extension/` → regression-zero.
- Manifest Firefox per tutti e 5: `background.scripts` + `browser_specific_settings.gecko.id`, nessun `service_worker` (event page). Chromium: `service_worker` mantenuto.

## Grep avversariali
- **Nessun `if (brand === '<altro>')` nel core** (openai/handler): routing 100% config-driven. ✓
- **Nessun leak** di contenuto grezzo / token nei `console.*`. ✓
- Chiavi analytics allineate allo schema tabella (`eventId`/`userId`/`timestamp`-N). ✓

## Test
- Suite backend: **103/103 verdi** (38 suite). Include token-cost, account-delete, brand-schemas, security, build-brand, payments-brand, analytics-schema, errors-contract, ecc.

## E2E LIVE (backend `dev` deployato + DynamoDB reale)
Eseguito con JWT di test + utente temporaneo, poi cleanup. 10/10 assert:
- `GET /health`: `request_id` + 5 brand + versioni.
- **Scout** `/summarize-url` (X-Brand: scout, testo client): HTTP 200, `brand=scout`, `schema=attention`, `output` reale (`attention_score`, `recommendation`, `novelty/importance/credibility`, `reasons`), `request_id`.
- **Isolamento quota LIVE**: `entitlements.scout.usage_used=1`, `lemonsqueezer` intatto.
- `X-Brand: bogus` → **400 `INVALID_BRAND`**.
- `POST /account/delete` → **200 `deleted:true`** + utente effettivamente rimosso dal DB (E14-008 verificato live).

## Gap noti (onestà)
- `MODEL_COSTS` vuota in `openai.mjs` → `cost_estimate = 0` (i conteggi token sono reali dall'API). Da popolare con i prezzi reali del modello quando disponibili — non inventati.
- Analytics: manca un campo `event_type`; il funnel install→open→login→paid richiede strumentazione backend (vedi `docs/dashboard-spec.md`). `cache_hit` non ancora registrato per-evento.
- URL privacy/terms placeholder per i brand non-Lemon.
- QA runtime Firefox/Edge/Safari: **non eseguita** (browser assenti in questo ambiente); Chrome è l'unico target verificato a runtime, oltre all'e2e API sopra.

## Merge
- Branch D `worktree-agent-…` mergiato in `main` (no-ff): `docs/dashboard-spec.md`, `apps/website/*`, `docs/runbooks/*`. Nessun conflitto.
