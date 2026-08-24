#!/usr/bin/env bash
# Estende il ruolo OIDC di deploy (lemonsqueezer-github-deploy) per la pipeline
# multi-ambiente:
#  1) trust policy: aggiunge i subject GitHub environment:staging / environment:production
#     (mantenendo ref:refs/heads/main per dev), altrimenti l'assume-role dai job
#     staging/prod fallisce (il claim `sub` cambia quando un job usa `environment:`).
#  2) permission policy: allarga gli ARN dei ruoli Lambda da `-dev-` a `-*-`
#     (dev/staging/prod), cosi' CloudFormation puo' aggiornare i ruoli per-ambiente.
# Idempotente. Richiede permessi IAM (utente admin).
set -euo pipefail
ROLE="lemonsqueezer-github-deploy"
DIR="$(cd "$(dirname "$0")" && pwd)/iam"
aws iam update-assume-role-policy --role-name "$ROLE" \
  --policy-document "file://$DIR/deploy-role-trust.json"
aws iam put-role-policy --role-name "$ROLE" \
  --policy-name LemonSqueezerSummaryRoleDeploy \
  --policy-document "file://$DIR/deploy-role-permissions.json"
echo "OK — trust + permission policy aggiornate su $ROLE"
