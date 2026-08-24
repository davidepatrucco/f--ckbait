# Stato implementazione vs specifiche — report per Product Manager

Data: 2026-08-24 · Branch `main` · commit `1a1eae6`
Sorgente specifiche: `design/Document_14B_Engineering_Task_Backlog_v1.0` (192 task atomici, epiche E01-E18, 6 wave) + Doc 1-20.
Backend live (dev): `https://4jo5gamel9.execute-api.eu-west-1.amazonaws.com/dev` — `architectureVersion: multibrand-1`, 5 brand.
Regola bloccante rispettata: **LemonSqueezer regression-zero** (parità build byte-identica) + **"Shared identity, independent commercial lifecycle per brand"**.

Legenda: ✅ completo · 🟡 parziale · ⬜ non iniziato

---

## 1. Sintesi per wave

| Wave | Epiche | Ambito | Stato | Note |
|------|--------|--------|-------|------|
| 1 | E01-E06 | Backend multi-brand scaffold | ✅ core | residui minori (test con mock, logger, fixtures) |
| 2 | E07-E08 | Prompt/output + isolamento commerciale | ✅ core | 5 brand con schema output dedicato; billing brand-aware |
| 3 | E09-E10 | Estensione one-codebase → 5 build | ✅ core | Chromium+Firefox; parità Lemon verificata |
| 4 | E11-E14 | Cross-browser, contratti, telemetria, sicurezza | 🟡 | codice pronto; **QA runtime browser** e **dashboard analytics** aperti |
| 5 | E15-E16 | Test hardening + automazione deploy | 🟡 | unit/contract estesi; **CI matrix / visual / load / staging** aperti |
| 6 | E17-E18 | Asset + primo lancio portfolio | 🟡 | asset+legali pronti; **lancio (prod, Stripe, store)** aperto |

**In una riga:** la piattaforma multi-brand è completa e funzionante a livello di codice e backend (dev), verificata end-to-end su tutti e 5 i brand. Ciò che manca è quasi tutto **operativo/lancio/decisioni di business**, non architettura.

---

## 2. Dettaglio per epica

### E01 — Architecture Baseline & Safety Net — 🟡
- ✅ suite test verde, version constant in `/health`, request correlation id in ogni envelope, compat utente legacy (shim).
- ⬜ E01-001 tag baseline release · E01-004 inventario env/SSM (doc) · E01-008 fixtures pagine (article/SPA/YouTube).
- 🟡 E01-007 structured logger (esiste `src/logging.mjs` con redaction; wrapper JSON completo parziale).

### E02 — Brand Registry & Request Context — ✅ core
- ✅ registry 5 brand, `getBrand/isValidBrand/listBrands`, `resolveBrand` (X-Brand > body > default), `400 INVALID_BRAND`, brand in `/health`.
- ⬜ E02-002 validazione schema config brand allo startup.

### E03 — Shared Identity / Per-brand Entitlements — ✅ core
- ✅ login condiviso; entitlement per `(user, brand)`; `canUserSummarize/incrementUsage` per brand; niente plan nel JWT; stato fresco a ogni verify; quota indipendente per brand (test).
- 🟡 E03-006/007 init entitlement lazy al primo uso (non al login) — scelta MVP.
- ⬜ E03-011 integration test shared-login (richiede mock DynamoDB).

### E04 — DynamoDB Multi-brand Persistence — ✅ core
- ✅ create/format utente con entitlements map, shim legacy read, `incrementBrandUsage`, `updateUserPlan(userId,brand,…)`, `deleteUser`.
- 🟡 E04-005/007/008 reset standalone / update subscription / init concorrente (integrati ma non come funzioni isolate).
- ⬜ E04-010 unit test entitlements con mock.

### E05 — Quota, Usage & Rate Limits — ✅ core
- ✅ free limit nel registry, reset mensile lazy per brand, usage per brand in risposta, `USAGE_LIMIT_EXCEEDED`, rate-limit key brand-aware.
- ⬜ E05-005 policy per utenti anonimi.

### E06 — Brand-aware Cache & Analytics — ✅
- ✅ chiave cache con brand/promptProfile/outputSchema/squeeze; eventi analytics con brand + solo metadati (no contenuto/PII); schema tabella allineato (fix E13).

### E07 — Prompt Profiles & Output Schemas — ✅
- ✅ 5 profili prompt + 5 schemi/parser difensivi: Lemon `summary`, Scout `attention`, Signal `insights`, NoBull `noise`, Briefly `brief`. Routing da config (nessun `if brand`). Retry su output non valido. Golden/adversarial test. Renderer estensione generico per tutti gli schemi.

### E08 — Payments & Commercial Isolation — ✅ core (codice)
- ✅ price key per brand, `createCheckoutSession(userId,email,brand,planType)`, `metadata.brand` su session/subscription, webhook che aggiornano l'entitlement del **brand corretto**, downgrade free solo per quel brand, `X-Brand` su checkout.
- ⬜ **E18-005** creazione prodotti/prezzi Stripe reali (Scout e altri) + parametri SSM — task di lancio, il codice è brand-ready.

### E09-E10 — Extension source + build pipeline — ✅ core
- ✅ `brand.json` con design token (Doc 17/18), `brand-config.js` generato, hardcode rimossi (nome/tagline/wordmark/colori/logo brand-driven), `X-Brand` su summarize, `build-brand.mjs` (dist deterministica + integrity), `package-brand.mjs` (zip), parità Lemon verificata, build Scout+altri.
- 🟡 E09-001 sorgente resta in `extension/` (non spostata in `extension/src`: scelta zero-regression sul dev unpacked).

### E11 — Cross-browser Targets — 🟡 (codice ✅, QA runtime ⬜)
- ✅ target Chromium (Chrome/Edge/Brave/Arc/Opera stesso pacchetto), Firefox (manifest event-page + gecko id), adapter `browser-polyfill.js`, doc differenze.
- ⬜ **E11-004/006/007/008 QA runtime Firefox/Edge/Safari** — richiede macchina con browser/Xcode. Checklist pronta in `docs/qa-checklist.md`. Chrome è l'unico verificato a runtime.

### E12 — API Contracts & Error Model — ✅
- ✅ X-Brand + fallback body, `brand` nei metadata, catalogo errori centralizzato (`src/errors.mjs`), `request_id` in ogni envelope, contract test, doc API (`docs/api.md`).

### E13 — Analytics, Funnels & Cost Telemetry — 🟡
- ✅ persistenza corretta (fix schema), brand tag + latenza + campi client, **token/costo reali** (`estimateCost`; prezzi gpt-5-nano $0.05/$0.40, gpt-5.6-luna $2/$12; auto-switch modello alla deprecazione nano del 2026-12-10), **cattura funnel** via `POST /analytics/event` (vocabolario `event_type` controllato, eventi anonimi inclusi — verificato live su DynamoDB).
- ⬜ **E13-006/007 dashboard funnel/retention** — esiste solo la spec (`docs/dashboard-spec.md`); manca la UI/aggregazione.

### E14 — Security & Privacy Hardening — 🟡 core
- ✅ secret scan (dist pulito), CORS multi-origin (no wildcard) + header X-Brand/X-Client, redaction log, delimitatori anti prompt-injection su tutti i prompt, output validation pre-render (DOM sicuro), cancellazione account `POST /account/delete` (GDPR).
- ⬜ E14-001 minimizzare host permissions (`*://*/*` → tradeoff UX, decisione di prodotto).

### E15 — Testing & Regression — 🟡
- ✅ golden regression Lemon (parità byte-identica), schema fixture test Scout/Signal/NoBull/Briefly, cross-brand billing isolation test. **114 test / 40 suite / 0 fail.**
- 🟡 E15-001 integration suite multi-brand (unit/contract fatti; integrazione live via script e2e) · E15-008 cross-brand login (isolamento quota verificato live; unit con mock mancante) · E15-010 legacy upgrade (shim testato; percorso completo parziale).
- ⬜ E15-007 visual snapshot per brand · E15-011 load test separazione cache · E15-012 webhook replay test.

### E16 — Infrastructure & Deployment — 🟡
- ✅ E16-002 allowed origins (CORS) · E16-004 CI job test backend (gate su deploy) · E16-009 rollback/incident runbook (`docs/runbooks/`).
- 🟡 E16-001 SSM Stripe per-brand nel SAM (template ha webhook+base; price per-brand da aggiungere con E18-005) · E16-007 security scan (script presente, non wired in CI) · E16-010 backup/export checklist (restore runbook presente, checklist export parziale).
- ⬜ E16-003 deploy fail-fast su config mancante · E16-005 CI matrix 5-brand build · E16-006 job build Firefox/Edge in CI · E16-008 staging deploy + smoke test post-deploy.

### E17 — Brand Assets & Store Readiness — 🟡
- ✅ E17-001..005 icon set 5 brand (16/48/128 da SVG) · **E17-012 URL privacy/terms/support per brand** (privacy/terms hostati su S3, support mailto — chiuso oggi).
- 🟡 E17-006 store copy template (esiste `store.summary` in brand.json; template completo per store parziale).
- ⬜ E17-007..011 asset store per brand (screenshot/listing per Chrome Web Store/AMO/App Store) — solo Lemon ha uno screenshot.

### E18 — First Portfolio Launch & Validation — ⬜ (in gran parte)
- 🟡 E18-004/007/008/009 i 5 brand funzionano end-to-end sul backend dev; non c'è un ambiente **staging** separato né gating beta.
- ⬜ E18-001/002 deploy staging→**produzione** (oggi solo `dev`) · E18-003 monitoraggio legacy 24h · E18-005 prodotti/prezzi Stripe · E18-006 beta interna Scout · E18-010 dashboard comparativa di lancio · E18-011 freeze 48h · E18-012 checklist finale pre-store.

---

## 3. Cosa manca — raggruppato per tipo (azionabile)

### A. Residui di codice (piccoli, non bloccanti)
- Test con mock DynamoDB: E03-011 shared-login, E04-010 entitlements, E15-008 cross-brand login unit.
- E02-002 validazione schema config brand allo startup.
- E05-005 policy utenti anonimi.
- E14-001 riduzione host permissions (decisione UX/prodotto).

### B. Osservabilità / prodotto
- **Dashboard analytics funnel/retention (E13-006/007)** — la cattura eventi è pronta e persiste; manca la UI/aggregazione. È l'unico pezzo "prodotto" rilevante mancante.

### C. Automazione CI/CD & infra (E15-E16)
- CI: matrix build 5-brand, job Firefox/Edge, security-scan job, staging + smoke post-deploy, fail-fast su config mancante.
- Test: visual snapshot per brand, load test cache, webhook replay.
- Deploy oggi è diretto su `dev`; manca la promozione **staging → produzione**.

### D. Lancio / config / business (E17-E18) — richiede decisioni e account esterni
- **Stripe**: creare prodotti/prezzi reali per brand + parametri SSM (E18-005). Il codice è pronto.
- **Store**: asset di listing (screenshot, descrizioni) per Chrome Web Store / AMO / App Store per ciascun brand (E17-007..011).
- **QA runtime browser** (E11-004/006/007/008): eseguire la checklist su Firefox/Edge/Safari (Safari richiede Xcode). Chrome già verificato.
- **Deploy produzione** + monitoraggio legacy 24h + freeze + checklist pre-store (E18-001/002/003/011/012).
- **Review legale** dei testi privacy/terms per-brand (entità Bifa SRLS impostata; contenuto derivato dai template Lemon).
- **DPA sub-processor** (OpenAI/Google/Stripe/AWS): da formalizzare lato business.

---

## 4. Decisioni PM — RISOLTE (2026-08-24)
1. **Ambienti**: creare subito `staging` + `prod` separati; `dev` resta sviluppo. Pipeline `dev → staging → smoke/E2E → prod` con **approvazione manuale** su prod. → In corso: staging creato e verificato; prod creato dalla pipeline al primo run (gate). Vedi `docs/environments.md`.
2. **Ordine di lancio**: **Lemon → Scout → NoBull → Briefly → Signal**, unica *launch wave* 48–72h (l'ordine serve a QA/submission, non a distanziare i prodotti).
3. **Pricing**: model-agnostic + **cost-aware routing** (Free = modello economico; Premium = stesso modello quando basta, superiore solo se il contenuto lo richiede; fallback premium solo per errore/qualità). Pricing per-brand semplice ma separato. **Numeri definitivi dopo misura degli unit economics reali** (costo medio 100/500/1.000 summary per brand dai token già registrati). → Follow-up: implementare router + misura costi.
4. **Dashboard analytics**: **interna**, MVP. Una sola dashboard portfolio filtrabile (All/5 brand) con 4 blocchi (Acquisition/Activation, Engagement, Retention, Money) + tabella di **confronto brand** (Activation, D7, Summaries/User, Paid %, Cost/User). Funnel e retention distinti. Nessuna analytics dentro le estensioni oltre l'esistente.
5. **Host permissions**: mantenere `*://*/*` per MVP (non restringere: attrito nel core flow). Rivalutazione post-launch. Motivazione chiara nelle submission store.
6. **Store assets/listing**: li produciamo in buona parte noi. → Follow-up: generare copy + screenshot per i 5 brand (E17-006..011).

### Follow-up tecnici derivati (da schedulare)
- **Cost-aware model router** (#3) nel path summarize + target di costo per summary.
- **Misura unit economics** (#3): query analytics → costo medio per brand su 100/500/1.000 summary.
- **Dashboard interna** (#4): E13-007, secondo lo schema a 4 blocchi + tabella confronto.
- **Store assets** (#6): E17-006..011 per i 5 brand.
- **Stripe LIVE** (E18-005) prima del lancio reale: prod oggi è TEST-mode.

---

## 5. Evidenza di stato (riproducibile)
```
cd backend && node --test         # 114 pass / 40 suite / 0 fail
node scripts/validate-brands.mjs  # 5 brand · 0 errori · 0 warning
node scripts/scan-secrets.mjs     # nessun segreto nei bundle
curl -s .../dev/health            # multibrand-1, 5 brand, healthy
```
Live e2e (oggi): `/analytics/event` valido→persistito su DynamoDB; event_type/brand/JSON invalidi→400. Scout end-to-end, isolamento quota, `INVALID_BRAND`, `/account/delete` verificati.
