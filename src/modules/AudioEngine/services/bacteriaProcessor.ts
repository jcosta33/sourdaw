/**
 * AudioWorkletProcessor for the Bacteria creative multi-effects framework.
 *
 * Uses the generated wasm-bindgen JS bindings (daw_dsp.js) via initSync so all
 * WASM memory management is handled by the generated glue — no manual malloc/free.
 *
 * Effect processor: reads from inputs[0], writes to outputs[0].
 */

import { BacteriaInstance, initSync } from '../wasm/daw_dsp.js';

import { resolveProcessorWasmModule } from './resolveProcessorWasmModule';
import { beginTelemetryPublish, endTelemetryPublish } from './telemetrySeqlock';
import { WasmView } from './wasmView';

/** Bacteria passes param names through as-is (Rust engine uses camelCase matching). */
const PARAM_MAP: Record<string, string> = {
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

type BacteriaMsg =
    | { type: 'init' }
    | { type: 'init-sab'; sab: SharedArrayBuffer; byteOffset: number }
    | { type: 'param'; name: string; value: number };

class BacteriaProcessor extends AudioWorkletProcessor {
    _instance: BacteriaInstance | null = null;
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
    _outLeftView = new WasmView();
    _outRightView = new WasmView();
    _bandLevelsView = new WasmView();

    constructor(...args: unknown[]) {
        super();
        let wasmModule = resolveProcessorWasmModule(args[0]);
        this.port.onmessage = (event: MessageEvent<BacteriaMsg>) => {
            const msg = event.data;
            try {
                if (msg.type === 'init') {
                    if (this._ready) {
                        return;
                    }
                    if (!wasmModule) {
                        throw new TypeError('BacteriaProcessor requires a compiled WASM module');
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
                // Report it and stop taking work; a worklet console reaches nobody.
                console.error('BacteriaProcessor error:', error);
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
        this._instance = new BacteriaInstance(sampleRate);
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
        const in1 = input[1] ?? in0;
        const out0 = output[0];
        const out1 = output[1];
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
            this._inRightView.get(mem, inRightPtr, frames).set(in1 ?? in0);

            const outLeftPtr = inst.process(frames);
            const outRightPtr = inst.get_right_ptr();

            // Re-read the live buffer AFTER process(): a Rust-side allocation can
            // grow the linear memory mid-call and detach the buffer inputs were
            // written into, so every view read past this point (outputs and the
            // band-levels telemetry) must map the post-grow buffer (audit RT-7).
            // Steady state leaves the identity unchanged and reuses the cache.
            const outMem = this._memory?.buffer ?? mem;

            out0.set(this._outLeftView.get(outMem, outLeftPtr, frames));
            if (out1) {
                out1.set(this._outRightView.get(outMem, outRightPtr, frames));
            }

            this._meterCounter++;
            if (this._meterCounter >= 8) {
                this._meterCounter = 0;
                if (this._sabView) {
                    // Seqlock publish (audit RT-2): counter odd, the header floats
                    // plus the 6-band blit, counter even. Without the bracket a
                    // poll could mix bands from two blocks — the exact tear the
                    // slot layout documents.
                    beginTelemetryPublish(this._sabSeqView);
                    this._sabView[0] = inst.get_input_db();
                    this._sabView[1] = inst.get_output_db();
                    this._sabView[2] = inst.get_latency_samples();
                    // Blit the Rust engine's 6-element peak-level array directly into
                    // the SAB slot starting at index 3 (bandLevelsBase). Peak levels
                    // are linear amplitude; consumers convert to dB.
                    const bandPtr = inst.get_band_levels_ptr();
                    const bandView = this._bandLevelsView.get(outMem, bandPtr, 6);
                    this._sabView.set(bandView, 3);
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

registerProcessor('bacteria-processor', BacteriaProcessor);
