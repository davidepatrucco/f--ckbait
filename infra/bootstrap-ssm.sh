#!/usr/bin/env bash
# bootstrap-ssm.sh — inizializza i parametri SSM di staging e prod copiandoli da dev.
# jwt-secret è rigenerato fresco per ambiente (isolamento chiavi di firma).
# NON stampa mai valori di parametri. Idempotente (--overwrite).
#
# Nota: stripe-webhook-secret e stripe-*-url copiati come PLACEHOLDER: il webhook
# secret reale va rigenerato quando si crea l'endpoint webhook Stripe per quell'env
# (dipende dalla Function URL, nota solo dopo il primo deploy). In prod resta TEST-mode
# finché non si passa a Stripe LIVE (E18-005).
set -euo pipefail

REGION="${AWS_REGION:-eu-west-1}"
SRC="/reading-intelligence/dev"
TARGETS=("staging" "prod")

names=$(aws ssm get-parameters-by-path --path "$SRC" --recursive --region "$REGION" \
  --query 'Parameters[].Name' --output text)

for env in "${TARGETS[@]}"; do
  echo "== bootstrap /reading-intelligence/$env =="
  for full in $names; do
    leaf="${full##*/}"
    type=$(aws ssm get-parameter --name "$full" --region "$REGION" \
      --query 'Parameter.Type' --output text)
    dst="/reading-intelligence/$env/$leaf"

    if [ "$leaf" = "jwt-secret" ]; then
      # chiave di firma nuova per ambiente (mai riusare quella dev)
      val=$(openssl rand -hex 48)
    else
      val=$(aws ssm get-parameter --name "$full" --with-decryption --region "$REGION" \
        --query 'Parameter.Value' --output text)
    fi

    aws ssm put-parameter --name "$dst" --type "$type" --value "$val" \
      --overwrite --region "$REGION" >/dev/null
    unset val
    echo "  set $dst ($type)"
  done
done
echo "OK — SSM staging + prod inizializzati (valori non stampati)"
