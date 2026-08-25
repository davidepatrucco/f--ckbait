# Runbook — Stripe LIVE su prod (E18-005)

Oggi prod gira in **Stripe TEST-mode** (SSM copiati da dev). Questo passaggio va fatto
**prima di incassare davvero**. Richiede il tuo account Stripe (LIVE) e le decisioni di prezzo.
Il codice è già brand-ready: ogni brand legge i propri price id da SSM
(`getBrandProducts` in `backend/src/payments.mjs`).

## 0. Prerequisito: prezzi decisi
Definire prezzo mensile e annuale per ciascun brand (vedi unit economics: `design/unit-economics-*`).
I prezzi vivono in **Stripe** (price id), non nel codice.

## 1. Stripe Dashboard (modalità LIVE)
Per **ogni** brand (lemonsqueezer, scout, signal, briefly, nobull):
1. Products → Add product → nome del brand.
2. Aggiungi due prezzi ricorrenti: **monthly** e **yearly** → copia i due `price_...` (LIVE).
3. Nella subscription/price, metadata `brand=<brandId>` è consigliato (i webhook risolvono
   il brand via `resolveStripeBrand`; il fallback è il metadata della session).

## 2. Webhook LIVE
Developers → Webhooks → Add endpoint:
- **URL**: `https://zj4r2m4iyqetlscad2yb6ndehe0udkbw.lambda-url.eu-west-1.on.aws/` (Function URL webhook prod)
- **Eventi**: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`
- Copia il **Signing secret** (`whsec_...`).

## 3. Chiave segreta LIVE
Developers → API keys → **Secret key** LIVE (`sk_live_...`).

## 4. Parametri SSM prod da impostare
| Parametro (`/lemonsqueezer/prod/…`) | Valore |
|---|---|
| `stripe-secret-key` | `sk_live_...` |
| `stripe-webhook-secret` | `whsec_...` (endpoint del punto 2) |
| `stripe-premium-monthly-price-id` | price mensile **Lemon** |
| `stripe-premium-yearly-price-id` | price annuale **Lemon** |
| `stripe-scout-premium-monthly-price-id` | price mensile **Scout** |
| `stripe-scout-premium-yearly-price-id` | price annuale **Scout** |
| `stripe-signal-premium-monthly-price-id` | Signal mensile |
| `stripe-signal-premium-yearly-price-id` | Signal annuale |
| `stripe-briefly-premium-monthly-price-id` | Briefly mensile |
| `stripe-briefly-premium-yearly-price-id` | Briefly annuale |
| `stripe-nobull-premium-monthly-price-id` | NoBull mensile |
| `stripe-nobull-premium-yearly-price-id` | NoBull annuale |
| `stripe-success-url` / `stripe-cancel-url` | URL di ritorno post-checkout |

Nota: oggi in dev/staging esistono solo i price id **Lemon** (generici). Per testare il
billing dei brand non-Lemon anche in test-mode, imposta gli stessi param con price id TEST.

## 5. Applicare
Fornisci i valori via env e lancia (imposta solo quelli presenti):
```
ENV=prod \
STRIPE_SECRET_KEY=sk_live_... STRIPE_WEBHOOK_SECRET=whsec_... \
LEMON_M=price_... LEMON_Y=price_... \
SCOUT_M=price_... SCOUT_Y=price_... \
SIGNAL_M=price_... SIGNAL_Y=price_... \
BRIEFLY_M=price_... BRIEFLY_Y=price_... \
NOBULL_M=price_... NOBULL_Y=price_... \
STRIPE_SUCCESS_URL=https://... STRIPE_CANCEL_URL=https://... \
bash infra/setup-stripe-live.sh
```
Poi **ridispiega prod** (Actions → Deploy backend PROD) per invalidare la cache dei secret.

## 6. Verifica
- Checkout reale con carta vera (importo minimo) su un brand → attesa: entitlement premium
  di **quel** brand + evento `subscription_activated` in analytics.
- Ripeti per almeno un secondo brand per confermare l'isolamento commerciale.
