#!/usr/bin/env bash
#
# Download the SPORE DiffSinger voicebank from GitHub and upload ONNX files to HuggingFace.
#
# Usage:
#   bash scripts/upload-voicebank-to-hf.sh
#
set -euo pipefail

HF_REPO="jcosta33/vocoder-models"
SPORE_URL="https://github.com/knoxstation/SPORE/releases/download/v.0.1.1/SPORE011.zip"
WORK="/tmp/voicebank-upload"

mkdir -p "$WORK"

echo "1/3  Downloading SPORE voicebank (~300 MB)…"
curl -L --progress-bar -o "$WORK/spore.zip" "$SPORE_URL"

echo "2/3  Extracting ONNX files…"
unzip -q -o "$WORK/spore.zip" -d "$WORK/extracted"

# Find all ONNX files
echo "   Found ONNX files:"
find "$WORK/extracted" -name "*.onnx" | while read f; do
    size=$(stat -f%z "$f" 2>/dev/null || stat -c%s "$f" 2>/dev/null)
    echo "   $(basename "$f"): $((size / 1024 / 1024)) MB"
done

echo "3/3  Uploading to HuggingFace ($HF_REPO)…"

# Upload each ONNX to a structured path
VOICEBANK_ID="spore"
for onnx in "$WORK"/extracted/*/dsmain/acoustic.onnx; do
    hf upload "$HF_REPO" "$onnx" "diffsinger/$VOICEBANK_ID/acoustic.onnx" --repo-type model
done
for onnx in "$WORK"/extracted/*/dsmain/linguistic.onnx; do
    hf upload "$HF_REPO" "$onnx" "diffsinger/$VOICEBANK_ID/linguistic.onnx" --repo-type model
done
for onnx in "$WORK"/extracted/*/dsdur/dur.onnx; do
    hf upload "$HF_REPO" "$onnx" "diffsinger/$VOICEBANK_ID/dur.onnx" --repo-type model
done
for onnx in "$WORK"/extracted/*/dspitch/pitch.onnx; do
    hf upload "$HF_REPO" "$onnx" "diffsinger/$VOICEBANK_ID/pitch.onnx" --repo-type model
done
for onnx in "$WORK"/extracted/*/dsvariance/variance.onnx; do
    hf upload "$HF_REPO" "$onnx" "diffsinger/$VOICEBANK_ID/variance.onnx" --repo-type model
done

HF_BASE="https://huggingface.co/$HF_REPO/resolve/main/diffsinger/$VOICEBANK_ID"

echo ""
echo "=== Done ==="
echo ""
echo "Voicebank uploaded. URLs:"
echo "  acoustic:   $HF_BASE/acoustic.onnx"
echo "  linguistic: $HF_BASE/linguistic.onnx"
echo "  dur:        $HF_BASE/dur.onnx"
echo "  pitch:      $HF_BASE/pitch.onnx"
echo "  variance:   $HF_BASE/variance.onnx"
