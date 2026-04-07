// @ts-nocheck
/**
 * AudioWorkletProcessor for the Grand Boule physical-modeling piano.
 *
 * Uses the generated wasm-bindgen JS bindings (daw_dsp.js) via initSync.
 *
 * Messages from main thread:
 *   { type: 'init', wasmBytes: ArrayBuffer }
 *   { type: 'noteOn', midiNote, velocity, sampleFrame? }
 *   { type: 'noteOff', midiNote, sampleFrame? }
 *   { type: 'param', name, value }
 *   { type: 'sustain', position }
 *   { type: 'unaCorda', engaged }
 *   { type: 'sostenuto', engaged }
 *   { type: 'noteOnMidi2', midiNote, velocity16bit, pitchOffsetQ24 }
 *   { type: 'temperament', index }
 *   { type: 'allNotesOff' }
 */

import '../wasm/workletPolyfill.js';
import { initSync, GrandBouleInstance } from '../wasm/daw_dsp.js';

/** Map camelCase param names from TypeScript to snake_case for Rust. */
const PARAM_MAP = {
    masterGain: 'master_gain',
    soundboardSend: 'soundboard_send',
    sympatheticSend: 'sympathetic_send',
};

class GrandBouleProcessor extends AudioWorkletProcessor {
    _instance = null;
    _memory = null;
    _ready = false;
    _faulted = false;
    _queue = []; // Sorted by sampleFrame (integer sample count)

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
                console.error('GrandBouleProcessor error:', err);
                if (!this._ready) {
                    this.port.postMessage({ type: 'error', message: err?.message ?? String(err) });
                }
            }
        };
    }

    _initWasm(wasmBytes) {
        const wasmExports = initSync({ module: new WebAssembly.Module(wasmBytes) });
        this._memory = wasmExports.memory;
        this._instance = new GrandBouleInstance(sampleRate, 64);
        this._ready = true;
        this.port.postMessage({ type: 'ready' });
    }

    _enqueue(msg) {
        let lo = 0,
            hi = this._queue.length;
        while (lo < hi) {
            const mid = (lo + hi) >>> 1;
            if (this._queue[mid].sampleFrame <= msg.sampleFrame) lo = mid + 1;
            else hi = mid;
        }
        this._queue.splice(lo, 0, msg);
    }

    _handleMessage(msg) {
        if (msg.sampleFrame !== undefined) {
            if (msg.sampleFrame > currentFrame) {
                this._enqueue(msg);
                return;
            }
        }
        this._dispatch(msg);
    }

    _drainQueue(blockEndFrame) {
        while (this._queue.length > 0 && this._queue[0].sampleFrame <= blockEndFrame) {
            this._dispatch(this._queue.shift());
        }
    }

    _dispatch(msg) {
        const inst = this._instance;
        switch (msg.type) {
            case 'noteOn':
                inst.note_on(msg.midiNote, msg.velocity);
                break;
            case 'noteOff':
                inst.note_off(msg.midiNote);
                break;
            case 'param':
                inst.set_param(PARAM_MAP[msg.name] ?? msg.name, msg.value);
                break;
            case 'sustain':
                inst.set_sustain(msg.position);
                break;
            case 'unaCorda':
                inst.set_una_corda(msg.engaged);
                break;
            case 'sostenuto':
                inst.set_sostenuto(msg.engaged);
                break;
            case 'noteOnMidi2':
                inst.note_on_midi2(msg.midiNote, msg.velocity16bit, msg.pitchOffsetQ24);
                break;
            case 'temperament':
                inst.set_temperament(msg.index);
                break;
            case 'loadAttackClip':
                inst.load_attack_clip(msg.key, msg.samples);
                break;
            case 'allNotesOff':
                inst.all_notes_off();
                break;
        }
    }

    process(_inputs, outputs) {
        if (!this._ready || this._faulted) return true;

        const output = outputs[0];
        if (!output || output.length < 2) return true;

        const frames = output[0].length;

        const blockEndFrame = currentFrame + frames;
        this._drainQueue(blockEndFrame);

        try {
            const leftPtr = this._instance.process(frames);
            const rightPtr = this._instance.get_right_ptr();

            const mem = this._memory.buffer;
            output[0].set(new Float32Array(mem, leftPtr, frames));
            if (output[1]) {
                output[1].set(new Float32Array(mem, rightPtr, frames));
            }
        } catch (err) {
            this._faulted = true;
            this.port.postMessage({ type: 'error', message: String(err) });
        }

        return true;
    }
}

registerProcessor('grand-boule-processor', GrandBouleProcessor);
