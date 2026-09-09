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

import { resolveProcessorWasmModule } from '../transformers/resolveProcessorWasmModule';
import { initSync, ScoringInstance } from '../wasm/scoring.js';

import { beginTelemetryPublish, endTelemetryPublish } from './telemetrySeqlock';
import { WasmView } from './wasmView';

type ScoringMsg =
    | { type: 'init' }
    | { type: 'init-sab'; sab: SharedArrayBuffer; byteOffset: number }
    | { type: 'param'; name: string; value: number }
    | { type: 'bypass'; bypassed: boolean }
    | { type: 'import-scala'; id: string; text: string }
    | { type: 'import-tun'; id: string; text: string };

class ScoringProcessor extends AudioWorkletProcessor {
    _instance: ScoringInstance | null = null;
    _memory: WebAssembly.Memory | null = null;
    _ready = false;
    _faulted = false;
    _bypassed = false;
    /**
     * Whether the telemetry slot still holds a reading taken while running.
     *
     * Set on every analysed block and consumed once when the processor stops
     * analysing, so the clearing publish happens on the transition rather than
     * on every bypassed block — a write per block would churn the seqlock for
     * no reader benefit.
     */
    _telemetryStale = false;
    _frameCount = 0;
    _telemetryInterval = 4; // send telemetry every N process calls (~21ms at 128 samples/48kHz)
    _sabView: Float32Array | null = null;
    /** Int32 view over the same slot bytes — carries the seqlock counter (RT-2). */
    _sabSeqView: Int32Array | null = null;
    // Cached WASM channel views — reused for input and output across render
    // quanta, and revalidated on memory.grow() (audit RT-1 / RT-7).
    _leftView = new WasmView();
    _rightView = new WasmView();

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
                } else if (msg.type === 'import-scala' || msg.type === 'import-tun') {
                    if (!this._instance || this._faulted) {
                        this.port.postMessage({ type: 'scale-import-result', id: msg.id, ok: false });
                        return;
                    }
                    const ok =
                        msg.type === 'import-scala'
                            ? this._instance.import_scala(msg.text)
                            : this._instance.import_tun(msg.text);
                    const name = ok ? this._instance.scale_description() : undefined;
                    this.port.postMessage({ type: 'scale-import-result', id: msg.id, ok, name });
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
                const copiedFrames = Math.min(inCh.length, outCh.length);
                for (let frame = 0; frame < copiedFrames; frame++) {
                    outCh[frame] = inCh[frame]!;
                }
                for (let frame = copiedFrames; frame < outCh.length; frame++) {
                    outCh[frame] = 0;
                }
            }
        }
    }

    process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
        const input = inputs[0];
        const output = outputs[0];

        // Bypassed, the tuner does nothing: no analysis, no telemetry, and the
        // dry signal reaches the output unchanged (the sibling shape — see
        // proofChamberProcessor). The detector has no audible state to protect,
        // so unlike Knead there is nothing to keep warm; the readout re-converges
        // within one analysis window after un-bypassing.
        if (!this._ready || this._bypassed || this._faulted) {
            if (input && output) {
                this._passthrough(input, output);
            }
            // Clear the readout once on the way in. Skipping the publish
            // entirely leaves the last real detection sitting in the slot, and
            // the poll keeps reading it every frame — so a bypassed tuner goes
            // on reporting "in tune at A4" indefinitely, with nothing in the
            // panel able to tell a live reading from a frozen one.
            //
            // Published under the same seqlock bracket as a real frame so a
            // concurrent poll cannot read the cleared flag beside a stale
            // frequency.
            if (this._telemetryStale && this._sabView && this._sabSeqView) {
                beginTelemetryPublish(this._sabSeqView);
                this._sabView[0] = 0;
                endTelemetryPublish(this._sabSeqView);
                this._telemetryStale = false;
            }
            return true;
        }
        const in0 = input?.[0];
        if (!in0 || !output || output.length === 0) {
            return true;
        }
        const frames = in0.length;
        if (frames === 0) {
            return true;
        }
        this._telemetryStale = true;

        try {
            const inst = this._instance;
            const rightIn = input[1] ?? in0;
            const out0 = output[0];
            const out1 = output[1];
            if (!inst || !out0) {
                return true;
            }
            if (frames > 1024 || rightIn.length < frames || out0.length < frames || (out1 && out1.length < frames)) {
                throw new RangeError('ScoringProcessor received an invalid render span');
            }

            const leftPtr = inst.get_left_ptr();
            const rightPtr = inst.get_right_ptr();
            const inputMemory = this._memory?.buffer;
            if (!inputMemory) {
                return true;
            }
            const leftView = this._leftView.get(inputMemory, leftPtr, frames);
            const rightView = this._rightView.get(inputMemory, rightPtr, frames);
            for (let frame = 0; frame < frames; frame++) {
                leftView[frame] = in0[frame]!;
                rightView[frame] = rightIn[frame]!;
            }

            inst.process(frames);

            // Re-read the live buffer AFTER process(): a Rust-side allocation can
            // grow the linear memory mid-call and detach the previous buffer, so the
            // output views must map the post-grow buffer (audit RT-7). Steady state
            // leaves the identity unchanged and reuses the cached view.
            const outputMemory = this._memory?.buffer ?? inputMemory;

            out0.set(this._leftView.get(outputMemory, leftPtr, frames));
            if (out1) {
                out1.set(this._rightView.get(outputMemory, rightPtr, frames));
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
