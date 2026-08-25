# Sensitivity margine vs volume — prezzo 4.99/mese

Costo/summary da `design/unit-economics-sample-2026-08-25.json`. cost/user = $/summary × volume. Margine LORDO LLM = (prezzo − cost/user) / prezzo. Prezzo in €, costo in $ → margine indicativo (ignora FX/infra/fee).

## Modello nano

| brand | $/summary | cost/user @100 | cost/user @1000 | cost/user @10000 | margine @100 | margine @1000 | margine @10000 | break-even (summ/mese) |
|---|---|---|---|---|---|---|---|---|
| lemonsqueezer | $0.0001 | $0.0078 | $0.0780 | $0.7800 | 99.8% | 98.4% | 84.4% | 63,974 |
| scout | $0.0001 | $0.0120 | $0.1200 | $1.2000 | 99.8% | 97.6% | 76.0% | 41,583 |
| signal | $0.0002 | $0.0181 | $0.1810 | $1.8100 | 99.6% | 96.4% | 63.7% | 27,569 |
| briefly | $0.0002 | $0.0234 | $0.2340 | $2.3400 | 99.5% | 95.3% | 53.1% | 21,324 |
| nobull | $0.0002 | $0.0239 | $0.2390 | $2.3900 | 99.5% | 95.2% | 52.1% | 20,878 |

## Modello luna

| brand | $/summary | cost/user @100 | cost/user @1000 | cost/user @10000 | margine @100 | margine @1000 | margine @10000 | break-even (summ/mese) |
|---|---|---|---|---|---|---|---|---|
| lemonsqueezer | $0.0029 | $0.2885 | $2.8850 | $28.8500 | 94.2% | 42.2% | -478.2% | 1,729 |
| scout | $0.0042 | $0.4213 | $4.2130 | $42.1300 | 91.6% | 15.6% | -744.3% | 1,184 |
| signal | $0.0060 | $0.6023 | $6.0230 | $60.2300 | 87.9% | -20.7% | -1107.0% | 828 |
| briefly | $0.0076 | $0.7633 | $7.6330 | $76.3300 | 84.7% | -53.0% | -1429.7% | 653 |
| nobull | $0.0078 | $0.7775 | $7.7750 | $77.7500 | 84.4% | -55.8% | -1458.1% | 641 |

## Lettura
- Il cap serve a limitare l'abuso, ma il suo effetto sul margine dipende dal modello.
- Su **nano** anche 10.000 summary/utente/mese resta profittevole per tutti i brand.
- Su **luna** il break-even cade tra ~640 e ~1.730 summary/utente/mese: un cap a 10.000
  NON protegge il margine. O il cap è model-aware/più basso, o il router tiene gli utenti
  ad alto volume sul modello economico (input diretto per #3A cost-aware router).
