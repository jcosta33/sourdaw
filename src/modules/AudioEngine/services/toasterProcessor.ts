// @ts-nocheck
/**
 * AudioWorkletProcessor for the Toaster drum machine.
 *
 * Uses the generated wasm-bindgen JS bindings (daw_dsp.js) via initSync so all
 * WASM memory management is handled by the generated glue — no manual malloc/free.
 *
 * Messages from main thread:
 *   { type: 'init', wasmBytes: ArrayBuffer }
 *   { type: 'noteOn', pad, velocity, note, sampleFrame? }
 *   { type: 'noteOff', pad, sampleFrame? }
 *   { type: 'param', name, value }
 *   { type: 'padParam', pad, name, value }
 */

import { initSync, ToasterInstance } from '../wasm/daw_dsp.js';

/** Map camelCase pad param names from TypeScript to snake_case for Rust. */
const PAD_PARAM_MAP = {
    volume: 'volume',
    pan: 'pan',
    muted: 'muted',
    tune: 'tune',
    decay: 'decay',
    tone: 'tone',
    drive: 'drive',
    filterCutoff: 'filter_cutoff',
    filterResonance: 'filter_resonance',
    sendReverb: 'send_reverb',
    sendDelay: 'send_delay',
    transientAttack: 'transient_attack',
    transientSustain: 'transient_sustain',
    busRoute: 'bus_route',
    engineType: 'engine_type',
};

/** Map camelCase kit param names to snake_case. */
const KIT_PARAM_MAP = {
    masterGain: 'master_gain',
    reverbMix: 'reverb_mix',
    reverbDecay: 'reverb_decay',
    delayTime: 'delay_time',
    delayFeedback: 'delay_feedback',
    delayMix: 'delay_mix',
    swing: 'swing',
    lofiBits: 'lofi_bits',
    lofiRate: 'lofi_rate',
    lofiMix: 'lofi_mix',
};

class ToasterProcessor extends AudioWorkletProcessor {
    _instance = null; // ToasterInstance (generated wasm-bindgen class)
    _memory = null; // WebAssembly.Memory
    _ready = false;
    _faulted = false;
    _queue = []; // Sorted by sampleFrame (integer sample count)
    _queueHead = 0; // Read index — consumed entries are past this

    constructor() {
        super();
        this.port.onmessage = (event) => {
            const msg = event.data;
            try {
                if (msg.type === 'init') {
                    if (this._ready) {
                        return;
                    }
                    this._initWasm(msg.wasmBytes);
                } else if (this._ready && !this._faulted) {
                    this._handleMessage(msg);
                }
            } catch (error) {
                console.error('ToasterProcessor error:', error);
                if (!this._ready) {
                    this.port.postMessage({ type: 'error', message: error?.message ?? String(error) });
                }
            }
        };
    }

    _initWasm(wasmBytes) {
        const wasmExports = initSync({ module: new WebAssembly.Module(wasmBytes) });
        this._memory = wasmExports.memory;
        this._instance = new ToasterInstance(sampleRate, 16);
        this._ready = true;
        this.port.postMessage({ type: 'ready' });
    }

    _enqueue(msg) {
        // Insert in ascending sampleFrame order within the live range
        // [_queueHead, _queue.length). Called from the message port handler, not
        // the audio render quantum, so splice insertion is acceptable here.
        let lo = this._queueHead,
            hi = this._queue.length;
        while (lo < hi) {
            const mid = (lo + hi) >>> 1;
            if (this._queue[mid].sampleFrame <= msg.sampleFrame) {
                lo = mid + 1;
            } else {
                hi = mid;
            }
        }
        this._queue.splice(lo, 0, msg);
    }

    _handleMessage(msg) {
        // If a future sampleFrame is given, defer to audio-clock queue.
        if (msg.sampleFrame !== undefined) {
            if (msg.sampleFrame > currentFrame) {
                this._enqueue(msg);
                return;
            }
        }
        this._dispatch(msg);
    }

    _dispatch(msg) {
        const inst = this._instance;
        switch (msg.type) {
            case 'noteOn':
                inst.note_on(msg.pad, msg.velocity, msg.note ?? 60);
                break;
            case 'noteOff':
                inst.note_off(msg.pad);
                break;
            case 'param':
                inst.set_param(KIT_PARAM_MAP[msg.name] ?? msg.name, msg.value);
                break;
            case 'padParam':
                inst.set_pad_param(msg.pad, PAD_PARAM_MAP[msg.name] ?? msg.name, msg.value);
                break;
        }
    }

    _drainQueue(blockEndFrame) {
        // Audio-thread hot path: advance the read head, no splice per block.
        while (this._queueHead < this._queue.length && this._queue[this._queueHead].sampleFrame <= blockEndFrame) {
            this._dispatch(this._queue[this._queueHead]);
            this._queueHead++;
        }
        // Fully drained — clear in place. This is the common case for steady-state
        // playback and allocates nothing.
        if (this._queueHead >= this._queue.length) {
            this._queue.length = 0;
            this._queueHead = 0;
        }
    }

    process(_inputs, outputs) {
        if (!this._ready || this._faulted) {
            return true;
        }

        const output = outputs[0];
        if (!output || output.length < 2) {
            return true;
        }

        const frames = output[0].length;

        // Drain any scheduled events that fall within this render block.
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
        } catch (error) {
            this._faulted = true;
            this.port.postMessage({ type: 'error', message: String(error) });
        }

        return true;
    }
}

registerProcessor('toaster-processor', ToasterProcessor);
