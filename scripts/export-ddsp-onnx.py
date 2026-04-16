#!/usr/bin/env python3
"""
Export the MIDI-DDSP synthesis decoder to ONNX.

This extracts only the parameter prediction MLP from MIDI-DDSP — the part that
maps (f0_hz, loudness_db, instrument_id) to (amplitudes, harmonic_distribution,
noise_magnitudes). The actual audio synthesis is done in TypeScript (pure DSP).

Prerequisites:
    pip install midi-ddsp tensorflow tf2onnx onnx

Usage:
    python scripts/export-ddsp-onnx.py
    # Produces: ddsp_decoder.onnx

Then upload:
    hf upload jcosta33/vocoder-models ddsp_decoder.onnx ddsp-decoder/ddsp_decoder.onnx --repo-type model
"""

import numpy as np
import tensorflow as tf
import tf2onnx
import onnx
import os

def export_ddsp_decoder():
    """Export MIDI-DDSP SynthesisGenerator decoder to ONNX."""

    try:
        from midi_ddsp.utils.midi_synthesis_utils import load_pretrained_model
    except ImportError:
        print("midi-ddsp not installed. Install with: pip install midi-ddsp")
        print("Then run: midi_ddsp_download_model")
        return

    # Load pretrained MIDI-DDSP model
    print("1/4  Loading pretrained MIDI-DDSP model...")
    synthesis_generator, expression_generator = load_pretrained_model()

    if synthesis_generator is None:
        print("Error: Could not load pretrained model.")
        print("Run: midi_ddsp_download_model")
        return

    # The SynthesisGenerator maps (f0_hz, loudness_db, instrument_id) to
    # DDSP synthesis parameters. We need to trace it as a concrete function.
    print("2/4  Building concrete function for decoder...")

    n_frames = 250  # 1 second at 250 Hz frame rate (variable, but export with fixed shape)

    @tf.function(input_signature=[
        tf.TensorSpec(shape=[1, None], dtype=tf.float32, name='f0_hz'),
        tf.TensorSpec(shape=[1, None], dtype=tf.float32, name='loudness_db'),
        tf.TensorSpec(shape=[1], dtype=tf.int32, name='instrument_id'),
    ])
    def decoder_fn(f0_hz, loudness_db, instrument_id):
        # Get batch size and sequence length
        batch_size = tf.shape(f0_hz)[0]
        seq_len = tf.shape(f0_hz)[1]

        # One-hot encode instrument ID (13 instruments)
        instrument_one_hot = tf.one_hot(instrument_id, depth=13)  # [1, 13]
        instrument_one_hot = tf.tile(
            tf.expand_dims(instrument_one_hot, 1),
            [1, seq_len, 1]
        )  # [1, N, 13]

        # Expand dims for the synthesis generator
        f0 = tf.expand_dims(f0_hz, -1)  # [1, N, 1]
        ld = tf.expand_dims(loudness_db, -1)  # [1, N, 1]

        # Concatenate inputs
        conditioning = tf.concat([f0, ld, instrument_one_hot], axis=-1)  # [1, N, 15]

        # Run through the synthesis generator's decoder layers
        # The decoder predicts: amplitudes (1), harmonic_distribution (100), noise_magnitudes (65)
        outputs = synthesis_generator.decode(conditioning, f0_hz)

        return {
            'amplitudes': outputs['amplitudes'],  # [1, N, 1]
            'harmonic_distribution': outputs['harmonic_distribution'],  # [1, N, 100]
            'noise_magnitudes': outputs['noise_magnitudes'],  # [1, N, 65]
        }

    # Export to SavedModel first
    print("3/4  Exporting to SavedModel...")
    saved_model_dir = '/tmp/ddsp_decoder_saved_model'

    # Create concrete function with example inputs for tracing
    example_f0 = tf.constant(np.full((1, n_frames), 440.0, dtype=np.float32))
    example_ld = tf.constant(np.full((1, n_frames), -30.0, dtype=np.float32))
    example_id = tf.constant([0], dtype=tf.int32)

    concrete_fn = decoder_fn.get_concrete_function(example_f0, example_ld, example_id)

    tf.saved_model.save(
        synthesis_generator,
        saved_model_dir,
        signatures={'serving_default': concrete_fn}
    )

    # Convert SavedModel to ONNX
    print("4/4  Converting to ONNX...")
    output_path = 'ddsp_decoder.onnx'

    model_proto, _ = tf2onnx.convert.from_saved_model(
        saved_model_dir,
        input_signature=[
            tf.TensorSpec(shape=[1, None], dtype=tf.float32, name='f0_hz'),
            tf.TensorSpec(shape=[1, None], dtype=tf.float32, name='loudness_db'),
            tf.TensorSpec(shape=[1], dtype=tf.int32, name='instrument_id'),
        ],
        output_path=output_path,
    )

    # Verify
    model = onnx.load(output_path)
    onnx.checker.check_model(model)

    file_size = os.path.getsize(output_path)
    print(f"\nDone! Exported: {output_path} ({file_size / 1024 / 1024:.1f} MB)")
    print(f"\nInputs: {[inp.name for inp in model.graph.input]}")
    print(f"Outputs: {[out.name for out in model.graph.output]}")
    print(f"\nUpload with:")
    print(f"  hf upload jcosta33/vocoder-models {output_path} ddsp-decoder/ddsp_decoder.onnx --repo-type model")
    print(f"\nThen update DDSP_MODEL_SIZE_BYTES in ddspInstrumentCatalog.ts to: {file_size}")


if __name__ == '__main__':
    export_ddsp_decoder()
