# Handoff report — chiusura gap multi-brand

Data: 2026-08-24 · Branch: `main` · Ultimo commit: `c79be3b`
Repo: `f--ckbait` · Backend live: `https://4jo5gamel9.execute-api.eu-west-1.amazonaws.com/dev`

Regola bloccante rispettata: **"Shared identity, independent commercial lifecycle per brand"**
(login condiviso; quota/piano/subscription/entitlement per-brand, chiave `(user_id, brand_id)`).

---

## 1. Stato dei 4 gap

| # | Gap | Stato | Evidenza |
|---|-----|-------|----------|
| 1 | Cost tracking + deprecazione gpt-5-nano | **Chiuso** | prezzi reali in `MODEL_COSTS`, auto-switch a `gpt-5.6-luna` dopo 2026-12-10, test |
| 2 | Funnel analytics (event_type client) | **Chiuso** | `POST /analytics/event` live, persistenza verificata su DynamoDB |
| 3 | Legali per-brand | **Chiuso** | 4 brand: privacy/terms su S3 (HTTP 200), `validate-brands` 0/0 |
| 4 | QA runtime browser (Chrome/Edge/Firefox/Safari) | **Aperto — richiede la tua macchina** | `docs/qa-checklist.md` |

Il gap #4 non è chiudibile in ambiente agent (nessun browser/Xcode). Tutto il resto è chiuso,
testato e verificato in produzione.

---

## 2. Gap #1 — costi e migrazione modello

File: `backend/src/openai.mjs`

- `MODEL_COSTS`: `gpt-5-nano` $0.05/$0.40, `gpt-5.6-luna` $2/$12 per 1M token (in/out).
- Override runtime via env `MODEL_COSTS_JSON` (nessun redeploy per aggiornare i prezzi).
- `estimateCost(model, inTok, outTok)` → costo USD; modello sconosciuto → `0` (nessun prezzo inventato).
- **Auto-switch deprecazione**: `AUTO_DEFAULT_MODEL = Date.now() >= Date.parse('2026-12-10') ? 'gpt-5.6-luna' : 'gpt-5-nano'`.
  `SUMMARY_MODEL` (env) ha precedenza per forzare il modello prima/dopo la data.
- Il costo stimato viene propagato negli eventi analytics (`cost_estimate`, `input_tokens`, `output_tokens`).

Azione futura (non bloccante): dal 2026-12-10 il default passa da solo a luna. Per anticipare o
posticipare, settare `SUMMARY_MODEL`. Verificare il costo unitario: luna è ~40x nano in output.

## 3. Gap #2 — funnel analytics

File: `backend/src/analytics.mjs`, `backend/lambda/handler.mjs`, `extension/service_worker.js`

- `ALLOWED_EVENT_TYPES` (vocabolario controllato): `summary_completed/failed`,
  `extension_installed/opened`, `page_detected`, `login_completed`, `sidepanel_opened`,
  `result_copied`, `source_opened`, `paywall_viewed`, `checkout_started`, `subscription_activated`.
- `POST /analytics/event`: auth **opzionale** (eventi anonimi ammessi), valida `event_type` e `X-Brand`.
  - `event_type` non valido → `400 INVALID_REQUEST` + lista `allowed`.
  - brand non valido → `400 INVALID_BRAND`. Body non JSON → `400 INVALID_JSON`.
- `service_worker` emette `extension_installed` su `onInstalled`.
- Privacy: solo metadati (dominio, tipo evento, brand, plan). Mai contenuto pagina o testo riassunto.
- **Fix incluso**: eventi anonimi ora persistono. `userId` è chiave della GSI `UserEventsIndex` (tipo S);
  scriverlo `null` causava `ValidationException` e perdita silenziosa dell'evento. Ora l'attributo è
  assente per gli anonimi; `docClient` usa `removeUndefinedValues:true`.

Verifica live (post-deploy):
```
POST /analytics/event {"event_type":"extension_installed"} X-Brand: scout
→ {"logged":true,"event_id":"053a4fa3-…","brand":"scout"}   [HTTP 200]
DynamoDB get-item eventId=053a4fa3-… → event_type=extension_installed, source=client, brand=scout
```

## 4. Gap #3 — legali per-brand

File: `legal/generate-legal.mjs`, `legal/<brand>/{privacy-policy,terms}.html`, `brands/<brand>/brand.json`

- Generatore riusabile: prende i template LemonSqueezer e sostituisce il nome prodotto con quello
  del brand. **Entità titolare invariata: Bifa SRLS — contact@bifa.digital — Torino.**
- Hostate su S3 bucket `lemonsqueezer-legal` sotto `/<brand>/`, tutte HTTP 200:
  - Scout / Signal / Briefly / NoBull → `https://lemonsqueezer-legal.s3.eu-west-1.amazonaws.com/<brand>/{privacy-policy,terms}.html`
- `brand.json.urls.privacy/terms` aggiornati → `validate-brands`: **0 errori, 0 warning**.

Nota per la review legale: i template sono derivati da quello LemonSqueezer (bilingue IT/EN, GDPR,
sub-processor OpenAI/Google/Stripe/AWS). Se serve un DPO o clausole specifiche per un brand, editare
i sorgenti in `legal/<brand>/` e rifare l'upload; il generatore non le sovrascrive se non rilanciato.

## 5. Gap #4 — QA runtime browser (da eseguire)

`docs/qa-checklist.md` contiene i passi per Chrome/Edge/Firefox/Safari (con `xcrun
safari-web-extension-converter` per Safari, che richiede Xcode). Build già prodotte:
`node scripts/build-brand.mjs <brand> --browser chromium|firefox`. Criterio di chiusura: per ogni
`(browser, brand)` install pulito, popup brandizzato, login, summarize con output corretto per schema,
quota/errori corretti, nessun errore console non atteso.

---

## 6. Verifica riproducibile (comandi)

```
# test unit/integration
cd backend && node --test            # 114 pass / 40 suite / 0 fail

# validazione brand pack + build multi-brand + secrets
node scripts/validate-brands.mjs     # 5 brand · 0 errori · 0 warning
for b in lemonsqueezer scout signal briefly nobull; do
  node scripts/build-brand.mjs $b --browser chromium
  node scripts/build-brand.mjs $b --browser firefox
done
node scripts/scan-secrets.mjs        # nessun segreto in dist

# health backend (multibrand-1, 5 brand)
curl -s https://4jo5gamel9.execute-api.eu-west-1.amazonaws.com/dev/health
```

## 7. Stato finale

- Test: **114 pass / 40 suite / 0 fail**.
- Build: 5 brand × 2 browser (chromium+firefox) OK; parità Lemon byte-identica; scan-secrets pulito.
- Backend: deploy `c79be3b` **success**; `/health` healthy, `architectureVersion: multibrand-1`,
  brands `[lemonsqueezer, scout, signal, briefly, nobull]`.
- Live e2e: `/analytics/event` (4 casi: valido→persist, event_type invalido→400, brand invalido→400,
  JSON invalido→400) tutti come atteso; persistenza confermata su DynamoDB.
- Nessun `if (brand === …)` nel core (config-driven); nessuna PII/contenuto negli eventi; nessun
  file `extension/*_old.*` toccato.

## 8. Commit rilevanti (questa sessione)

- `c79be3b` fix(analytics): persist anonymous client events (GSI userId type mismatch)
- `92a53db` feat: close remaining gaps (cost/luna migration, funnel analytics, per-brand legal)
- `874224c` docs: adversarial sweep report (10/10 live e2e, 10 brand builds)

## 9. Punti aperti da decidere (non bloccanti)

1. Gap #4 QA su browser reali (tua macchina) — unico residuo tecnico.
2. Data/attivazione migrazione a `gpt-5.6-luna`: automatica al 2026-12-10, anticipabile con `SUMMARY_MODEL`.
   Rivedere i margini: costo output luna ~30x nano.
3. Review legale dei testi per-brand (entità corretta Bifa SRLS già impostata).
4. Pubblicazione store per-brand (CWS/AMO/App Store) dopo QA.
