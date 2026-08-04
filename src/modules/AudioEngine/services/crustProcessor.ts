/**
 * AudioWorkletProcessor for the Crust true-peak limiter.
 *
 * Same shape as `glutenProcessor.ts`: the generated wasm-bindgen bindings via
 * `initSync`, cached linear-memory views, and a seqlock-published telemetry
 * slot. Effect processor — reads `inputs[0]`, writes `outputs[0]`.
 */

import { resolveProcessorWasmModule } from '../transformers/resolveProcessorWasmModule';
import { initSync, CrustInstance } from '../wasm/daw_dsp.js';

import { beginTelemetryPublish, endTelemetryPublish } from './telemetrySeqlock';
import { WasmView } from './wasmView';

/**
 * camelCase parameter names from the Crust panel to the snake_case names the
 * Rust engine dispatches on. The panel's patch keys are the source of truth;
 * `crustParamBridge` encodes their values, this maps their names.
 */
const PARAM_MAP: Record<string, string> = {
    gain: 'gain',
    ceiling: 'ceiling',
    style: 'style',
    algorithm: 'algorithm',
    lookahead: 'lookahead',
    attack: 'attack',
    release: 'release',
    attackAuto: 'attack_auto',
    releaseAuto: 'release_auto',
    channelLinkTransient: 'channel_link_transient',
    channelLinkRelease: 'channel_link_release',
    truePeak: 'true_peak',
    oversampling: 'oversampling',
    satEnabled: 'sat_enabled',
    satAlgorithm: 'sat_algorithm',
    satDrive: 'sat_drive',
    satMix: 'sat_mix',
    deltaListen: 'delta_listen',
    unityGain: 'unity_gain',
    multiBand: 'multi_band',
    crossover1: 'crossover1',
    crossover2: 'crossover2',
    scHpfEnabled: 'sc_hpf_enabled',
    scHpfFreq: 'sc_hpf_freq',
    stereoMode: 'stereo_mode',
    dither: 'dither',
    outputBitDepth: 'output_bit_depth',
    bypass: 'bypass',
    resetTruePeak: 'reset_true_peak',
};

type CrustMsg =
    | { type: 'init' }
    | { type: 'init-sab'; sab: SharedArrayBuffer; byteOffset: number }
    | { type: 'param'; name: string; value: number }
    | { type: 'reset-true-peak' };

class CrustProcessor extends AudioWorkletProcessor {
    _instance: CrustInstance | null = null;
    _memory: WebAssembly.Memory | null = null;
    _ready = false;
    _faulted = false;
    _meterCounter = 0;
    _sabView: Float32Array | null = null;
    /** Int32 view over the same slot bytes — carries the seqlock counter. */
    _sabSeqView: Int32Array | null = null;
    // Cached WASM linear-memory views, reused across render quanta so process()
    // performs no per-block Float32Array allocation; each revalidates on a
    // memory.grow() buffer-identity change. See wasmView.ts.
    _inLeftView = new WasmView();
    _inRightView = new WasmView();
    _outLeftView = new WasmView();
    _outRightView = new WasmView();

    constructor(...args: unknown[]) {
        super();
        let wasmModule = resolveProcessorWasmModule(args[0]);
        this.port.onmessage = (event: MessageEvent<CrustMsg>) => {
            const msg = event.data;
            try {
                if (msg.type === 'init') {
                    if (this._ready) {
                        return;
                    }
                    if (!wasmModule) {
                        throw new TypeError('CrustProcessor requires a compiled WASM module');
                    }
                    this._initWasm(wasmModule);
                    wasmModule = null;
                } else if (msg.type === 'init-sab') {
                    this._sabView = new Float32Array(msg.sab, msg.byteOffset, 32);
                    this._sabSeqView = new Int32Array(msg.sab, msg.byteOffset, 32);
                } else if (msg.type === 'reset-true-peak' && this._instance !== null && !this._faulted) {
                    this._instance.reset_true_peak();
                } else if (msg.type === 'param' && this._instance !== null && !this._faulted) {
                    const rustName = PARAM_MAP[msg.name] ?? msg.name;
                    // The look-ahead, the true-peak switch and the ceiling all
                    // move the delay line, so latency is re-read after every
                    // parameter rather than only after the obvious ones.
                    const oldLatency = this._instance.get_latency_samples();
                    this._instance.set_param(rustName, msg.value);
                    const newLatency = this._instance.get_latency_samples();
                    if (newLatency !== oldLatency) {
                        this.port.postMessage({ type: 'latency-changed', latency: newLatency });
                    }
                }
            } catch (error) {
                // A throw at the wasm boundary may leave the instance trapped,
                // and a trap carries no message, so it cannot be told apart
                // from a recoverable error. Fault the processor rather than let
                // it keep accepting work.
                console.error('CrustProcessor error:', error);
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
        this._instance = new CrustInstance(sampleRate);
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
        if (!input || input.length === 0 || !output || output.length < 2) {
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

            const outLeftPtr = inst.process(frames);
            const outRightPtr = inst.get_right_ptr();

            // Re-read the live buffer AFTER process(): a Rust-side allocation
            // can grow the linear memory mid-call and detach the buffer inputs
            // were written into, so output views must map the post-grow buffer.
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
                    // Seqlock publish: counter odd, the field stores, counter
                    // even. A main-thread poll that lands inside this window
                    // retries instead of consuming a snapshot torn across two
                    // meter blocks.
                    beginTelemetryPublish(this._sabSeqView);
                    this._sabView[0] = inst.get_gr_db();
                    this._sabView[1] = inst.get_input_db();
                    this._sabView[2] = inst.get_output_db();
                    this._sabView[3] = inst.get_lufs_integrated();
                    this._sabView[4] = inst.get_lufs_short_term();
                    this._sabView[5] = inst.get_lufs_momentary();
                    this._sabView[6] = inst.get_lra();
                    this._sabView[7] = inst.get_true_peak_max();
                    this._sabView[8] = inst.get_true_peak_exceeded();
                    this._sabView[9] = inst.get_latency_samples();
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

registerProcessor('crust-processor', CrustProcessor);
