#!/usr/bin/env bash
# Pubblica i siti marketing: genera dai template + brand.json e carica su S3.
# NON modificare i file su S3 a mano — la fonte è apps/website/template/ + brands/<brand>/.
# Env override: SITE_ENV (default prod), SITE_BUCKET, SITE_PREFIX, AWS_REGION.
set -euo pipefail
ENV="${SITE_ENV:-prod}"; REGION="${AWS_REGION:-eu-west-1}"
BUCKET="${SITE_BUCKET:-lemonsqueezer-legal}"; PREFIX="${SITE_PREFIX:-sites}"
node apps/website/generate-site.mjs --all --env="$ENV"
for b in lemonsqueezer scout signal briefly nobull; do
  for page in landing pricing faq; do
    aws s3 cp "apps/website/dist/$b/$page.html" "s3://$BUCKET/$PREFIX/$b/$page.html" \
      --region "$REGION" --content-type "text/html; charset=utf-8" --cache-control "no-cache" >/dev/null
  done
done
echo "Pubblicato ($ENV) → https://$BUCKET.s3.$REGION.amazonaws.com/$PREFIX/<brand>/landing.html"
