// @ts-nocheck
/**
 * AudioWorkletProcessor for the Scoring chromatic tuner.
 * Audio passes through unchanged. Pitch analysis runs in WASM.
 * Telemetry sent back to main thread via postMessage every ~30ms.
 */

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

class ScoringProcessor extends AudioWorkletProcessor {
    _wasm = null;
    _mem = null;
    _ptr = 0;
    _ready = false;
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
                } else if (msg.type === 'param' && this._ready) {
                    this._setParam(msg.name, msg.value);
                } else if (msg.type === 'bypass') {
                    this._bypassed = msg.bypassed;
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
        const imports = {
            './scoring_bg.js': {
                __wbg___wbindgen_throw_6ddd609b62940d55(ptr, len) {
                    throw new Error('WASM error at ' + ptr + ' len ' + len);
                },
                __wbindgen_init_externref_table() {
                    const table = instance.exports.__wbindgen_externrefs;
                    if (table) {
                        const offset = table.grow(4);
                        table.set(0, undefined);
                        table.set(offset + 0, undefined);
                        table.set(offset + 1, null);
                        table.set(offset + 2, true);
                        table.set(offset + 3, false);
                    }
                },
            },
        };

        const mod = new WebAssembly.Module(wasmBytes);
        const instance = new WebAssembly.Instance(mod, imports);
        const w = instance.exports;

        if (w.__wbindgen_start) {
            w.__wbindgen_start();
        }

        this._wasm = w;
        this._mem = w.memory;
        this._ptr = w.scoringinstance_new(sampleRate) >>> 0;
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
        w.scoringinstance_set_param(this._ptr, strPtr, len, value);
        if (w.__wbindgen_free) {
            w.__wbindgen_free(strPtr, len, 1);
        }
    }

    process(inputs, outputs) {
        if (!this._ready) {
            // Pass through
            const input = inputs[0];
            const output = outputs[0];
            if (input && output) {
                for (let ch = 0; ch < Math.min(input.length, output.length); ch++) {
                    if (input[ch] && output[ch]) output[ch].set(input[ch]);
                }
            }
            return true;
        }

        const input = inputs[0];
        const output = outputs[0];
        if (!input || !output || input.length < 1 || output.length < 1) return true;

        const frames = input[0].length;
        const w = this._wasm;

        // Copy input to WASM
        const inBytes = frames * 4;
        const leftInPtr = w.__wbindgen_malloc(inBytes, 4) >>> 0;
        const rightInPtr = w.__wbindgen_malloc(inBytes, 4) >>> 0;

        new Float32Array(w.memory.buffer, leftInPtr, frames).set(input[0]);
        new Float32Array(w.memory.buffer, rightInPtr, frames).set(input[1] ?? input[0]);

        // Process (audio passes through, analysis runs internally)
        const leftOutPtr = w.scoringinstance_process(this._ptr, leftInPtr, frames, rightInPtr, frames, frames) >>> 0;
        const rightOutPtr = w.scoringinstance_get_right_ptr(this._ptr) >>> 0;

        // Copy output
        const mem = w.memory.buffer;
        output[0].set(new Float32Array(mem, leftOutPtr, frames));
        if (output[1]) {
            output[1].set(new Float32Array(mem, rightOutPtr, frames));
        }

        // Send telemetry periodically
        this._frameCount++;
        if (this._frameCount >= this._telemetryInterval) {
            this._frameCount = 0;
            const active = w.scoringinstance_is_active(this._ptr);
            if (active) {
                this.port.postMessage({
                    type: 'telemetry',
                    frequency: w.scoringinstance_get_frequency(this._ptr),
                    cents: w.scoringinstance_get_cents(this._ptr),
                    confidence: w.scoringinstance_get_confidence(this._ptr),
                    noteIndex: w.scoringinstance_get_note_index(this._ptr),
                    octave: w.scoringinstance_get_octave(this._ptr),
                    midiNote: w.scoringinstance_get_midi_note(this._ptr),
                    noteName: NOTE_NAMES[w.scoringinstance_get_note_index(this._ptr) % 12] ?? 'C',
                    active: true,
                });
            } else {
                this.port.postMessage({ type: 'telemetry', active: false });
            }
        }

        return true;
    }
}

registerProcessor('scoring-processor', ScoringProcessor);
