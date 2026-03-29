// @ts-nocheck
/**
 * AudioWorkletProcessor for Knead Real-Time Pitch Correction.
 * Hosts the `KneadEngine` WASM binary to perform YIN pitch-tracking
 * and PSOLA pitch-shifting natively in the Web browser Graph.
 */
import init, { KneadEngine } from '../wasm/audio_core.js';

class KneadProcessor extends AudioWorkletProcessor {
    engine = null;
    wasmMemory = null;
    isInitialized = false;
    _bypassed = false;

    constructor() {
        super();
        this.port.onmessage = async (e) => {
            const { type } = e.data;
            if (type === 'init') {
                try {
                    const initSource = e.data.wasmBytes
                        ? new WebAssembly.Module(e.data.wasmBytes)
                        : e.data.wasmUrl;
                    
                    const wasm = await init(initSource);
                    this.wasmMemory = wasm.memory;
                    this.engine = new KneadEngine(sampleRate);
                    this.isInitialized = true;
                    
                    this.port.postMessage({ type: 'ready' });
                } catch (error) {
                    console.error('KneadProcessor init failed:', error);
                    this.port.postMessage({ type: 'error', message: String(error) });
                }
            } else if (type === 'set_bypass') {
                this._bypassed = e.data.bypassed;
            }
            // Add param updates here if we route dynamic Knead knobs
        };
    }

    process(inputs, outputs, _parameters) {
        if (!this.isInitialized || !this.engine || !this.wasmMemory) {
            return true;
        }

        const input = inputs[0];
        const output = outputs[0];
        if (!input || !output || input.length < 1 || output.length < 1) {
            return true;
        }

        const frames = input[0].length;
        const inLeft = input[0];
        
        if (this._bypassed) {
            output[0].set(inLeft);
            if (output[1] && input[1]) {
                output[1].set(input[1]);
            }
            return true;
        }

        // We use the WASM instance to process
        // Knead is primarily mono-pitch detection, so we operate on the left channel.
        const outPtr = this.engine.process_block(inLeft, frames);

        // Map WASM memory to JS views
        const leftOut = new Float32Array(this.wasmMemory.buffer, outPtr, frames);

        // Copy to output
        output[0].set(leftOut);
        if (output[1]) {
            // Mono to stereo expansion
            output[1].set(leftOut);
        }

        return true;
    }
}

registerProcessor('knead-processor', KneadProcessor);
