#!/usr/bin/env bash
# Carica OPENAI_API_KEY da SSM (senza stamparla) ed esegue la misura.
set -euo pipefail
REGION="${AWS_REGION:-eu-west-1}"
export OPENAI_API_KEY="$(aws ssm get-parameter --name /reading-intelligence/dev/openai-api-key --with-decryption --region "$REGION" --query 'Parameter.Value' --output text)"
node scripts/measure-unit-economics.mjs "$@"
