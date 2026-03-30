// @ts-nocheck
/**
 * AudioWorkletProcessor for the Bacteria creative multi-effects framework.
 *
 * Effect processor: reads from inputs[0], writes to outputs[0].
 * Calls raw wasm-bindgen WASM exports directly.
 */

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
    _wasm = null;
    _mem = null;
    _ptr = 0;
    _ready = false;
    _inputLeftPtr = 0;
    _inputRightPtr = 0;
    _meterCounter = 0;

    constructor() {
        super();
        this.port.onmessage = (e) => {
            const msg = e.data;
            try {
                if (msg.type === 'init') {
                    if (this._ready) { return; }
                    this._initWasm(msg.wasmBytes);
                } else if (msg.type === 'param' && this._ready) {
                    const rustName = PARAM_MAP[msg.name] ?? msg.name;
                    this._setParam(rustName, msg.value);
                }
            } catch (err) {
                console.error('BacteriaProcessor error:', err);
            }
        };
    }

    _initWasm(wasmBytes) {
        const mod = new WebAssembly.Module(wasmBytes);
        const importInfo = WebAssembly.Module.imports(mod);
        const bgImports = {};

        let instance;

        for (const imp of importInfo) {
            if (imp.module === './daw_dsp_bg.js') {
                if (imp.name.startsWith('__wbg___wbindgen_throw_')) {
                    bgImports[imp.name] = function(ptr, len) {
                        throw new Error('WASM error at ptr ' + ptr + ' len ' + len);
                    };
                } else if (imp.name === '__wbindgen_init_externref_table') {
                    bgImports[imp.name] = function() {
                        const table = instance.exports.__wbindgen_externrefs;
                        if (table) {
                            const offset = table.grow(4);
                            table.set(0, undefined);
                            table.set(offset + 0, undefined);
                            table.set(offset + 1, null);
                            table.set(offset + 2, true);
                            table.set(offset + 3, false);
                        }
                    };
                } else {
                    bgImports[imp.name] = function() {};
                }
            }
        }

        const imports = {
            './daw_dsp_bg.js': bgImports,
        };

        instance = new WebAssembly.Instance(mod, imports);
        const w = instance.exports;

        if (w.__wbindgen_start) {
            w.__wbindgen_start();
        }

        this._wasm = w;
        this._mem = w.memory;

        // Create Bacteria instance at worklet sample rate
        this._ptr = w.bacteriainstance_new(sampleRate) >>> 0;

        // Get input buffer pointers
        this._inputLeftPtr = w.bacteriainstance_get_input_left_ptr(this._ptr) >>> 0;
        this._inputRightPtr = w.bacteriainstance_get_input_right_ptr(this._ptr) >>> 0;

        this._ready = true;
        this.port.postMessage({ type: 'ready' });
    }

    _setParam(name, value) {
        const w = this._wasm;
        const len = name.length;
        const strPtr = w.__wbindgen_malloc(len, 1) >>> 0;
        const buf = new Uint8Array(w.memory.buffer, strPtr, len);
        for (let i = 0; i < len; i++) {
            buf[i] = name.charCodeAt(i);
        }
        w.bacteriainstance_set_param(this._ptr, strPtr, len, value);
    }

    process(inputs, outputs) {
        if (!this._ready) { return true; }

        const input = inputs[0];
        const output = outputs[0];
        if (!input || input.length < 2 || !output || output.length < 2) { return true; }

        const frames = output[0].length;
        const w = this._wasm;

        // Write input audio into WASM memory
        const inLeftPtr = w.bacteriainstance_get_input_left_ptr(this._ptr) >>> 0;
        const inRightPtr = w.bacteriainstance_get_input_right_ptr(this._ptr) >>> 0;

        const mem = w.memory.buffer;
        new Float32Array(mem, inLeftPtr, frames).set(input[0]);
        new Float32Array(mem, inRightPtr, frames).set(input[1] ?? input[0]);

        // Process — returns pointer to output left buffer
        const outLeftPtr = w.bacteriainstance_process(this._ptr, frames) >>> 0;
        const outRightPtr = w.bacteriainstance_get_right_ptr(this._ptr) >>> 0;

        // Read output from WASM memory
        output[0].set(new Float32Array(mem, outLeftPtr, frames));
        if (output[1]) {
            output[1].set(new Float32Array(mem, outRightPtr, frames));
        }

        // Send meter data periodically (~23ms at 44.1kHz)
        this._meterCounter++;
        if (this._meterCounter >= 8) {
            this._meterCounter = 0;
            this.port.postMessage({
                type: 'meters',
                inputDb: w.bacteriainstance_get_input_db(this._ptr),
                outputDb: w.bacteriainstance_get_output_db(this._ptr),
                latency: w.bacteriainstance_get_latency_samples(this._ptr),
            });
        }

        return true;
    }
}

registerProcessor('bacteria-processor', BacteriaProcessor);
