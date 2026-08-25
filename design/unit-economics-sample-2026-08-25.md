# Unit economics (COGS LLM) — sorgente: sample

Ipotesi margine: prezzo premium €4.99/mese · volume 100 summary/utente/mese. Il margine è LORDO lato LLM (esclude infra AWS, fee Stripe).

| brand | n | avg in tok | avg out tok | $/summary nano | $/summary luna | margine% nano | margine% luna |
|---|---|---|---|---|---|---|---|
| lemonsqueezer | 5 | 1067 | 56 | $0.000076 | $0.000280 | 99.8% | 99.4% |
| scout | 5 | 1250 | 117 | $0.000109 | $0.000390 | 99.8% | 99.2% |
| signal | 5 | 1201 | 333 | $0.000193 | $0.000639 | 99.6% | 98.7% |
| briefly | 5 | 1221 | 458 | $0.000244 | $0.000794 | 99.5% | 98.4% |
| nobull | 5 | 1231 | 470 | $0.000249 | $0.000810 | 99.5% | 98.4% |

## Proiezione costo totale (nano / luna)
| brand | 100 | 500 | 1000 |
|---|---|---|---|
| lemonsqueezer | $0.007600 / $0.028000 | $0.038000 / $0.140000 | $0.076000 / $0.280000 |
| scout | $0.010900 / $0.039000 | $0.054500 / $0.195000 | $0.109000 / $0.390000 |
| signal | $0.019300 / $0.063900 | $0.096500 / $0.319500 | $0.193000 / $0.639000 |
| briefly | $0.024400 / $0.079400 | $0.122000 / $0.397000 | $0.244000 / $0.794000 |
| nobull | $0.024900 / $0.081000 | $0.124500 / $0.405000 | $0.249000 / $0.810000 |
