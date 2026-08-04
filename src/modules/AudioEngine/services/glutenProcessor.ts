/**
 * AudioWorkletProcessor for the Gluten bus compressor.
 *
 * Uses the generated wasm-bindgen JS bindings (daw_dsp.js) via initSync so all
 * WASM memory management is handled by the generated glue — no manual malloc/free.
 *
 * Effect processor: reads from inputs[0] (main) and inputs[1] (sidechain), writes to outputs[0].
 */

import { resolveProcessorWasmModule } from '../transformers/resolveProcessorWasmModule';
import { initSync, GlutenInstance } from '../wasm/daw_dsp.js';

import { beginTelemetryPublish, endTelemetryPublish } from './telemetrySeqlock';
import { WasmView } from './wasmView';

/** Map camelCase param names from TypeScript to snake_case for Rust. */
const PARAM_MAP: Record<string, string> = {
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

type GlutenMsg =
    | { type: 'init' }
    | { type: 'init-sab'; sab: SharedArrayBuffer; byteOffset: number }
    | { type: 'param'; name: string; value: number };

class GlutenProcessor extends AudioWorkletProcessor {
    _instance: GlutenInstance | null = null;
    _memory: WebAssembly.Memory | null = null;
    _ready = false;
    _faulted = false;
    _meterCounter = 0;
    _sabView: Float32Array | null = null;
    /** Int32 view over the same slot bytes — carries the seqlock counter (RT-2). */
    _sabSeqView: Int32Array | null = null;
    // Cached WASM linear-memory views — reused across render quanta so process()
    // performs no per-block Float32Array allocation (audit RT-1); each revalidates
    // on a memory.grow() buffer-identity change (audit RT-7). See wasmView.ts.
    _inLeftView = new WasmView();
    _inRightView = new WasmView();
    _scLeftView = new WasmView();
    _scRightView = new WasmView();
    _outLeftView = new WasmView();
    _outRightView = new WasmView();

    constructor(...args: unknown[]) {
        super();
        let wasmModule = resolveProcessorWasmModule(args[0]);
        this.port.onmessage = (event: MessageEvent<GlutenMsg>) => {
            const msg = event.data;
            try {
                if (msg.type === 'init') {
                    if (this._ready) {
                        return;
                    }
                    if (!wasmModule) {
                        throw new TypeError('GlutenProcessor requires a compiled WASM module');
                    }
                    this._initWasm(wasmModule);
                    wasmModule = null;
                } else if (msg.type === 'init-sab') {
                    this._sabView = new Float32Array(msg.sab, msg.byteOffset, 32);
                    this._sabSeqView = new Int32Array(msg.sab, msg.byteOffset, 32);
                } else if (msg.type === 'param' && this._instance !== null && !this._faulted) {
                    const rustName = PARAM_MAP[msg.name] ?? msg.name;
                    const oldLatency = this._instance.get_latency_samples();
                    this._instance.set_param(rustName, msg.value);
                    const newLatency = this._instance.get_latency_samples();
                    if (newLatency !== oldLatency) {
                        this.port.postMessage({ type: 'latency-changed', latency: newLatency });
                    }
                }
            } catch (error) {
                // Same policy as the process() catch below. A throw at the wasm
                // boundary may leave the instance trapped, and a trap carries no
                // message, so it cannot be told apart from a recoverable error.
                // Reporting only while `!_ready` left a post-startup fault in a
                // worklet console, with the device still accepting work after.
                console.error('GlutenProcessor error:', error);
                this._faulted = true;
                this.port.postMessage({
                    type: 'error',
                    message: error instanceof Error ? error.message : String(error),
                });
            }
        };
    }

    _initWasm(wasmModule: WebAssembly.Module): void {
        const wasmExports = initSync({ module: wasmModule });
        this._memory = wasmExports.memory;
        this._instance = new GlutenInstance(sampleRate);
        this._ready = true;
        this.port.postMessage({ type: 'ready', latency: this._instance.get_latency_samples() });
    }

    _passthrough(input: Float32Array[], output: Float32Array[]): void {
        const in0 = input[0];
        const in1 = input[1] ?? in0;
        if (output[0] && in0) {
            output[0].set(in0);
        }
        if (output[1] && in1) {
            output[1].set(in1);
        }
    }

    process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
        if (!this._ready || this._faulted) {
            return true;
        }

        const input = inputs[0];
        const output = outputs[0];
        if (!input || input.length < 2 || !output || output.length < 2) {
            return true;
        }

        const in0 = input[0];
        const out0 = output[0];
        if (!in0 || !out0) {
            return true;
        }
        const frames = out0.length;

        try {
            const inst = this._instance;
            const mem = this._memory?.buffer;
            if (!inst || !mem) {
                return true;
            }

            const inLeftPtr = inst.get_input_left_ptr();
            const inRightPtr = inst.get_input_right_ptr();
            this._inLeftView.get(mem, inLeftPtr, frames).set(in0);
            this._inRightView.get(mem, inRightPtr, frames).set(input[1] ?? in0);

            const scInput = inputs[1];
            if (scInput && scInput.length > 0) {
                const sc0 = scInput[0];
                if (sc0 && sc0.length > 0) {
                    const scLeftPtr = inst.get_sc_left_ptr();
                    const scRightPtr = inst.get_sc_right_ptr();
                    this._scLeftView.get(mem, scLeftPtr, frames).set(sc0);
                    this._scRightView.get(mem, scRightPtr, frames).set(scInput[1] ?? sc0);
                }
            }

            const outLeftPtr = inst.process(frames);
            const outRightPtr = inst.get_right_ptr();

            // Re-read the live buffer AFTER process(): a Rust-side allocation can
            // grow the linear memory mid-call and detach the buffer inputs were
            // written into, so output views must map the post-grow buffer (audit
            // RT-7). Reusing pre-call `mem` would hand back a detached, zero-length
            // view and silently emit stale samples; steady state reuses the cache.
            const outMem = this._memory?.buffer ?? mem;

            out0.set(this._outLeftView.get(outMem, outLeftPtr, frames));
            const out1 = output[1];
            if (out1) {
                out1.set(this._outRightView.get(outMem, outRightPtr, frames));
            }

            this._meterCounter++;
            if (this._meterCounter >= 8) {
                this._meterCounter = 0;
                if (this._sabView) {
                    // Seqlock publish (audit RT-2): counter odd, six non-atomic
                    // float stores, counter even. A main-thread poll that lands
                    // inside this window retries instead of consuming a snapshot
                    // torn across two meter blocks.
                    beginTelemetryPublish(this._sabSeqView);
                    this._sabView[0] = inst.get_gr_db();
                    this._sabView[1] = inst.get_input_db();
                    this._sabView[2] = inst.get_output_db();
                    this._sabView[3] = inst.get_crest();
                    this._sabView[4] = inst.get_phase_corr();
                    this._sabView[5] = inst.get_latency_samples();
                    endTelemetryPublish(this._sabSeqView);
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

registerProcessor('gluten-processor', GlutenProcessor);
