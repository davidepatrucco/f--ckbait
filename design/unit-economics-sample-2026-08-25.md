# Unit economics (COGS LLM) — sorgente: sample

Ipotesi margine: prezzo premium €4.99/mese · volume 100 summary/utente/mese. Il margine è LORDO lato LLM (esclude infra AWS, fee Stripe).

| brand | n | avg in tok | avg out tok | $/summary nano | $/summary luna | margine% nano | margine% luna |
|---|---|---|---|---|---|---|---|
| lemonsqueezer | 5 | 1067 | 63 | $0.000078 | $0.002885 | 99.8% | 94.2% |
| scout | 5 | 1250 | 143 | $0.000120 | $0.004213 | 99.8% | 91.6% |
| signal | 5 | 1201 | 302 | $0.000181 | $0.006023 | 99.6% | 87.9% |
| briefly | 5 | 1221 | 433 | $0.000234 | $0.007633 | 99.5% | 84.7% |
| nobull | 5 | 1231 | 443 | $0.000239 | $0.007775 | 99.5% | 84.4% |

## Proiezione costo totale (nano / luna)
| brand | 100 | 500 | 1000 |
|---|---|---|---|
| lemonsqueezer | $0.007800 / $0.288500 | $0.039000 / $1.442500 | $0.078000 / $2.885000 |
| scout | $0.012000 / $0.421300 | $0.060000 / $2.106500 | $0.120000 / $4.213000 |
| signal | $0.018100 / $0.602300 | $0.090500 / $3.011500 | $0.181000 / $6.023000 |
| briefly | $0.023400 / $0.763300 | $0.117000 / $3.816500 | $0.234000 / $7.633000 |
| nobull | $0.023900 / $0.777500 | $0.119500 / $3.887500 | $0.239000 / $7.775000 |
