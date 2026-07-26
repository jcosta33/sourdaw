/**
 * Native Plugin Bridge Processor — ring-buffer audio bridge via MessagePort.
 *
 * Sends audio blocks to the main thread as raw bytes (Uint8Array), which
 * forwards to Rust via Tauri IPC. Processed output returns the same way.
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

        this.port.onmessage = (event) => {
            if (event.data.type === 'init') {
                // No plugin identity here: the main-thread relay resolves the
                // instance. The worklet only needs to know it may start.
                this.ready = true;
            } else if (event.data.type === 'processed') {
                // Decode raw bytes back to f32 samples
                const bytes = new Uint8Array(event.data.audio);
                const view = new DataView(bytes.buffer);
                const numSamples = bytes.byteLength / 8; // 4 bytes L + 4 bytes R per frame
                this.lastOutputL = new Float32Array(numSamples);
                this.lastOutputR = new Float32Array(numSamples);
                for (let i = 0; i < numSamples; i++) {
                    this.lastOutputL[i] = view.getFloat32(i * 8, true); // little-endian
                    this.lastOutputR[i] = view.getFloat32(i * 8 + 4, true);
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

        // Encode current input as raw bytes and send to main thread
        const left = input[0];
        const right = input[1] ?? input[0];
        const bytes = new Uint8Array(frames * 8); // 4 bytes L + 4 bytes R per frame
        const view = new DataView(bytes.buffer);
        for (let i = 0; i < frames; i++) {
            view.setFloat32(i * 8, left[i], true); // little-endian
            view.setFloat32(i * 8 + 4, right[i], true);
        }

        this.port.postMessage({ type: 'process', audio: bytes.buffer }, [bytes.buffer]);

        return true;
    }
}

registerProcessor('native-plugin-bridge-processor', NativePluginBridgeProcessor);
