# Unit economics — metodo, risultati, caveat

Deliverable della decisione PM #3 (pricing model-agnostic): misurare il **costo reale
per summary per brand** prima di fissare i prezzi. Il prezzo del prodotto non dipende dal
modello: qui misuriamo il COGS lato LLM.

## Come è misurato
- Script: `scripts/measure-unit-economics.mjs` (+ wrapper `run-measure-unit-economics.sh`
  che carica `OPENAI_API_KEY` da SSM senza stamparla).
- Corpus: `scripts/fixtures/unit-economics-corpus.mjs` — 5 testi coerenti (tech/salute/finanza),
  identici per tutti i brand → le differenze di costo riflettono **prompt profile + output
  schema**, non il contenuto.
- Sorgente `sample`: esegue summary reali (25 chiamate = 5 brand × 5 testi) e legge i token
  reali dalla risposta OpenAI. Costo del run: < $0.01 su nano.
- Sorgente `analytics`: aggrega gli eventi `summary_completed` reali (quando ci sarà traffico
  di produzione): `node scripts/measure-unit-economics.mjs --source analytics --table lemonsqueezer-analytics-<env>`.

## Risultati (sample, 2026-08-25, lang it, reasoning_effort minimal)
Dati grezzi in `design/unit-economics-sample-2026-08-25.{md,json}`.

| brand | avg in tok | avg out tok | $/summary nano | $/summary luna |
|---|---|---|---|---|
| lemonsqueezer | 1067 | 63 | $0.000078 | $0.002885 |
| scout | 1250 | 143 | $0.000120 | $0.004213 |
| signal | 1201 | 302 | $0.000181 | $0.006023 |
| briefly | 1221 | 433 | $0.000234 | $0.007633 |
| nobull | 1231 | 443 | $0.000239 | $0.007775 |

Proiezione a 1.000 summary (nano / luna): Lemon $0.078/$2.89 · Scout $0.12/$4.21 ·
Signal $0.18/$6.02 · Briefly $0.23/$7.63 · NoBull $0.24/$7.78.

## Lettura
- L'ordine di costo (Lemon < Scout < Signal < Briefly < NoBull) è guidato dalla
  **verbosità dell'output schema**: Lemon (bullet) è il più conciso, Briefly/NoBull i più lunghi.
  L'input varia poco (~1000–1250 tok), dominato dal contenuto + overhead prompt del brand.
- **Il COGS LLM non è il vincolo sul prezzo.** Anche su luna, a €4.99 e 100 summary/utente/mese,
  il margine lordo LLM è ≥ 84% per tutti i brand; su nano è ~99,5%. I driver economici reali
  sono infra AWS, fee Stripe (~2,9% + €0,25/transazione) e CAC, non il costo per token.
- Implicazione per il **cost-aware router** (#3 parte A): il target di costo/summary ha ampio
  margine; il router serve più a proteggere dai casi estremi (contenuti molto lunghi, retry,
  fallback premium) e alla migrazione nano→luna, che non a stare sotto una soglia stretta.

## Caveat
- Campione di 5 testi/brand: stima di primo ordine. La distribuzione reale (code lunghe:
  articoli molto lunghi, retry, video con commenti) va misurata su traffico vero via `--source analytics`.
- `reasoning_effort: minimal`: alzarlo aumenta i token di ragionamento/output e quindi il costo.
- Margine indicativo: prezzo in €, costo in $, senza cambio FX né infra/fee (irrilevante a questi margini).
- Prezzi €4.99/volume 100 sono **ipotesi** (`--price` / `--volume` per rifare i conti).

## Ripetere
```
bash scripts/run-measure-unit-economics.sh --source sample --lang it --price 4.99 --volume 100
```
