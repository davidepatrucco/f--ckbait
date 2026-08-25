#!/usr/bin/env bash
# Imposta i parametri SSM Stripe per un ambiente (default prod). Valori via env,
# nessun segreto hardcoded. Imposta SOLO i parametri per cui è fornito un valore.
# Vedi docs/runbooks/stripe-live-setup.md.
set -euo pipefail
ENV="${ENV:-prod}"; REGION="${AWS_REGION:-eu-west-1}"; P="/lemonsqueezer/$ENV"
put(){ if [ -n "${2:-}" ]; then aws ssm put-parameter --name "$P/$1" --type "$3" --value "$2" --overwrite --region "$REGION" >/dev/null && echo "set $P/$1"; fi; }
put stripe-secret-key "${STRIPE_SECRET_KEY:-}" SecureString
put stripe-webhook-secret "${STRIPE_WEBHOOK_SECRET:-}" SecureString
put stripe-premium-monthly-price-id "${LEMON_M:-}" String
put stripe-premium-yearly-price-id  "${LEMON_Y:-}" String
put stripe-scout-premium-monthly-price-id   "${SCOUT_M:-}" String
put stripe-scout-premium-yearly-price-id    "${SCOUT_Y:-}" String
put stripe-signal-premium-monthly-price-id  "${SIGNAL_M:-}" String
put stripe-signal-premium-yearly-price-id   "${SIGNAL_Y:-}" String
put stripe-briefly-premium-monthly-price-id "${BRIEFLY_M:-}" String
put stripe-briefly-premium-yearly-price-id  "${BRIEFLY_Y:-}" String
put stripe-nobull-premium-monthly-price-id  "${NOBULL_M:-}" String
put stripe-nobull-premium-yearly-price-id   "${NOBULL_Y:-}" String
put stripe-success-url "${STRIPE_SUCCESS_URL:-}" String
put stripe-cancel-url  "${STRIPE_CANCEL_URL:-}" String
echo "Fatto ($ENV). Ridispiega l'ambiente per invalidare la cache dei secret."
