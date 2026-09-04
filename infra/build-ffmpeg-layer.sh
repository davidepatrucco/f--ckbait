#!/usr/bin/env bash
# Costruisce e pubblica il layer Lambda con ffmpeg statico, usato dal worker di
# trascrizione asincrona (video lunghi / HLS) come /opt/bin/ffmpeg.
#
#   bash infra/build-ffmpeg-layer.sh [region]
#
# Stampa l'ARN della nuova versione: va passato al deploy come parametro
# FfmpegLayerArn (vedi .github/workflows/deploy-backend.yml). Idempotente: ogni
# esecuzione pubblica una nuova versione, le precedenti restano utilizzabili.
#
# Nota: il binario è un build statico di terze parti (johnvansickle.com, la
# distribuzione consigliata da ffmpeg.org per Linux). Architettura x86_64, coerente
# con Globals.Architectures del template SAM.
set -euo pipefail

REGION="${1:-eu-west-1}"
LAYER_NAME="reading-intelligence-ffmpeg"
URL="https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "→ download ffmpeg statico"
curl -sL -o "$WORK/ff.tar.xz" "$URL"

echo "→ estrazione del solo binario"
mkdir -p "$WORK/extract" "$WORK/layer/bin"
tar -xJf "$WORK/ff.tar.xz" -C "$WORK/extract"
cp "$WORK"/extract/*/ffmpeg "$WORK/layer/bin/ffmpeg"
chmod 755 "$WORK/layer/bin/ffmpeg"

# Verifica: deve essere un ELF x86-64 statico (Lambda non ha librerie di sistema).
file "$WORK/layer/bin/ffmpeg" | grep -q "ELF 64-bit" || { echo "✗ binario non ELF 64-bit"; exit 1; }
file "$WORK/layer/bin/ffmpeg" | grep -q "statically linked" || { echo "✗ binario non statico"; exit 1; }

echo "→ zip"
(cd "$WORK/layer" && zip -q -r -X ../ffmpeg-layer.zip bin)

echo "→ publish-layer-version ($REGION)"
ARN=$(aws lambda publish-layer-version \
    --layer-name "$LAYER_NAME" \
    --description "Static ffmpeg (amd64) at /opt/bin/ffmpeg for async transcription worker" \
    --zip-file "fileb://$WORK/ffmpeg-layer.zip" \
    --compatible-runtimes nodejs20.x nodejs22.x \
    --compatible-architectures x86_64 \
    --region "$REGION" \
    --query 'LayerVersionArn' --output text)

echo "✓ layer pubblicato: $ARN"
echo ""
echo "Passalo al deploy come parametro FfmpegLayerArn, es.:"
echo "  sam deploy --parameter-overrides FfmpegLayerArn=$ARN ..."
