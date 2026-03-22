// @ts-nocheck
import init, { WasmAudioProcessor } from '../wasm/audio_core.js';

class AudioCoreProcessor extends AudioWorkletProcessor {
    processor: WasmAudioProcessor | null = null;
    wasmMemory: WebAssembly.Memory | null = null;
    isInitialized: boolean = false;

    constructor() {
        super();
        this.port.onmessage = async (e) => {
            if (e.data.type === 'init') {
                try {
                    // Initialize the WASM module using the URL provided by the main thread
                    const wasm = await init(e.data.wasmUrl);
                    this.wasmMemory = wasm.memory;
                    
                    // Create the Rust Audio Processor
                    // Note: sampleRate is a global variable inside AudioWorkletGlobalScope
                    this.processor = new WasmAudioProcessor(sampleRate);
                    this.isInitialized = true;
                    
                    this.port.postMessage({ type: 'ready' });
                } catch (err) {
                    console.error('AudioCoreProcessor initialization failed:', err);
                }
            }
        };
    }

    process(_inputs: Float32Array[][], outputs: Float32Array[][], _parameters: Record<string, Float32Array>) {
        if (!this.isInitialized || !this.processor || !this.wasmMemory) {
            // Keep the processor alive but silent until WASM loads
            return true;
        }

        const output = outputs[0];
        if (!output || output.length === 0) return true;

        const outChannel = output[0];
        if (!outChannel) return true;

        const frames = outChannel.length;

        // Process a block in Rust, returning the pointer to the internal output buffer
        const ptr = this.processor.process_and_get_ptr(frames);

        // Map the WASM memory buffer to a JS Float32Array view
        const wasmOutView = new Float32Array(this.wasmMemory.buffer, ptr, frames);

        // Copy the processed data from WASM into all channels of the output
        for (let channel = 0; channel < output.length; channel++) {
            output[channel]!.set(wasmOutView);
        }

        return true;
    }
}

registerProcessor('audio-core-processor', AudioCoreProcessor);
