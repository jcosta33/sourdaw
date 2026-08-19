const BYTES_PER_SAMPLE = 4; // Float32

class NativePluginHostProcessor extends AudioWorkletProcessor {
    instanceId = '';
    isReady = false;
    hasError = false;
    lastProcessedBuffer = null;

    constructor() {
        super();
        this.port.onmessage = (event) => {
            if (event.data.type === 'init') {
                this.instanceId = event.data.instanceId;
                this.isReady = true;
            } else if (event.data.type === 'processed') {
                // Buffer received back from Rust via main thread
                // In a production system this goes into a ring buffer.
                // For MVP, we store the latest returned frame.
                this.lastProcessedBuffer = new Float32Array(event.data.buffer);
            }
        };
    }

    process(inputs, outputs, parameters) {
        if (!this.isReady || this.hasError) {
            // Passthrough if not initialized
            const input = inputs[0];
            const output = outputs[0];
            if (input && output) {
                for (let channel = 0; channel < input.length; ++channel) {
                    if (output[channel]) {
                        output[channel].set(input[channel]);
                    }
                }
            }
            return true;
        }

        const inputBuffer = inputs[0];
        const outputBuffer = outputs[0];

        if (!inputBuffer || inputBuffer.length === 0) return true;

        const numChannels = inputBuffer.length;
        const numSamples = inputBuffer[0].length;

        // Flatten the multi-channel float32 array into a single 1D buffer to send to Rust
        const flatInput = new Float32Array(numChannels * numSamples);
        for (let ch = 0; ch < numChannels; ch++) {
            flatInput.set(inputBuffer[ch], ch * numSamples);
        }

        // Send over the port. The main thread owns the desktop IPC hop —
        // worklets have no access to the desktop bridge.
        this.port.postMessage(
            {
                type: 'process',
                instanceId: this.instanceId,
                channels: numChannels,
                samples: numSamples,
                buffer: flatInput.buffer,
            },
            [flatInput.buffer] // transfer ownership for performance
        );

        // If we have a previously processed buffer from Rust, write it out
        if (this.lastProcessedBuffer && this.lastProcessedBuffer.length === numChannels * numSamples) {
            for (let ch = 0; ch < numChannels; ch++) {
                const outCh = outputBuffer[ch];
                if (outCh) {
                    const startIdx = ch * numSamples;
                    outCh.set(this.lastProcessedBuffer.subarray(startIdx, startIdx + numSamples));
                }
            }
        } else {
            // Fallback to passthrough if rust hasn't responded yet (latency gap)
            for (let ch = 0; ch < numChannels; ch++) {
                if (outputBuffer[ch] && inputBuffer[ch]) {
                    outputBuffer[ch].set(inputBuffer[ch]);
                }
            }
        }

        return true;
    }
}

registerProcessor('native-plugin-host-processor', NativePluginHostProcessor);
