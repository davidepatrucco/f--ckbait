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
- **URL**: leggilo dallo stack, non da qui (cambia se lo stack viene ricreato):
  `aws cloudformation describe-stacks --stack-name lemonsqueezer-prod --region eu-west-1 --query "Stacks[0].Outputs[?OutputKey=='StripeWebhookUrl'].OutputValue" --output text`
- **Eventi (tutti e 6, quelli gestiti dal codice)**: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_succeeded`, `invoice.payment_failed`. Senza gli ultimi due un pagamento fallito non viene mai riflesso sull'utente.
- Copia il **Signing secret** (`whsec_...`).

## 3. Chiave segreta LIVE
Developers → API keys → **Secret key** LIVE (`sk_live_...`).

## 4. Parametri SSM prod da impostare
| Parametro (`/reading-intelligence/prod/…`) | Valore |
|---|---|
| `stripe-secret-key` | `sk_live_...` |
| `stripe-webhook-secret` | `whsec_...` (endpoint del punto 2) |
| `stripe-lemonsqueezer-premium-monthly-price-id` | price mensile **Lemon** |
| `stripe-lemonsqueezer-premium-yearly-price-id` | price annuale **Lemon** |
| `stripe-scout-premium-monthly-price-id` | price mensile **Scout** |
| `stripe-scout-premium-yearly-price-id` | price annuale **Scout** |
| `stripe-signal-premium-monthly-price-id` | Signal mensile |
| `stripe-signal-premium-yearly-price-id` | Signal annuale |
| `stripe-briefly-premium-monthly-price-id` | Briefly mensile |
| `stripe-briefly-premium-yearly-price-id` | Briefly annuale |
| `stripe-nobull-premium-monthly-price-id` | NoBull mensile |
| `stripe-nobull-premium-yearly-price-id` | NoBull annuale |
| `stripe-success-url` / `stripe-cancel-url` | URL di ritorno post-checkout. **Usa il segnaposto `{brand}`**, es. `https://bifa.digital/{brand}/thank-you.html`: il parametro e' unico per ambiente e senza segnaposto tutti i brand atterrano sulla pagina di Lemon |

Nota: le chiavi legacy `stripe-premium-*-price-id` NON sono piu' lette (Lemon usa `stripe-lemonsqueezer-*`
come gli altri brand): un valore impostato li' non ha effetto. Per testare il billing in test-mode
imposta gli stessi parametri con price id TEST su staging.

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
