/**
 * AudioWorkletProcessor for the Scoring chromatic tuner.
 *
 * Uses the generated wasm-bindgen JS bindings (scoring.js) via initSync so all
 * WASM memory management is handled by the generated glue — no manual malloc/free.
 *
 * Audio passes through unchanged. Pitch analysis runs in WASM.
 * Telemetry sent back to main thread via postMessage every ~30ms.
 *
 * Messages from main thread:
 *   { type: 'init' }
 *   { type: 'param', name, value }
 *   { type: 'bypass', bypassed }
 */

import { initSync, ScoringInstance } from '../wasm/scoring.js';

import { resolveProcessorWasmModule } from './resolveProcessorWasmModule';
import { beginTelemetryPublish, endTelemetryPublish } from './telemetrySeqlock';
import { WasmView } from './wasmView';

type ScoringMsg =
    | { type: 'init' }
    | { type: 'init-sab'; sab: SharedArrayBuffer; byteOffset: number }
    | { type: 'param'; name: string; value: number }
    | { type: 'bypass'; bypassed: boolean };

class ScoringProcessor extends AudioWorkletProcessor {
    _instance: ScoringInstance | null = null;
    _memory: WebAssembly.Memory | null = null;
    _ready = false;
    _faulted = false;
    _bypassed = false;
    _frameCount = 0;
    _telemetryInterval = 4; // send telemetry every N process calls (~21ms at 128 samples/48kHz)
    _sabView: Float32Array | null = null;
    /** Int32 view over the same slot bytes — carries the seqlock counter (RT-2). */
    _sabSeqView: Int32Array | null = null;
    // Cached WASM linear-memory views — reused across render quanta so process()
    // performs no per-block Float32Array allocation (audit RT-1); each revalidates
    // on a memory.grow() buffer-identity change (audit RT-7). See wasmView.ts.
    _outLeftView = new WasmView();
    _outRightView = new WasmView();

    constructor(...args: unknown[]) {
        super();
        let wasmModule = resolveProcessorWasmModule(args[0]);
        this.port.onmessage = (event: MessageEvent<ScoringMsg>) => {
            const msg = event.data;
            try {
                if (msg.type === 'init') {
                    if (this._ready) {
                        return;
                    }
                    if (!wasmModule) {
                        throw new TypeError('ScoringProcessor requires a compiled WASM module');
                    }
                    this._initWasm(wasmModule);
                    wasmModule = null;
                } else if (msg.type === 'init-sab') {
                    this._sabView = new Float32Array(msg.sab, msg.byteOffset, 32);
                    this._sabSeqView = new Int32Array(msg.sab, msg.byteOffset, 32);
                } else if (msg.type === 'bypass') {
                    this._bypassed = msg.bypassed;
                } else if (msg.type === 'param' && this._instance !== null && !this._faulted) {
                    this._instance.set_param(msg.name, msg.value);
                }
            } catch (error) {
                // Same policy as the process() catch below. A throw at the wasm
                // boundary may leave the instance trapped, and a trap carries no
                // message, so it cannot be told apart from a recoverable error.
                // Reporting only while `!_ready` left a post-startup fault in a
                // worklet console, with the device still accepting work after.
                console.error('ScoringProcessor error:', error);
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
        this._instance = new ScoringInstance(sampleRate);
        this._ready = true;
        this.port.postMessage({ type: 'ready' });
    }

    _passthrough(input: Float32Array[], output: Float32Array[]): void {
        for (let ch = 0; ch < Math.min(input.length, output.length); ch++) {
            const inCh = input[ch];
            const outCh = output[ch];
            if (inCh && outCh) {
                outCh.set(inCh);
            }
        }
    }

    process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
        const input = inputs[0];
        const output = outputs[0];

        if (!this._ready || this._faulted) {
            if (input && output) {
                this._passthrough(input, output);
            }
            return true;
        }

        const in0 = input?.[0];
        if (!in0 || !output || output.length === 0) {
            return true;
        }
        const frames = in0.length;

        try {
            const inst = this._instance;
            const mem = this._memory?.buffer;
            if (!inst || !mem) {
                return true;
            }

            // process() takes Float32Array inputs directly — no manual malloc needed
            const leftPtr = inst.process(in0, input[1] ?? in0, frames);
            const rightPtr = inst.get_right_ptr();

            // Re-read the live buffer AFTER process(): a Rust-side allocation can
            // grow the linear memory mid-call and detach the previous buffer, so the
            // output views must map the post-grow buffer (audit RT-7). Steady state
            // leaves the identity unchanged and reuses the cached view.
            const outMem = this._memory?.buffer ?? mem;

            const out0 = output[0];
            if (out0) {
                out0.set(this._outLeftView.get(outMem, leftPtr, frames));
            }
            const out1 = output[1];
            if (out1) {
                out1.set(this._outRightView.get(outMem, rightPtr, frames));
            }

            // Send telemetry periodically
            this._frameCount++;
            if (this._frameCount >= this._telemetryInterval) {
                this._frameCount = 0;
                const active = inst.is_active();
                if (this._sabView) {
                    // Seqlock publish (audit RT-2): the active flag and the six
                    // pitch fields must be consumed as one snapshot, or a poll can
                    // read active=1 next to a frequency/note from the previous
                    // detection. The bracket spans both branches so the flag flip
                    // is published under the same cycle.
                    beginTelemetryPublish(this._sabSeqView);
                    if (active) {
                        this._sabView[0] = 1;
                        this._sabView[1] = inst.get_frequency();
                        this._sabView[2] = inst.get_cents();
                        this._sabView[3] = inst.get_confidence();
                        this._sabView[4] = inst.get_note_index();
                        this._sabView[5] = inst.get_octave();
                        this._sabView[6] = inst.get_midi_note();
                    } else {
                        this._sabView[0] = 0;
                    }
                    endTelemetryPublish(this._sabSeqView);
                }
            }
        } catch (error) {
            this._faulted = true;
            this.port.postMessage({ type: 'error', message: String(error) });
            if (input && output) {
                this._passthrough(input, output);
            }
        }

        return true;
    }
}

registerProcessor('scoring-processor', ScoringProcessor);
