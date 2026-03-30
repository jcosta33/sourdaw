/**
 * Native Plugin Bridge Processor — ring-buffer audio bridge via MessagePort.
 *
 * Sends audio blocks to the main thread, which forwards to Rust via Tauri IPC.
 * The Rust audio thread processes through the CLAP/VST3 plugin and returns
 * the output via the same path.
 *
 * Latency: 1 audio block (128 samples ≈ 2.67ms at 48kHz).
 * The worklet reads the PREVIOUS block's output while sending the current input.
 */

class NativePluginBridgeProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.ready = false;
        this.lastOutputL = null;
        this.lastOutputR = null;
        this.enginePluginId = 0;

        this.port.onmessage = (event) => {
            if (event.data.type === 'init') {
                this.enginePluginId = event.data.enginePluginId;
                this.ready = true;
            } else if (event.data.type === 'processed') {
                // Received processed audio back from Rust
                const data = event.data.audio;
                const numSamples = data.length / 2;
                this.lastOutputL = new Float32Array(numSamples);
                this.lastOutputR = new Float32Array(numSamples);
                for (let i = 0; i < numSamples; i++) {
                    this.lastOutputL[i] = data[i * 2];
                    this.lastOutputR[i] = data[i * 2 + 1];
                }
            }
        };
    }

    process(inputs, outputs) {
        const input = inputs[0];
        const output = outputs[0];
        if (!input || !output || input.length < 1) return true;

        const frames = input[0].length;

        if (!this.ready) {
            // Passthrough while not initialized
            for (let ch = 0; ch < input.length && ch < output.length; ch++) {
                output[ch].set(input[ch]);
            }
            return true;
        }

        // Write the PREVIOUS block's processed output
        if (this.lastOutputL && this.lastOutputL.length >= frames) {
            output[0].set(this.lastOutputL.subarray(0, frames));
            if (output[1]) {
                output[1].set(this.lastOutputR.subarray(0, frames));
            }
        } else {
            // No output yet (first block) — passthrough
            for (let ch = 0; ch < input.length && ch < output.length; ch++) {
                output[ch].set(input[ch]);
            }
        }

        // Interleave current input and send to main thread for Rust processing
        const interleaved = new Float32Array(frames * 2);
        const left = input[0];
        const right = input[1] ?? input[0];
        for (let i = 0; i < frames; i++) {
            interleaved[i * 2] = left[i];
            interleaved[i * 2 + 1] = right[i];
        }

        this.port.postMessage(
            { type: 'process', audio: interleaved.buffer },
            [interleaved.buffer] // Transfer ownership for zero-copy
        );

        return true;
    }
}

registerProcessor('native-plugin-bridge-processor', NativePluginBridgeProcessor);
