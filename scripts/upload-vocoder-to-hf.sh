#!/usr/bin/env bash
#
# Upload the NSF-HiFiGAN vocoder ONNX model to HuggingFace.
#
# This is a one-time script. After running it, update NSF_HIFIGAN_URL in
# src/modules/BrowserAi/models/ddspInstrumentCatalog.ts with the new URL.
#
# Prerequisites:
#   pip install huggingface-hub    # or: brew install huggingface
#   hf login                       # paste your HF write token
#
# Usage:
#   bash scripts/upload-vocoder-to-hf.sh <hf-repo>
#
# Example:
#   bash scripts/upload-vocoder-to-hf.sh sourdaw/models
#
# The script will:
#   1. Download the .oudep (ZIP) from GitHub releases
#   2. Extract the .onnx file
#   3. Upload to HuggingFace at <hf-repo>/nsf-hifigan-44k/model.onnx
#   4. Print the final URL to paste into ddspInstrumentCatalog.ts
#

set -euo pipefail

GITHUB_URL="https://github.com/openvpi/vocoders/releases/download/nsf-hifigan-44.1k-hop512-128bin-2024.02/nsf_hifigan_44.1k_hop512_128bin_2024.02_logE.oudep"
ONNX_FILENAME="nsf_hifigan_44.1k_hop512_128bin_2024.02.onnx"
HF_REPO="${1:-}"

if [ -z "$HF_REPO" ]; then
    echo "Usage: bash scripts/upload-vocoder-to-hf.sh <hf-repo>"
    echo "Example: bash scripts/upload-vocoder-to-hf.sh sourdaw/models"
    exit 1
fi

TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

echo "1/4  Downloading .oudep from GitHub releases…"
curl -L --progress-bar -o "$TMPDIR/vocoder.oudep" "$GITHUB_URL"

echo "2/4  Extracting ONNX from ZIP…"
unzip -q -o "$TMPDIR/vocoder.oudep" -d "$TMPDIR/extracted"

ONNX_PATH=$(find "$TMPDIR/extracted" -name "*.onnx" -print -quit)
if [ -z "$ONNX_PATH" ]; then
    echo "Error: No .onnx file found in the archive"
    exit 1
fi

ONNX_SIZE=$(stat -f%z "$ONNX_PATH" 2>/dev/null || stat -c%s "$ONNX_PATH" 2>/dev/null)
echo "   Found: $(basename "$ONNX_PATH") ($ONNX_SIZE bytes)"

echo "3/4  Uploading to HuggingFace: $HF_REPO …"
hf upload "$HF_REPO" "$ONNX_PATH" "nsf-hifigan-44k/$ONNX_FILENAME" --repo-type model

HF_URL="https://huggingface.co/${HF_REPO}/resolve/main/nsf-hifigan-44k/${ONNX_FILENAME}"

echo ""
echo "4/4  Done! Update ddspInstrumentCatalog.ts with:"
echo ""
echo "  export const NSF_HIFIGAN_URL ="
echo "      '${HF_URL}';"
echo ""
echo "  export const NSF_HIFIGAN_SIZE_BYTES = ${ONNX_SIZE};"
echo ""
echo "Then remove api/proxy-model.ts and the resolveDownloadUrl function"
echo "from modelDownloadManager.ts — the proxy is no longer needed."
