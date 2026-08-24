# Reading Intelligence Platform — API (v1)

Backend multi-brand condiviso. Base URL (dev): `https://4jo5gamel9.execute-api.eu-west-1.amazonaws.com/dev`.

## Autenticazione e header
- `Authorization: Bearer <jwt>` — richiesto sugli endpoint autenticati.
- `X-Brand: <brand>` — seleziona il prodotto. Precedenza: header `X-Brand` > `body.brand` > `lemonsqueezer`. Brand esplicito non valido → `400 INVALID_BRAND`. Brand validi: `lemonsqueezer`, `scout`, `signal`, `briefly`, `nobull`.
- `X-Client`, `X-Client-Version` — telemetria/cohort (opzionali).

Regola: identità condivisa tra brand, ma **entitlement (piano/quota/subscription) indipendente per brand** (`(user_id, brand_id)`).

## Envelope di risposta
Ogni risposta include `request_id` (correlazione con i log).

Successo (esempio `/summarize-url`, schema summary):
```json
{
  "request_id": "…",
  "summary": "• …\n• …",
  "readingTimeMinutes": 2,
  "wordsCount": 120,
  "usage": { "input_tokens": 4120, "output_tokens": 780, "cost_estimate": 0 },
  "stats": { "originalWords": 2840, "summaryWords": 120, "compressionRatio": 96, "timeSaved": 700, "targetMet": true },
  "url": "https://…", "title": "…", "sourceType": "web",
  "brand": "lemonsqueezer",
  "user": { "usage": { "used": 3, "limit": 10, "resetDate": "…" }, "plan": "free" }
}
```
Per schemi non-summary la risposta è generica: `{ request_id, brand, schema, output, stats, user }`.

Errore:
```json
{ "request_id": "…", "error": "messaggio", "code": "STABLE_CODE", "...": "campi extra (es. brand, resetDate)" }
```

## Catalogo errori (codici stabili)
| Code | HTTP | Significato |
|---|---|---|
| INVALID_JSON | 400 | Body non valido |
| MISSING_URL | 400 | URL mancante/non stringa |
| INVALID_BRAND | 400 | Brand esplicito non valido |
| INSUFFICIENT_CONTENT | 400 | Contenuto insufficiente |
| INVALID_TRANSCRIPT / INVALID_VIDEO_DURATION | 400 | Input YouTube non valido |
| AUTH_REQUIRED | 401 | Autenticazione richiesta |
| PAYMENT_BRAND_MISMATCH | 409 | Brand pagamento non corrispondente |
| YOUTUBE_TRANSCRIPT_REQUIRED | 422 | Trascrizione YouTube non ricevuta |
| USAGE_LIMIT_EXCEEDED | 429 | Limite mensile del brand raggiunto (include `brand`, `plan`, `resetDate`) |
| RATE_LIMITED | 429 | Troppe richieste |
| OUTPUT_SCHEMA_ERROR | 502 | Output del modello non valido |
| INVALID_OPENAI_RESPONSE | 500 | Risposta OpenAI non valida |
| PROVIDER_UNAVAILABLE | 503 | Provider di sintesi non disponibile |
| PROCESSING_ERROR / INTERNAL_ERROR | 500 | Errore interno |

Fonte di verità: `backend/src/errors.mjs`.

## Endpoint principali
- `POST /summarize-url` (auth) — riassume una pagina/video. Body: `{ url, text?, transcript?, description?, comments?, lang, squeeze, summaryModel }`. `text` (estratto client) preferito; altrimenti fetch server-side. `squeeze` ∈ {10,20,50} (% del testo mantenuta). Output secondo lo schema del brand.
- `POST /account/delete` (auth) — cancella utente + subscription. `{ deleted: true, userId }`.
- `POST /payments/create-checkout` (auth) — checkout Stripe del brand corrente. Body `{ planType }`.
- `GET /health` — stato + `architectureVersion`, `apiVersion`, `environment`, `brands`.

## Schemi di output per brand
| Brand | schema | Campi principali |
|---|---|---|
| LemonSqueezer | `summary` | `summary` (bullet, `•`), `stats`, `readingTimeMinutes` (+ bullet finale `💬 Commenti:` per YouTube) |
| Scout | `attention` | `attention_score`, `recommendation` (read_now/skim/save/ignore), `novelty`, `importance`, `credibility`, `reasons[]` |
| Signal | `insights` | `signal_score`, `key_takeaways[]`, `risks[]`, `opportunities[]`, `decision_note` |
| NoBull | `noise` | `clickbait_score`, `hype_score`, `information_density`, `facts[]`, `filler_patterns[]`, `framing_note` |
| Briefly | `brief` | `strategic_importance`, `what_happened[]`, `why_it_matters[]`, `background[]`, `alternative_views[]`, `watch_next[]` |

I punteggi sono interi 0-100; i parser backend sono difensivi (clamp/normalizzazione). Fonte: `backend/src/schemas/`.

## Sicurezza
HTTPS only · nessun segreto nei bundle client (secret-scan) · contenuto pagina trattato come input non fidato (delimitatori anti prompt-injection) · CORS su origini esatte (no wildcard).
