#!/usr/bin/env bash
# publish.sh <brand> <bucket> <distribution-id> [--dry-run]
#
# Uploads apps/website/dist/<brand>/ to the site bucket and invalidates CloudFront.
# Two sync passes with different cache lifetimes: HTML short (a fix must be visible in
# minutes), assets long (they change together with the HTML that references them).
# `--delete` removes files no longer generated, so a renamed page cannot linger.
set -euo pipefail
BRAND="${1:?brand}"; BUCKET="${2:?bucket}"; DIST_ID="${3:?distribution id}"; DRY="${4:-}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SRC="$ROOT/apps/website/dist/$BRAND"
[ -f "$SRC/index.html" ] || { echo "manca $SRC/index.html — esegui: node apps/website/generate-site.mjs $BRAND"; exit 1; }
FLAGS=(--only-show-errors --delete); [ "$DRY" = "--dry-run" ] && FLAGS+=(--dryrun)

aws s3 sync "$SRC" "s3://$BUCKET" "${FLAGS[@]}" --exclude '*' --include '*.html' \
  --content-type 'text/html; charset=utf-8' --cache-control 'public, max-age=300'
aws s3 sync "$SRC" "s3://$BUCKET" "${FLAGS[@]}" --exclude '*.html' \
  --cache-control 'public, max-age=31536000, immutable'

if [ "$DRY" != "--dry-run" ]; then
  INV=$(aws cloudfront create-invalidation --distribution-id "$DIST_ID" --paths '/*' --query 'Invalidation.Id' --output text)
  echo "pubblicato $BRAND -> s3://$BUCKET (invalidazione $INV)"
fi
