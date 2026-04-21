// @ts-nocheck
/**
 * AudioWorkletProcessor for the Bacteria creative multi-effects framework.
 *
 * Uses the generated wasm-bindgen JS bindings (daw_dsp.js) via initSync so all
 * WASM memory management is handled by the generated glue — no manual malloc/free.
 *
 * Effect processor: reads from inputs[0], writes to outputs[0].
 */

import { initSync, BacteriaInstance } from '../wasm/daw_dsp.js';

/** Bacteria passes param names through as-is (Rust engine uses camelCase matching). */
const PARAM_MAP = {
    mix: 'mix',
    inputGain: 'inputGain',
    outputGain: 'outputGain',
    bypass: 'bypass',
    bandCount: 'bandCount',
    crossoverFreq1: 'crossoverFreq1',
    crossoverFreq2: 'crossoverFreq2',
    crossoverFreq3: 'crossoverFreq3',
    crossoverFreq4: 'crossoverFreq4',
    crossoverFreq5: 'crossoverFreq5',
    crossoverSlope: 'crossoverSlope',
    crossoverMode: 'crossoverMode',
    globalRouting: 'globalRouting',
    morphX: 'morphX',
    morphY: 'morphY',
    macro1: 'macro1',
    macro2: 'macro2',
    macro3: 'macro3',
    macro4: 'macro4',
    macro5: 'macro5',
    macro6: 'macro6',
    macro7: 'macro7',
    macro8: 'macro8',
    lfo1Rate: 'lfo1Rate',
    lfo1Shape: 'lfo1Shape',
    lfo1Amount: 'lfo1Amount',
    lfo2Rate: 'lfo2Rate',
    lfo2Shape: 'lfo2Shape',
    lfo2Amount: 'lfo2Amount',
    envFollowerAttack: 'envFollowerAttack',
    envFollowerRelease: 'envFollowerRelease',
    lorenzSigma: 'lorenzSigma',
    lorenzRho: 'lorenzRho',
    lorenzBeta: 'lorenzBeta',
    lorenzSpeed: 'lorenzSpeed',
};

class BacteriaProcessor extends AudioWorkletProcessor {
    _instance = null;
    _memory = null;
    _ready = false;
    _faulted = false;
    _meterCounter = 0;
    _sabView = null; // Float32Array view into the telemetry SharedArrayBuffer slot

    constructor() {
        super();
        this.port.onmessage = (event) => {
            const msg = event.data;
            try {
                if (msg.type === 'init') {
                    if (this._ready) {
                        return;
                    }
                    this._initWasm(msg.wasmBytes);
                } else if (msg.type === 'init-sab') {
                    this._sabView = new Float32Array(msg.sab, msg.byteOffset, 32);
                } else if (msg.type === 'param' && this._ready && !this._faulted) {
                    const rustName = PARAM_MAP[msg.name] ?? msg.name;
                    this._instance.set_param(rustName, msg.value);
                }
            } catch (error) {
                console.error('BacteriaProcessor error:', error);
            }
        };
    }

    _initWasm(wasmBytes) {
        const wasmExports = initSync({ module: new WebAssembly.Module(wasmBytes) });
        this._memory = wasmExports.memory;
        this._instance = new BacteriaInstance(sampleRate);
        this._ready = true;
        this.port.postMessage({ type: 'ready' });
    }

    _passthrough(input, output) {
        if (output[0] && input[0]) {
            output[0].set(input[0]);
        }
        if (output[1] && (input[1] ?? input[0])) {
            output[1].set(input[1] ?? input[0]);
        }
    }

    process(inputs, outputs) {
        if (!this._ready || this._faulted) {
            return true;
        }

        const input = inputs[0];
        const output = outputs[0];
        if (!input || input.length < 2 || !output || output.length < 2) {
            return true;
        }

        const frames = output[0].length;

        try {
            const inst = this._instance;
            const mem = this._memory.buffer;

            const inLeftPtr = inst.get_input_left_ptr();
            const inRightPtr = inst.get_input_right_ptr();
            new Float32Array(mem, inLeftPtr, frames).set(input[0]);
            new Float32Array(mem, inRightPtr, frames).set(input[1] ?? input[0]);

            const outLeftPtr = inst.process(frames);
            const outRightPtr = inst.get_right_ptr();

            output[0].set(new Float32Array(mem, outLeftPtr, frames));
            if (output[1]) {
                output[1].set(new Float32Array(mem, outRightPtr, frames));
            }

            this._meterCounter++;
            if (this._meterCounter >= 8) {
                this._meterCounter = 0;
                if (this._sabView) {
                    this._sabView[0] = inst.get_input_db();
                    this._sabView[1] = inst.get_output_db();
                    this._sabView[2] = inst.get_latency_samples();
                    // Blit the Rust engine's 6-element peak-level array directly into
                    // the SAB slot starting at index 3 (bandLevelsBase). Peak levels
                    // are linear amplitude; consumers convert to dB.
                    const bandPtr = inst.get_band_levels_ptr();
                    const bandView = new Float32Array(mem, bandPtr, 6);
                    this._sabView.set(bandView, 3);
                }
            }
        } catch (error) {
            this._faulted = true;
            this.port.postMessage({ type: 'error', message: String(error) });
            this._passthrough(input, output);
        }

        return true;
    }
}

registerProcessor('bacteria-processor', BacteriaProcessor);
