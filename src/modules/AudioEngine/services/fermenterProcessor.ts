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

type ParamAutomationSegment = {
    startFrame: number;
    endFrame: number;
    startValue: number;
    endValue: number;
};

type ParamAutomationSchedule = {
    rustName: string;
    segments: ParamAutomationSegment[];
    segmentIndex: number;
    lastValue: number;
};

type FermenterMsg =
    | { type: 'init'; wasmBytes: BufferSource }
    | { type: 'noteOn'; note: number; velocity: number; sampleFrame?: number }
    | { type: 'noteOff'; note: number; sampleFrame?: number }
    | { type: 'allNotesOff' }
    | { type: 'param'; name: string; value: number }
    | { type: 'paramAutomation'; name: string; segments: ParamAutomationSegment[] }
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
    _paramAutomation: ParamAutomationSchedule[] = [];

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
        if (msg.type === 'paramAutomation') {
            if (msg.name.length === 0 || msg.segments.length === 0) {
                return;
            }
            const schedule: ParamAutomationSchedule = {
                rustName: camelToSnake(msg.name),
                segments: msg.segments,
                segmentIndex: 0,
                lastValue: Number.NaN,
            };
            const existingIndex = this._paramAutomation.findIndex(
                (candidate) => candidate.rustName === schedule.rustName
            );
            if (existingIndex >= 0) {
                this._paramAutomation[existingIndex] = schedule;
            } else {
                this._paramAutomation.push(schedule);
            }
            return;
        }
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
            case 'allNotesOff':
                // Release every held voice in one message instead of the main
                // thread fanning out 128 structured-clone note-off postMessages
                // per device on transport stop. Drop any not-yet-dispatched
                // scheduled notes first so a queued future noteOn cannot retrigger
                // after the release. The 0..127 release loop runs on the audio
                // thread but allocates nothing and is bounded.
                this._queue.length = 0;
                this._queueHead = 0;
                for (let note = 0; note < 128; note++) {
                    inst.note_off(note);
                }
                break;
            case 'param': {
                const rustName = camelToSnake(msg.name);
                inst.set_param(rustName, msg.value);
                break;
            }
            case 'paramAutomation':
                break;
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

    _applyParamAutomation(frame: number): void {
        const inst = this._instance;
        if (!inst) {
            return;
        }
        for (let scheduleIndex = 0; scheduleIndex < this._paramAutomation.length; scheduleIndex++) {
            const schedule = this._paramAutomation[scheduleIndex]!;
            while (
                schedule.segmentIndex < schedule.segments.length - 1 &&
                frame >= schedule.segments[schedule.segmentIndex]!.endFrame
            ) {
                schedule.segmentIndex++;
            }
            const segment = schedule.segments[schedule.segmentIndex]!;
            let value = segment.startValue;
            if (segment.endFrame <= segment.startFrame || frame >= segment.endFrame) {
                value = segment.endValue;
            } else if (frame > segment.startFrame) {
                const fraction = (frame - segment.startFrame) / (segment.endFrame - segment.startFrame);
                value = segment.startValue + (segment.endValue - segment.startValue) * fraction;
            }
            if (value !== schedule.lastValue) {
                inst.set_param(schedule.rustName, value);
                schedule.lastValue = value;
            }
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
        this._applyParamAutomation(currentFrame);

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
