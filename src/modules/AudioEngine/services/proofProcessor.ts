// @ts-nocheck
/**
 * AudioWorkletProcessor for the Proof mastering suite.
 *
 * Uses the generated wasm-bindgen JS bindings (daw_dsp.js) via initSync so all
 * WASM memory management is handled by the generated glue — no manual malloc/free.
 *
 * Effect processor: reads inputs[0], writes outputs[0].
 * Handles the full mastering chain via WASM (EQ → Dynamics → Imager → Exciter → Limiter).
 * Sends metering data (LUFS, GR, correlation, tap levels) back to main thread.
 */

import '../wasm/workletPolyfill.js';
import { initSync, ProofInstance } from '../wasm/daw_dsp.js';

class ProofProcessor extends AudioWorkletProcessor {
    _instance = null; // ProofInstance (generated wasm-bindgen class)
    _memory = null; // WebAssembly.Memory
    _ready = false;
    _faulted = false;
    _meterCounter = 0;

    constructor() {
        super();
        this.port.onmessage = (e) => {
            const msg = e.data;
            try {
                if (msg.type === 'init') {
                    if (this._ready) return;
                    this._initWasm(msg.wasmBytes);
                } else if (this._ready && !this._faulted) {
                    this._handleMessage(msg);
                }
            } catch (err) {
                console.error('ProofProcessor error:', err);
                if (!this._ready) {
                    this.port.postMessage({ type: 'error', message: err?.message ?? String(err) });
                }
            }
        };
    }

    _initWasm(wasmBytes) {
        const wasmExports = initSync({ module: new WebAssembly.Module(wasmBytes) });
        this._memory = wasmExports.memory;
        this._instance = new ProofInstance(sampleRate);
        this._ready = true;
        this.port.postMessage({ type: 'ready' });
    }

    _handleMessage(msg) {
        const inst = this._instance;
        switch (msg.type) {
            case 'param':
                inst.set_param(msg.name, msg.value);
                break;
            case 'reorder': {
                const o = msg.order;
                inst.reorder(o[0], o[1], o[2], o[3], o[4]);
                break;
            }
            case 'reset_integrated':
                inst.reset_integrated();
                break;
        }
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

            const outLeftPtr = inst.process(frames);
            const outRightPtr = inst.get_right_ptr();

            output[0].set(new Float32Array(mem, outLeftPtr, frames));
            if (output[1]) output[1].set(new Float32Array(mem, outRightPtr, frames));

            this._meterCounter++;
            if (this._meterCounter >= 8) {
                this._meterCounter = 0;
                this.port.postMessage({
                    type: 'meters',
                    inputLufs: inst.get_input_lufs(),
                    outputLufs: inst.get_output_lufs(),
                    outputStLufs: inst.get_output_st_lufs(),
                    integratedLufs: inst.get_integrated_lufs(),
                    truePeakDb: inst.get_true_peak_db(),
                    lra: inst.get_lra(),
                    correlation: inst.get_correlation(),
                    limiterGrDb: inst.get_limiter_gr_db(),
                    dynGr0: inst.get_dynamics_gr(0),
                    dynGr1: inst.get_dynamics_gr(1),
                    dynGr2: inst.get_dynamics_gr(2),
                    dynGr3: inst.get_dynamics_gr(3),
                    tap0PeakL: inst.get_tap_peak_l(0),
                    tap0PeakR: inst.get_tap_peak_r(0),
                    tap1PeakL: inst.get_tap_peak_l(1),
                    tap1PeakR: inst.get_tap_peak_r(1),
                    tap2PeakL: inst.get_tap_peak_l(2),
                    tap2PeakR: inst.get_tap_peak_r(2),
                    tap3PeakL: inst.get_tap_peak_l(3),
                    tap3PeakR: inst.get_tap_peak_r(3),
                    tap4PeakL: inst.get_tap_peak_l(4),
                    tap4PeakR: inst.get_tap_peak_r(4),
                    tap5PeakL: inst.get_tap_peak_l(5),
                    tap5PeakR: inst.get_tap_peak_r(5),
                    latency: inst.get_latency_samples(),
                });
            }
        } catch (err) {
            this._faulted = true;
            this.port.postMessage({ type: 'error', message: String(err) });
            this._passthrough(input, output);
        }

        return true;
    }
}

registerProcessor('proof-processor', ProofProcessor);
