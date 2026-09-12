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

/**
 * Per-string triplets the slot publishes past the scalar header. Matches
 * engine/telemetryAllocator.ts's SCORING_IDX.polyCount / polyBase and
 * SCORING_POLY_STRING_COUNT (this file hardcodes its slot indices — the
 * allocator owns the paired layout table).
 */
const POLY_STRING_COUNT = 6;
const POLY_COUNT_IDX = 7;
const POLY_BASE_IDX = 8;

class ScoringProcessor extends AudioWorkletProcessor {
    _instance: ScoringInstance | null = null;
    _memory: WebAssembly.Memory | null = null;
    _ready = false;
    _faulted = false;
    _bypassed = false;
    /**
     * Whether the polyphonic string tracker is enabled (the `poly` param).
     *
     * The instance gives no "is poly on" accessor, and a disabled tracker stops
     * updating but keeps its last results — so this side record is what gates
     * publication: without it the slot would either publish stale strings after
     * Poly mode is switched off or spend per-string wasm calls every tick for
     * readouts nothing consumes.
     */
    _polyEnabled = false;
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
                } else if (msg.type === 'param') {
                    // The poly gate is recorded even when it arrives before the
                    // instance exists — a param sent pre-init must still shape
                    // what gets published once telemetry starts.
                    if (msg.name === 'poly') {
                        this._polyEnabled = msg.value > 0.5;
                    }
                    if (this._instance !== null && !this._faulted) {
                        this._instance.set_param(msg.name, msg.value);
                    }
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
                outCh.set(inCh);
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
                // The poly string count joins the mono flag: a bypassed tuner
                // must not keep advertising the strings it saw before bypass.
                this._sabView[POLY_COUNT_IDX] = 0;
                endTelemetryPublish(this._sabSeqView);
                this._telemetryStale = false;
            }
            return true;
        }
        this._telemetryStale = true;

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
                    // is published under the same cycle — and the poly string
                    // block rides inside it too, so a poll never pairs a fresh
                    // mono read with the previous one's strings.
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
                    if (this._polyEnabled) {
                        // The poly tracker runs on its own schedule inside the
                        // instance and keeps reporting while the mono readout
                        // sits idle, so its block publishes in both mono
                        // branches. Slots past the tracker's configured string
                        // count are zeroed rather than left stale.
                        const strings = Math.min(inst.get_poly_string_count(), POLY_STRING_COUNT);
                        this._sabView[POLY_COUNT_IDX] = strings;
                        for (let i = 0; i < POLY_STRING_COUNT; i++) {
                            const base = POLY_BASE_IDX + i * 3;
                            if (i < strings) {
                                this._sabView[base] = inst.is_poly_string_active(i) ? 1 : 0;
                                this._sabView[base + 1] = inst.get_poly_string_cents(i);
                                this._sabView[base + 2] = inst.get_poly_string_confidence(i);
                            } else {
                                this._sabView[base] = 0;
                                this._sabView[base + 1] = 0;
                                this._sabView[base + 2] = 0;
                            }
                        }
                    } else {
                        this._sabView[POLY_COUNT_IDX] = 0;
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
