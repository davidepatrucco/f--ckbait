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

Prezzi modelli (listino OpenAI ago 2026, in `MODEL_COSTS`): gpt-5-nano $0.05/$0.40 ·
gpt-5.4-nano $0.20/$1.25 (economy post-deprecazione nano) · gpt-5.6-luna $0.20/$1.20 (premium).

| brand | avg in tok | avg out tok | $/summary nano | $/summary luna |
|---|---|---|---|---|
| lemonsqueezer | 1067 | 56 | $0.000076 | $0.000280 |
| scout | 1250 | 117 | $0.000109 | $0.000390 |
| signal | 1201 | 333 | $0.000193 | $0.000639 |
| briefly | 1221 | 458 | $0.000244 | $0.000794 |
| nobull | 1231 | 470 | $0.000249 | $0.000810 |

Proiezione a 1.000 summary (nano / luna): Lemon $0.076/$0.28 · Scout $0.11/$0.39 ·
Signal $0.19/$0.64 · Briefly $0.24/$0.79 · NoBull $0.25/$0.81.

## Lettura
- L'ordine di costo (Lemon < Scout < Signal < Briefly < NoBull) è guidato dalla
  **verbosità dell'output schema**: Lemon (bullet) è il più conciso, Briefly/NoBull i più lunghi.
  L'input varia poco (~1000–1250 tok), dominato dal contenuto + overhead prompt del brand.
- **Il COGS LLM non è il vincolo sul prezzo.** A €4.99 e 100 summary/utente/mese, il margine
  lordo LLM è ~99% su nano e ~98–99% su luna. I driver economici reali sono infra AWS, fee
  Stripe (~2,9% + €0,25/transazione) e CAC, non il costo per token.
- **Nota prezzo luna**: corretto a $0.20/$1.20 (listino web + aggregatori). Un valore precedente
  di $2/$12 era 10x troppo alto. Con il prezzo corretto, luna è ~4x nano su input e ~3x su output
  (post-deprecazione, economy=gpt-5.4-nano ≈ luna).
- Implicazione **router (#3A)**: il gap economy/premium è modesto; il router serve soprattutto a
  gestire fallback su errore/qualità e la migrazione nano→gpt-5.4-nano, e a tenere gli utenti ad
  alto volume sull'economy (vedi sensitivity: su luna i brand verbosi vanno in perdita ~6–8k summary/utente/mese).

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
