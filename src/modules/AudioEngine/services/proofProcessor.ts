// @ts-nocheck
/**
 * AudioWorkletProcessor for the Proof mastering suite.
 *
 * Effect processor: reads inputs[0], writes outputs[0].
 * Handles the full mastering chain via WASM (EQ → Dynamics → Imager → Exciter → Limiter).
 * Sends metering data (LUFS, GR, correlation, tap levels) back to main thread.
 */

class ProofProcessor extends AudioWorkletProcessor {
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
                    this._setParam(msg.name, msg.value);
                } else if (msg.type === 'reorder' && this._ready) {
                    const o = msg.order;
                    this._wasm.proofinstance_reorder(this._ptr, o[0], o[1], o[2], o[3], o[4]);
                } else if (msg.type === 'reset_integrated' && this._ready) {
                    this._wasm.proofinstance_reset_integrated(this._ptr);
                }
            } catch (err) {
                console.error('ProofProcessor error:', err);
            }
        };
    }

    _initWasm(wasmBytes) {
        const mod = new WebAssembly.Module(wasmBytes);
        const importInfo = WebAssembly.Module.imports(mod);
        const bgImports = {};
        
        let instance;

        for (const imp of importInfo) {
            if (imp.module === './daw_dsp_bg.js' || imp.module === './proof_chamber_bg.js' || imp.module === './proof_bg.js') {
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
                } else if (imp.name.startsWith('__wbg___wbindgen_copy_to_typed_array_')) {
                    bgImports[imp.name] = function(arg0, arg1, arg2) {};
                } else {
                    bgImports[imp.name] = function() {};
                }
            }
        }

        const imports = {
            './daw_dsp_bg.js': bgImports,
            './proof_chamber_bg.js': bgImports,
            './proof_bg.js': bgImports,
        };

        instance = new WebAssembly.Instance(mod, imports);
        const w = instance.exports;

        if (w.__wbindgen_start) {
            w.__wbindgen_start();
        }

        this._wasm = w;
        this._mem = w.memory;
        this._ptr = w.proofinstance_new(sampleRate) >>> 0;
        this._inputLeftPtr = w.proofinstance_get_input_left_ptr(this._ptr) >>> 0;
        this._inputRightPtr = w.proofinstance_get_input_right_ptr(this._ptr) >>> 0;

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
        w.proofinstance_set_param(this._ptr, strPtr, len, value);
    }

    process(inputs, outputs) {
        if (!this._ready) { return true; }

        const input = inputs[0];
        const output = outputs[0];
        if (!input || input.length < 2 || !output || output.length < 2) { return true; }

        const frames = output[0].length;
        const w = this._wasm;

        // Write input into WASM memory
        const inLeftPtr = w.proofinstance_get_input_left_ptr(this._ptr) >>> 0;
        const inRightPtr = w.proofinstance_get_input_right_ptr(this._ptr) >>> 0;
        const mem = w.memory.buffer;
        new Float32Array(mem, inLeftPtr, frames).set(input[0]);
        new Float32Array(mem, inRightPtr, frames).set(input[1] ?? input[0]);

        // Process
        const outLeftPtr = w.proofinstance_process(this._ptr, frames) >>> 0;
        const outRightPtr = w.proofinstance_get_right_ptr(this._ptr) >>> 0;

        // Read output
        output[0].set(new Float32Array(mem, outLeftPtr, frames));
        if (output[1]) {
            output[1].set(new Float32Array(mem, outRightPtr, frames));
        }

        // Send metering data (~every 8 blocks ≈ 23ms at 44.1kHz
        this._meterCounter++;
        if (this._meterCounter >= 8) {
            this._meterCounter = 0;
            this.port.postMessage({
                type: 'meters',
                inputLufs: w.proofinstance_get_input_lufs(this._ptr),
                outputLufs: w.proofinstance_get_output_lufs(this._ptr),
                outputStLufs: w.proofinstance_get_output_st_lufs(this._ptr),
                integratedLufs: w.proofinstance_get_integrated_lufs(this._ptr),
                truePeakDb: w.proofinstance_get_true_peak_db(this._ptr),
                lra: w.proofinstance_get_lra(this._ptr),
                correlation: w.proofinstance_get_correlation(this._ptr),
                limiterGrDb: w.proofinstance_get_limiter_gr_db(this._ptr),
                dynGr0: w.proofinstance_get_dynamics_gr(this._ptr, 0),
                dynGr1: w.proofinstance_get_dynamics_gr(this._ptr, 1),
                dynGr2: w.proofinstance_get_dynamics_gr(this._ptr, 2),
                dynGr3: w.proofinstance_get_dynamics_gr(this._ptr, 3),
                tap0PeakL: w.proofinstance_get_tap_peak_l(this._ptr, 0),
                tap0PeakR: w.proofinstance_get_tap_peak_r(this._ptr, 0),
                tap1PeakL: w.proofinstance_get_tap_peak_l(this._ptr, 1),
                tap1PeakR: w.proofinstance_get_tap_peak_r(this._ptr, 1),
                tap2PeakL: w.proofinstance_get_tap_peak_l(this._ptr, 2),
                tap2PeakR: w.proofinstance_get_tap_peak_r(this._ptr, 2),
                tap3PeakL: w.proofinstance_get_tap_peak_l(this._ptr, 3),
                tap3PeakR: w.proofinstance_get_tap_peak_r(this._ptr, 3),
                tap4PeakL: w.proofinstance_get_tap_peak_l(this._ptr, 4),
                tap4PeakR: w.proofinstance_get_tap_peak_r(this._ptr, 4),
                tap5PeakL: w.proofinstance_get_tap_peak_l(this._ptr, 5),
                tap5PeakR: w.proofinstance_get_tap_peak_r(this._ptr, 5),
                latency: w.proofinstance_get_latency_samples(this._ptr),
            });
        }

        return true;
    }
}

registerProcessor('proof-processor', ProofProcessor);
