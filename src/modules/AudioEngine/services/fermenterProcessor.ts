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

function camelToSnake(str: string): string {
    const snake = str.replaceAll(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
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

type FermenterMsg =
    | { type: 'init'; wasmBytes: BufferSource }
    | { type: 'noteOn'; note: number; velocity: number; sampleFrame?: number }
    | { type: 'noteOff'; note: number; sampleFrame?: number }
    | { type: 'param'; name: string; value: number }
    | { type: 'patch'; patch: Record<string, number | number[]> };

type FermenterQueued =
    | { type: 'noteOn'; note: number; velocity: number; sampleFrame: number }
    | { type: 'noteOff'; note: number; sampleFrame: number };

class FermenterProcessor extends AudioWorkletProcessor {
    _instance: FermenterInstance | null = null;
    _memory: WebAssembly.Memory | null = null;
    _ready = false;
    _faulted = false;
    _queue: FermenterQueued[] = [];
    _queueHead = 0;

    constructor() {
        super();
        this.port.onmessage = (event: MessageEvent<FermenterMsg>) => {
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
                console.error('FermenterProcessor error:', error);
                if (!this._ready) {
                    this.port.postMessage({
                        type: 'error',
                        message: error instanceof Error ? error.message : String(error),
                    });
                }
            }
        };
    }

    _initWasm(wasmBytes: BufferSource): void {
        const wasmExports = initSync({ module: new WebAssembly.Module(wasmBytes) });
        this._memory = wasmExports.memory;
        this._instance = new FermenterInstance(sampleRate, 32);
        this._ready = true;
        this.port.postMessage({ type: 'ready' });
    }

    _enqueue(msg: FermenterQueued): void {
        let lo = this._queueHead;
        let hi = this._queue.length;
        while (lo < hi) {
            const mid = (lo + hi) >>> 1;
            const midMsg = this._queue[mid];
            if (midMsg && midMsg.sampleFrame <= msg.sampleFrame) {
                lo = mid + 1;
            } else {
                hi = mid;
            }
        }
        this._queue.splice(lo, 0, msg);
    }

    _handleMessage(msg: FermenterMsg): void {
        if (
            (msg.type === 'noteOn' || msg.type === 'noteOff') &&
            msg.sampleFrame !== undefined &&
            msg.sampleFrame > currentFrame
        ) {
            this._enqueue({ ...msg, sampleFrame: msg.sampleFrame });
            return;
        }
        this._dispatch(msg);
    }

    _dispatch(msg: FermenterMsg | FermenterQueued): void {
        const inst = this._instance;
        if (!inst) {
            return;
        }
        switch (msg.type) {
            case 'init':
                break;
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
                        for (let index = 0; index < value.length; index++) {
                            inst.set_param(`macro${index}`, value[index] ?? 0);
                        }
                    }
                }
                break;
            }
        }
    }

    _drainQueue(blockEndFrame: number): void {
        while (this._queueHead < this._queue.length) {
            const queued = this._queue[this._queueHead];
            if (!queued || queued.sampleFrame > blockEndFrame) {
                break;
            }
            this._dispatch(queued);
            this._queueHead++;
        }
        if (this._queueHead >= this._queue.length) {
            this._queue.length = 0;
            this._queueHead = 0;
        }
    }

    process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
        if (!this._ready || this._faulted) {
            return true;
        }

        const output = outputs[0];
        if (!output || output.length < 2) {
            return true;
        }

        const out0 = output[0];
        if (!out0) {
            return true;
        }
        const frames = out0.length;

        const blockEndFrame = currentFrame + frames;
        this._drainQueue(blockEndFrame);

        try {
            const inst = this._instance;
            const mem = this._memory?.buffer;
            if (!inst || !mem) {
                return true;
            }

            const leftPtr = inst.process(frames);
            const rightPtr = inst.get_right_ptr();

            const outL = new Float32Array(mem, leftPtr, frames);
            out0.set(outL);

            const out1 = output[1];
            let outR: Float32Array | null = null;
            if (out1) {
                outR = new Float32Array(mem, rightPtr, frames);
                out1.set(outR);
            }

            // Compute Telemetry (Peak & Scope) every 2048 frames (~46ms at 44.1kHz)
            if (currentFrame % 2048 < frames) {
                let peakL = 0;
                let peakR = 0;
                for (let index = 0; index < frames; index++) {
                    const absL = Math.abs(outL[index] ?? 0);
                    if (absL > peakL) {
                        peakL = absL;
                    }
                    if (outR) {
                        const absR = Math.abs(outR[index] ?? 0);
                        if (absR > peakR) {
                            peakR = absR;
                        }
                    }
                }
                const scopeBuffer = new Float32Array(128);
                const step = frames / 128;
                for (let index = 0; index < 128; index++) {
                    scopeBuffer[index] = outL[Math.floor(index * step)] ?? 0;
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
