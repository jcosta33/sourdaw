// @ts-nocheck
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
 *   { type: 'init', wasmBytes: ArrayBuffer }
 *   { type: 'param', name, value }
 *   { type: 'bypass', bypassed }
 */

import { initSync, ScoringInstance } from '../wasm/scoring.js';

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

class ScoringProcessor extends AudioWorkletProcessor {
    _instance = null;   // ScoringInstance (generated wasm-bindgen class)
    _memory = null;     // WebAssembly.Memory
    _ready = false;
    _faulted = false;
    _bypassed = false;
    _frameCount = 0;
    _telemetryInterval = 4; // send telemetry every N process calls (~21ms at 128 samples/48kHz)

    constructor() {
        super();
        this.port.onmessage = (e) => {
            const msg = e.data;
            try {
                if (msg.type === 'init') {
                    if (this._ready) return;
                    this._initWasm(msg.wasmBytes);
                } else if (msg.type === 'bypass') {
                    this._bypassed = msg.bypassed;
                } else if (msg.type === 'param' && this._ready && !this._faulted) {
                    this._instance.set_param(msg.name, msg.value);
                }
            } catch (err) {
                console.error('ScoringProcessor error:', err);
                if (!this._ready) {
                    this.port.postMessage({ type: 'error', message: err?.message ?? String(err) });
                }
            }
        };
    }

    _initWasm(wasmBytes) {
        const wasmExports = initSync({ module: new WebAssembly.Module(wasmBytes) });
        this._memory = wasmExports.memory;
        this._instance = new ScoringInstance(sampleRate);
        this._ready = true;
        this.port.postMessage({ type: 'ready' });
    }

    _passthrough(input, output) {
        for (let ch = 0; ch < Math.min(input.length, output.length); ch++) {
            if (input[ch] && output[ch]) output[ch].set(input[ch]);
        }
    }

    process(inputs, outputs) {
        const input = inputs[0];
        const output = outputs[0];

        if (!this._ready || this._faulted) {
            if (input && output) this._passthrough(input, output);
            return true;
        }

        if (!input || output.length < 1 || input.length < 1) return true;

        const frames = input[0].length;

        try {
            // process() takes Float32Array inputs directly — no manual malloc needed
            const leftPtr = this._instance.process(input[0], input[1] ?? input[0], frames);
            const rightPtr = this._instance.get_right_ptr();

            const mem = this._memory.buffer;
            output[0].set(new Float32Array(mem, leftPtr, frames));
            if (output[1]) output[1].set(new Float32Array(mem, rightPtr, frames));

            // Send telemetry periodically
            this._frameCount++;
            if (this._frameCount >= this._telemetryInterval) {
                this._frameCount = 0;
                const inst = this._instance;
                const active = inst.is_active();
                if (active) {
                    const noteIdx = inst.get_note_index();
                    this.port.postMessage({
                        type: 'telemetry',
                        frequency: inst.get_frequency(),
                        cents: inst.get_cents(),
                        confidence: inst.get_confidence(),
                        noteIndex: noteIdx,
                        octave: inst.get_octave(),
                        midiNote: inst.get_midi_note(),
                        noteName: NOTE_NAMES[noteIdx % 12] ?? 'C',
                        active: true,
                    });
                } else {
                    this.port.postMessage({ type: 'telemetry', active: false });
                }
            }
        } catch (err) {
            this._faulted = true;
            this.port.postMessage({ type: 'error', message: String(err) });
            if (input && output) this._passthrough(input, output);
        }

        return true;
    }
}

registerProcessor('scoring-processor', ScoringProcessor);
