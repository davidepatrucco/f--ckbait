# Sensitivity margine vs volume — prezzo 4.99/mese

Costo/summary da `design/unit-economics-sample-2026-08-25.json`. cost/user = $/summary × volume. Margine LORDO LLM = (prezzo − cost/user) / prezzo. Prezzo in €, costo in $ → margine indicativo (ignora FX/infra/fee).

## Modello nano

| brand | $/summary | cost/user @100 | cost/user @1000 | cost/user @10000 | margine @100 | margine @1000 | margine @10000 | break-even (summ/mese) |
|---|---|---|---|---|---|---|---|---|
| lemonsqueezer | $0.0001 | $0.0076 | $0.0760 | $0.7600 | 99.8% | 98.5% | 84.8% | 65,657 |
| scout | $0.0001 | $0.0109 | $0.1090 | $1.0900 | 99.8% | 97.8% | 78.2% | 45,779 |
| signal | $0.0002 | $0.0193 | $0.1930 | $1.9300 | 99.6% | 96.1% | 61.3% | 25,854 |
| briefly | $0.0002 | $0.0244 | $0.2440 | $2.4400 | 99.5% | 95.1% | 51.1% | 20,450 |
| nobull | $0.0002 | $0.0249 | $0.2490 | $2.4900 | 99.5% | 95.0% | 50.1% | 20,040 |

## Modello luna

| brand | $/summary | cost/user @100 | cost/user @1000 | cost/user @10000 | margine @100 | margine @1000 | margine @10000 | break-even (summ/mese) |
|---|---|---|---|---|---|---|---|---|
| lemonsqueezer | $0.0003 | $0.0280 | $0.2800 | $2.8000 | 99.4% | 94.4% | 43.9% | 17,821 |
| scout | $0.0004 | $0.0390 | $0.3900 | $3.9000 | 99.2% | 92.2% | 21.8% | 12,794 |
| signal | $0.0006 | $0.0639 | $0.6390 | $6.3900 | 98.7% | 87.2% | -28.1% | 7,809 |
| briefly | $0.0008 | $0.0794 | $0.7940 | $7.9400 | 98.4% | 84.1% | -59.1% | 6,284 |
| nobull | $0.0008 | $0.0810 | $0.8100 | $8.1000 | 98.4% | 83.8% | -62.3% | 6,160 |

## Lettura
- Il cap serve a limitare l'abuso, ma il suo effetto sul margine dipende dal modello.
- Su **nano** anche 10.000 summary/utente/mese resta profittevole per tutti i brand.
- Su **luna** il break-even cade tra ~640 e ~1.730 summary/utente/mese: un cap a 10.000
  NON protegge il margine. O il cap è model-aware/più basso, o il router tiene gli utenti
  ad alto volume sul modello economico (input diretto per #3A cost-aware router).
