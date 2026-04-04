// @ts-nocheck
/**
 * AudioWorkletProcessor for the Gluten bus compressor.
 *
 * Uses the generated wasm-bindgen JS bindings (daw_dsp.js) via initSync so all
 * WASM memory management is handled by the generated glue — no manual malloc/free.
 *
 * Effect processor: reads from inputs[0] (main) and inputs[1] (sidechain), writes to outputs[0].
 */

import { initSync, GlutenInstance } from '../wasm/daw_dsp.js';

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
    _instance = null;   // GlutenInstance (generated wasm-bindgen class)
    _memory = null;     // WebAssembly.Memory
    _ready = false;
    _faulted = false;
    _meterCounter = 0;
    _sabView = null;    // Float32Array view into the telemetry SharedArrayBuffer slot

    constructor() {
        super();
        this.port.onmessage = (e) => {
            const msg = e.data;
            try {
                if (msg.type === 'init') {
                    if (this._ready) return;
                    this._initWasm(msg.wasmBytes);
                } else if (msg.type === 'init-sab') {
                    this._sabView = new Float32Array(msg.sab, msg.byteOffset, 32);
                } else if (msg.type === 'param' && this._ready && !this._faulted) {
                    const rustName = PARAM_MAP[msg.name] ?? msg.name;
                    this._instance.set_param(rustName, msg.value);
                }
            } catch (err) {
                console.error('GlutenProcessor error:', err);
                if (!this._ready) {
                    this.port.postMessage({ type: 'error', message: err?.message ?? String(err) });
                }
            }
        };
    }

    _initWasm(wasmBytes) {
        const wasmExports = initSync({ module: new WebAssembly.Module(wasmBytes) });
        this._memory = wasmExports.memory;
        this._instance = new GlutenInstance(sampleRate);
        this._ready = true;
        this.port.postMessage({ type: 'ready' });
    }

    _passthrough(input, output) {
        if (output[0] && input[0]) output[0].set(input[0]);
        if (output[1] && (input[1] ?? input[0])) output[1].set(input[1] ?? input[0]);
    }

    process(inputs, outputs) {
        if (!this._ready || this._faulted) return true;

        const input = inputs[0];
        const output = outputs[0];
        if (!input || input.length < 2 || !output || output.length < 2) return true;

        const frames = output[0].length;

        try {
            const inst = this._instance;
            const mem = this._memory.buffer;

            const inLeftPtr = inst.get_input_left_ptr();
            const inRightPtr = inst.get_input_right_ptr();
            new Float32Array(mem, inLeftPtr, frames).set(input[0]);
            new Float32Array(mem, inRightPtr, frames).set(input[1] ?? input[0]);

            // Write external sidechain if available (input 1)
            const scInput = inputs[1];
            if (scInput && scInput.length >= 1 && scInput[0].length > 0) {
                const scLeftPtr = inst.get_sc_left_ptr();
                const scRightPtr = inst.get_sc_right_ptr();
                new Float32Array(mem, scLeftPtr, frames).set(scInput[0]);
                new Float32Array(mem, scRightPtr, frames).set(scInput[1] ?? scInput[0]);
            }

            const outLeftPtr = inst.process(frames);
            const outRightPtr = inst.get_right_ptr();

            output[0].set(new Float32Array(mem, outLeftPtr, frames));
            if (output[1]) output[1].set(new Float32Array(mem, outRightPtr, frames));

            this._meterCounter++;
            if (this._meterCounter >= 8) {
                this._meterCounter = 0;
                if (this._sabView) {
                    this._sabView[0] = inst.get_gr_db();
                    this._sabView[1] = inst.get_input_db();
                    this._sabView[2] = inst.get_output_db();
                    this._sabView[3] = inst.get_crest();
                    this._sabView[4] = inst.get_phase_corr();
                    this._sabView[5] = inst.get_latency_samples();
                }
            }
        } catch (err) {
            this._faulted = true;
            this.port.postMessage({ type: 'error', message: String(err) });
            this._passthrough(input, output);
        }

        return true;
    }
}

registerProcessor('gluten-processor', GlutenProcessor);
