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
 *   { type: 'scheduledHit', pad, velocity, note, sampleFrame, padParams, restoreEngineType? }
 *   { type: 'cancelScheduled' }
 *   { type: 'fillState', active }
 *   { type: 'param', name, value }
 *   { type: 'padParam', pad, name, value }
 */

import { initSync, ToasterInstance } from '../wasm/daw_dsp.js';

/** Pad count the ToasterInstance is created with; the allNotesOff release loop spans 0..PAD_COUNT-1. */
const TOASTER_PAD_COUNT = 16;

/** Map camelCase pad param names from TypeScript to snake_case for Rust. */
const PAD_PARAM_MAP: Record<string, string> = {
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
const KIT_PARAM_MAP: Record<string, string> = {
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

type ToasterMsg =
    | { type: 'init'; wasmBytes: BufferSource }
    | { type: 'noteOn'; pad: number; velocity: number; note?: number; sampleFrame?: number }
    | { type: 'noteOff'; pad: number; sampleFrame?: number }
    | {
          type: 'scheduledHit';
          pad: number;
          velocity: number;
          note?: number;
          sampleFrame: number;
          padParams: Array<{ name: string; value: number }>;
          restoreEngineType?: number;
          fillCondition?: 'fill' | 'not-fill';
      }
    | { type: 'cancelScheduled' }
    | { type: 'fillState'; active: boolean }
    | { type: 'allNotesOff' }
    | { type: 'param'; name: string; value: number }
    | { type: 'padParam'; pad: number; name: string; value: number };

type ToasterQueued =
    | { type: 'noteOn'; pad: number; velocity: number; note?: number; sampleFrame: number }
    | { type: 'noteOff'; pad: number; sampleFrame: number }
    | {
          type: 'scheduledHit';
          pad: number;
          velocity: number;
          note?: number;
          sampleFrame: number;
          padParams: Array<{ name: string; value: number }>;
          restoreEngineType?: number;
          fillCondition?: 'fill' | 'not-fill';
      };

class ToasterProcessor extends AudioWorkletProcessor {
    _instance: ToasterInstance | null = null;
    _memory: WebAssembly.Memory | null = null;
    _ready = false;
    _faulted = false;
    _queue: ToasterQueued[] = [];
    _queueHead = 0;
    _fillActive = false;

    constructor() {
        super();
        this.port.onmessage = (event: MessageEvent<ToasterMsg>) => {
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
        this._instance = new ToasterInstance(sampleRate, TOASTER_PAD_COUNT);
        this._ready = true;
        this.port.postMessage({ type: 'ready' });
    }

    _enqueue(msg: ToasterQueued): void {
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

    _handleMessage(msg: ToasterMsg): void {
        if (msg.type === 'noteOn' || msg.type === 'noteOff' || msg.type === 'scheduledHit') {
            if (msg.sampleFrame !== undefined && msg.sampleFrame > currentFrame) {
                this._enqueue({ ...msg, sampleFrame: msg.sampleFrame });
                return;
            }
        }
        this._dispatch(msg);
    }

    _dispatch(msg: ToasterMsg | ToasterQueued): void {
        const inst = this._instance;
        if (!inst) {
            return;
        }
        switch (msg.type) {
            case 'init':
                break;
            case 'noteOn':
                inst.note_on(msg.pad, msg.velocity, msg.note ?? 60);
                break;
            case 'noteOff':
                inst.note_off(msg.pad);
                break;
            case 'scheduledHit':
                if (msg.fillCondition === 'fill' && !this._fillActive) {
                    break;
                }
                if (msg.fillCondition === 'not-fill' && this._fillActive) {
                    break;
                }
                for (const param of msg.padParams) {
                    inst.set_pad_param(msg.pad, PAD_PARAM_MAP[param.name] ?? param.name, param.value);
                }
                inst.note_on(msg.pad, msg.velocity, msg.note ?? 60);
                if (msg.restoreEngineType !== undefined) {
                    inst.set_pad_param(msg.pad, 'engine_type', msg.restoreEngineType);
                }
                break;
            case 'cancelScheduled': {
                // Fill/tempo edits invalidate sequencer hits, but must not erase
                // timestamped MIDI note-on/off events sharing this instrument.
                let writeIndex = 0;
                for (let readIndex = this._queueHead; readIndex < this._queue.length; readIndex++) {
                    const queued = this._queue[readIndex];
                    if (queued && queued.type !== 'scheduledHit') {
                        this._queue[writeIndex] = queued;
                        writeIndex++;
                    }
                }
                this._queue.length = writeIndex;
                this._queueHead = 0;
                break;
            }
            case 'fillState':
                this._fillActive = msg.active;
                break;
            case 'allNotesOff':
                // Release every pad in one message instead of the main thread
                // fanning out 16 structured-clone note-off postMessages per device
                // on transport stop. Drop not-yet-dispatched scheduled hits first
                // so a queued future noteOn cannot retrigger after the release.
                this._queue.length = 0;
                this._queueHead = 0;
                for (let pad = 0; pad < TOASTER_PAD_COUNT; pad++) {
                    inst.note_off(pad);
                }
                break;
            case 'param':
                inst.set_param(KIT_PARAM_MAP[msg.name] ?? msg.name, msg.value);
                break;
            case 'padParam':
                inst.set_pad_param(msg.pad, PAD_PARAM_MAP[msg.name] ?? msg.name, msg.value);
                break;
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

            out0.set(new Float32Array(mem, leftPtr, frames));
            const out1 = output[1];
            if (out1) {
                out1.set(new Float32Array(mem, rightPtr, frames));
            }
        } catch (error) {
            this._faulted = true;
            this.port.postMessage({ type: 'error', message: String(error) });
        }

        return true;
    }
}

registerProcessor('toaster-processor', ToasterProcessor);
