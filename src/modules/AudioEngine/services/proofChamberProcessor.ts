// @ts-nocheck
/**
 * AudioWorkletProcessor for the ProofChamber reverb (Dutch Oven).
 *
 * Uses the generated wasm-bindgen JS bindings (proof_chamber.js) via initSync so all
 * WASM memory management is handled by the generated glue — no manual malloc/free.
 *
 * Effect processor: reads from inputs[0], writes to outputs[0].
 *
 * Messages from main thread:
 *   { type: 'init', wasmBytes: ArrayBuffer }
 *   { type: 'param', name, value }
 *   { type: 'bypass', bypassed }
 */

import '../wasm/workletPolyfill.js';
import { initSync, ProofChamberInstance } from '../wasm/proof_chamber.js';

class ProofChamberProcessor extends AudioWorkletProcessor {
    _instance = null; // ProofChamberInstance (generated wasm-bindgen class)
    _memory = null; // WebAssembly.Memory
    _ready = false;
    _faulted = false;
    _bypassed = false;

    constructor() {
        super();
        this.port.onmessage = (e) => {
            const msg = e.data;
            try {
                if (msg.type === 'init') {
                    if (this._ready) {return;}
                    this._initWasm(msg.wasmBytes);
                } else if (msg.type === 'bypass') {
                    this._bypassed = msg.bypassed;
                } else if (msg.type === 'param' && this._ready && !this._faulted) {
                    this._instance.set_param(msg.name, msg.value);
                }
            } catch (err) {
                console.error('ProofChamberProcessor error:', err);
                if (!this._ready) {
                    this.port.postMessage({ type: 'error', message: err?.message ?? String(err) });
                }
            }
        };
    }

    _initWasm(wasmBytes) {
        const wasmExports = initSync({ module: new WebAssembly.Module(wasmBytes) });
        this._memory = wasmExports.memory;
        this._instance = new ProofChamberInstance(sampleRate);
        this._ready = true;
        this.port.postMessage({ type: 'ready' });
    }

    _passthrough(input, output) {
        for (let ch = 0; ch < Math.min(input.length, output.length); ch++) {
            if (input[ch] && output[ch]) {output[ch].set(input[ch]);}
        }
    }

    process(inputs, outputs) {
        const input = inputs[0];
        const output = outputs[0];

        if (!this._ready || this._bypassed || this._faulted) {
            if (input && output) {this._passthrough(input, output);}
            return true;
        }

        if (!input || input.length < 2 || !output || output.length < 2) {return true;}

        const frames = input[0].length;

        try {
            // process() takes Float32Array inputs directly — no manual malloc needed
            const leftPtr = this._instance.process(input[0], input[1] ?? input[0], frames);
            const rightPtr = this._instance.get_right_ptr();

            const mem = this._memory.buffer;
            output[0].set(new Float32Array(mem, leftPtr, frames));
            output[1].set(new Float32Array(mem, rightPtr, frames));
        } catch (err) {
            this._faulted = true;
            this.port.postMessage({ type: 'error', message: String(err) });
            this._passthrough(input, output);
        }

        return true;
    }
}

registerProcessor('proof-chamber-processor', ProofChamberProcessor);
