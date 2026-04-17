#!/usr/bin/env bash
#
# One-shot script: export MIDI-DDSP decoder to ONNX and upload to HuggingFace.
#
# Usage:
#   bash scripts/setup-ddsp-model.sh
#
set -euo pipefail

VENV_DIR="/tmp/ddsp-export-venv"
WORK_DIR="/tmp/ddsp-export-work"
HF_REPO="jcosta33/vocoder-models"
HF_PATH="ddsp-decoder/ddsp_decoder.onnx"

echo "=== DDSP Model Export ==="
echo ""

# 1. Find a compatible Python (TensorFlow requires 3.10-3.12; 3.11 is safest on arm64)
PYTHON=""
for candidate in python3.11 python3.12 python3.10; do
    if command -v "$candidate" &>/dev/null; then
        PYTHON="$candidate"
        break
    fi
done
if [ -z "$PYTHON" ]; then
    echo "Error: TensorFlow requires Python 3.10-3.12 (does NOT support 3.13+)."
    echo "Install with: brew install python@3.11"
    exit 1
fi
echo "1/5  Creating Python venv ($PYTHON)…"
"$PYTHON" -m venv "$VENV_DIR"
source "$VENV_DIR/bin/activate"

# 2. Install dependencies
# Both ddsp and midi-ddsp depend on crepe (pitch detection) which fails to
# build and we don't need — we only use the synthesis decoder. Install them
# without deps, then manually install the deps we actually need.
echo "2/5  Installing dependencies…"
pip install --quiet tensorflow tf2onnx onnx numpy scipy
pip install --quiet --no-deps ddsp midi-ddsp

# 3. Download pretrained MIDI-DDSP model
echo "3/5  Downloading pretrained MIDI-DDSP weights…"
python3 -c "from midi_ddsp.utils.midi_synthesis_utils import download_model; download_model()"

# 4. Export to ONNX
echo "4/5  Exporting decoder to ONNX…"
mkdir -p "$WORK_DIR"

python3 - <<'PYTHON'
import sys, os
sys.path.insert(0, os.getcwd())

import numpy as np
import tensorflow as tf
import tf2onnx
import onnx

from midi_ddsp.utils.midi_synthesis_utils import load_pretrained_model

print("  Loading model…")
synthesis_generator, _ = load_pretrained_model()
if synthesis_generator is None:
    print("ERROR: Could not load model. Run: midi_ddsp_download_model")
    sys.exit(1)

# Build a concrete TF function for just the decoder
N = 250  # frames (1 second at 250 Hz)

@tf.function(input_signature=[
    tf.TensorSpec([1, None], tf.float32, name='f0_hz'),
    tf.TensorSpec([1, None], tf.float32, name='loudness_db'),
    tf.TensorSpec([1], tf.int32, name='instrument_id'),
])
def decoder(f0_hz, loudness_db, instrument_id):
    seq_len = tf.shape(f0_hz)[1]
    inst = tf.one_hot(instrument_id, 13)
    inst = tf.tile(tf.expand_dims(inst, 1), [1, seq_len, 1])
    f0 = tf.expand_dims(f0_hz, -1)
    ld = tf.expand_dims(loudness_db, -1)
    cond = tf.concat([f0, ld, inst], axis=-1)
    out = synthesis_generator.decode(cond, f0_hz)
    return {
        'amplitudes': out['amplitudes'],
        'harmonic_distribution': out['harmonic_distribution'],
        'noise_magnitudes': out['noise_magnitudes'],
    }

print("  Tracing function…")
cf = decoder.get_concrete_function(
    tf.constant(np.full((1, N), 440.0, dtype=np.float32)),
    tf.constant(np.full((1, N), -30.0, dtype=np.float32)),
    tf.constant([0], dtype=np.int32),
)

saved_dir = '/tmp/ddsp-export-work/saved_model'
tf.saved_model.save(synthesis_generator, saved_dir, signatures={'serving_default': cf})

print("  Converting to ONNX…")
out_path = '/tmp/ddsp-export-work/ddsp_decoder.onnx'
tf2onnx.convert.from_saved_model(
    saved_dir,
    output_path=out_path,
)

model = onnx.load(out_path)
onnx.checker.check_model(model)
size = os.path.getsize(out_path)
print(f"  OK: {size / 1024 / 1024:.1f} MB")
print(f"  Inputs:  {[i.name for i in model.graph.input]}")
print(f"  Outputs: {[o.name for o in model.graph.output]}")

with open('/tmp/ddsp-export-work/size.txt', 'w') as f:
    f.write(str(size))
PYTHON

ONNX_FILE="$WORK_DIR/ddsp_decoder.onnx"
ONNX_SIZE=$(cat "$WORK_DIR/size.txt")

if [ ! -f "$ONNX_FILE" ]; then
    echo "ERROR: ONNX export failed"
    exit 1
fi

# 5. Upload to HuggingFace
echo "5/5  Uploading to HuggingFace ($HF_REPO)…"
hf upload "$HF_REPO" "$ONNX_FILE" "$HF_PATH" --repo-type model

echo ""
echo "=== Done ==="
echo ""
echo "Update src/modules/BrowserAi/models/ddspInstrumentCatalog.ts:"
echo ""
echo "  export const DDSP_MODEL_SIZE_BYTES = ${ONNX_SIZE};"
echo ""
echo "Cleaning up venv…"
deactivate
rm -rf "$VENV_DIR"
echo "Done."
