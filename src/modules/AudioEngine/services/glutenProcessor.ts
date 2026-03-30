// @ts-nocheck
/**
 * AudioWorkletProcessor for the Gluten bus compressor.
 *
 * Unlike instrument processors (Fermenter/Toaster), Gluten is an *effect*:
 * it reads from inputs[0] and writes to outputs[0].
 *
 * Calls raw wasm-bindgen WASM exports directly — same pattern as toasterProcessor.
 */

/** Map camelCase param names from TypeScript to snake_case for Rust. */
const PARAM_MAP = {
    threshold: 'threshold',
    ratio: 'ratio',
    attack: 'attack',
    release: 'release',
    knee: 'knee',
    makeup: 'makeup',
    mix: 'mix',
    topology: 'topology',
    style: 'style',
    autoMakeup: 'auto_makeup',
    autoRelease: 'auto_release',
    range: 'range',
    scHpfFreq: 'sc_hpf_freq',
    scHpfEnabled: 'sc_hpf_enabled',
    thrust: 'thrust',
    detection: 'detection',
    stereoMode: 'stereo_mode',
    stereoLink: 'stereo_link',
    lookahead: 'lookahead',
    bypass: 'bypass',
    vcaCharacter: 'vca_character',
    limitMode: 'limit_mode',
    peakReduction: 'peak_reduction',
    inputGain: 'input_gain',
    outputGain: 'output_gain',
    xfmrDrive: 'xfmr_drive',
    allButtons: 'all_buttons',
    recovery: 'recovery',
    limiterThreshold: 'limiter_threshold',
    scLpfFreq: 'sc_lpf_freq',
    scLpfEnabled: 'sc_lpf_enabled',
    deltaListen: 'delta_listen',
    amount: 'amount',
    gainMatchBypass: 'gain_match_bypass',
    feedForward: 'feed_forward',
    blendTopology: 'blend_topology',
    blendAmount: 'blend_amount',
    scEqFreq: 'sc_eq_freq',
    scEqGain: 'sc_eq_gain',
    scEqQ: 'sc_eq_q',
    scEqEnabled: 'sc_eq_enabled',
    vcaType: 'vca_type',
    jfetK3: 'jfet_k3',
    xfmrK2: 'xfmr_k2',
    oversampling: 'oversampling',
    extSidechain: 'ext_sidechain',
};

class GlutenProcessor extends AudioWorkletProcessor {
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
                console.error('GlutenProcessor error:', err);
            }
        };
    }

    _initWasm(wasmBytes) {
        // Dynamically resolve WASM imports (hash in function names changes between builds)
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

        // Create compressor instance at worklet sample rate
        this._ptr = w.gluteninstance_new(sampleRate) >>> 0;

        // Get input buffer pointers
        this._inputLeftPtr = w.gluteninstance_get_input_left_ptr(this._ptr) >>> 0;
        this._inputRightPtr = w.gluteninstance_get_input_right_ptr(this._ptr) >>> 0;

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
        w.gluteninstance_set_param(this._ptr, strPtr, len, value);
    }

    process(inputs, outputs) {
        if (!this._ready) { return true; }

        const input = inputs[0];
        const output = outputs[0];
        if (!input || input.length < 2 || !output || output.length < 2) { return true; }

        const frames = output[0].length;
        const w = this._wasm;

        // Write input audio into WASM memory
        // Re-read pointers in case buffers were resized
        const inLeftPtr = w.gluteninstance_get_input_left_ptr(this._ptr) >>> 0;
        const inRightPtr = w.gluteninstance_get_input_right_ptr(this._ptr) >>> 0;

        const mem = w.memory.buffer;
        new Float32Array(mem, inLeftPtr, frames).set(input[0]);
        new Float32Array(mem, inRightPtr, frames).set(input[1] ?? input[0]);

        // Write external sidechain if available (input 1)
        const scInput = inputs[1];
        if (scInput && scInput.length >= 1 && scInput[0].length > 0) {
            const scLeftPtr = w.gluteninstance_get_sc_left_ptr(this._ptr) >>> 0;
            const scRightPtr = w.gluteninstance_get_sc_right_ptr(this._ptr) >>> 0;
            new Float32Array(mem, scLeftPtr, frames).set(scInput[0]);
            new Float32Array(mem, scRightPtr, frames).set(scInput[1] ?? scInput[0]);
        }

        // Process — returns pointer to output left buffer
        const outLeftPtr = w.gluteninstance_process(this._ptr, frames) >>> 0;
        const outRightPtr = w.gluteninstance_get_right_ptr(this._ptr) >>> 0;

        // Read output from WASM memory
        output[0].set(new Float32Array(mem, outLeftPtr, frames));
        if (output[1]) {
            output[1].set(new Float32Array(mem, outRightPtr, frames));
        }

        // Send meter data periodically (every ~8 blocks = ~23ms at 44.1kHz)
        this._meterCounter++;
        if (this._meterCounter >= 8) {
            this._meterCounter = 0;
            this.port.postMessage({
                type: 'meters',
                grDb: w.gluteninstance_get_gr_db(this._ptr),
                inputDb: w.gluteninstance_get_input_db(this._ptr),
                outputDb: w.gluteninstance_get_output_db(this._ptr),
                crest: w.gluteninstance_get_crest(this._ptr),
                phaseCorr: w.gluteninstance_get_phase_corr(this._ptr),
                latency: w.gluteninstance_get_latency_samples(this._ptr),
            });
        }

        return true;
    }
}

registerProcessor('gluten-processor', GlutenProcessor);
