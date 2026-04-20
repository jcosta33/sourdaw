// @ts-nocheck
/**
 * AudioWorkletProcessor for the Fermenter synthesizer.
 *
 * Uses the generated wasm-bindgen JS bindings (daw_dsp.js) via initSync so all
 * WASM memory management is handled by the generated glue — no manual malloc/free.
 *
 * Messages from main thread:
 *   { type: 'init', wasmBytes: ArrayBuffer }
 *   { type: 'noteOn', note, velocity, sampleFrame? }
 *   { type: 'noteOff', note, sampleFrame? }
 *   { type: 'param', name, value }
 */

import { initSync, FermenterInstance } from '../wasm/daw_dsp.js';

/**
 * Convert camelCase to snake_case automatically.
 */
function camelToSnake(str) {
    const snake = str.replaceAll(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
    // Handle the 3 exceptions
    if (snake === 'filter_cutoff') {
        return 'cutoff';
    }
    if (snake === 'filter_resonance') {
        return 'resonance';
    }
    if (snake === 'filter_env_amount') {
        return 'mod_env_to_filter';
    }
    if (snake === 'lfo_pitch_amount') {
        return 'mod_lfo_to_pitch';
    }
    if (snake === 'osc_engine') {
        return 'engine';
    }
    if (snake === 'osc_drift') {
        return 'drift';
    }
    if (snake === 'portamento_time') {
        return 'portamento';
    }
    return snake;
}

class FermenterProcessor extends AudioWorkletProcessor {
    _instance = null; // FermenterInstance (generated wasm-bindgen class)
    _memory = null; // WebAssembly.Memory (for direct buffer access in process())
    _ready = false;
    _faulted = false;
    _queue = []; // Sorted by sampleFrame (integer sample count)
    _queueHead = 0; // Read index — consumed entries are past this

    constructor() {
        super();
        this.port.onmessage = (e) => {
            const msg = e.data;
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
                console.error('FermenterProcessor error:', error);
                if (!this._ready) {
                    this.port.postMessage({ type: 'error', message: error?.message ?? String(error) });
                }
            }
        };
    }

    _initWasm(wasmBytes) {
        const wasmExports = initSync({ module: new WebAssembly.Module(wasmBytes) });
        this._memory = wasmExports.memory;
        this._instance = new FermenterInstance(sampleRate, 32);
        this._ready = true;
        this.port.postMessage({ type: 'ready' });
    }

    _enqueue(msg) {
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
                inst.note_on(msg.note, msg.velocity);
                break;
            case 'noteOff':
                inst.note_off(msg.note);
                break;
            case 'param': {
                const rustName = camelToSnake(msg.name);
                inst.set_param(rustName, msg.value);
                break;
            }
            case 'patch': {
                for (const [key, value] of Object.entries(msg.patch)) {
                    if (typeof value === 'number') {
                        inst.set_param(camelToSnake(key), value);
                    } else if (key === 'macros' && Array.isArray(value)) {
                        for (let i = 0; i < value.length; i++) {
                            inst.set_param(`macro${i}`, value[i]);
                        }
                    }
                }
                break;
            }
        }
    }

    _drainQueue(blockEndFrame) {
        // Audio-thread hot path: advance the read head, no splice per block.
        while (this._queueHead < this._queue.length && this._queue[this._queueHead].sampleFrame <= blockEndFrame) {
            this._dispatch(this._queue[this._queueHead]);
            this._queueHead++;
        }
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

        const blockEndFrame = currentFrame + frames;
        this._drainQueue(blockEndFrame);

        try {
            const leftPtr = this._instance.process(frames);
            const rightPtr = this._instance.get_right_ptr();

            const mem = this._memory.buffer;
            const outL = new Float32Array(mem, leftPtr, frames);
            output[0].set(outL);

            let outR = null;
            if (output[1]) {
                outR = new Float32Array(mem, rightPtr, frames);
                output[1].set(outR);
            }

            // Compute Telemetry (Peak & Scope) every 2048 frames (~46ms at 44.1kHz)
            if (currentFrame % 2048 < frames) {
                let peakL = 0;
                let peakR = 0;
                for (let i = 0; i < frames; i++) {
                    const l = Math.abs(outL[i]);
                    if (l > peakL) {
                        peakL = l;
                    }
                    if (outR) {
                        const r = Math.abs(outR[i]);
                        if (r > peakR) {
                            peakR = r;
                        }
                    }
                }
                const scopeBuffer = new Float32Array(128);
                // Downsample from block into scope buffer
                const step = frames / 128;
                for (let i = 0; i < 128; i++) {
                    scopeBuffer[i] = outL[Math.floor(i * step)] || 0;
                }
                this.port.postMessage({ type: 'telemetry', peakL, peakR, scopeBuffer }, [scopeBuffer.buffer]);
            }
        } catch (error) {
            this._faulted = true;
            this.port.postMessage({ type: 'error', message: String(error) });
        }

        return true;
    }
}

registerProcessor('fermenter-processor', FermenterProcessor);
