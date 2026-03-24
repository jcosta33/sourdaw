// @ts-nocheck
/**
 * Legacy AudioCoreProcessor — kept for backward compat.
 *
 * The original sine-wave test WasmAudioProcessor has been replaced by
 * the multi-plugin WasmPluginInstance architecture. This processor now
 * simply passes audio through (no-op). Real DSP is handled by
 * nativeDspProcessor.ts.
 */

class AudioCoreProcessor extends AudioWorkletProcessor {
    process(_inputs, outputs, _parameters) {
        // No-op passthrough — actual DSP is via native-dsp-processor
        return true;
    }
}

registerProcessor('audio-core-processor', AudioCoreProcessor);
