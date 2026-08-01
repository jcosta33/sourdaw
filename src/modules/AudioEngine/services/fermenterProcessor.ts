/**
 * AudioWorkletProcessor for the Fermenter synthesizer.
 *
 * Uses the generated wasm-bindgen JS bindings (daw_dsp.js) via initSync so all
 * WASM memory management is handled by the generated glue — no manual malloc/free.
 *
 * Messages from main thread:
 *   { type: 'init' }
 *   { type: 'init-sab', sab: SharedArrayBuffer, byteOffset: number }
 *   { type: 'noteOn', note, velocity, sampleFrame? }
 *   { type: 'noteOff', note, sampleFrame? }
 *   { type: 'param', name, value }
 *
 * Telemetry (peaks + oscilloscope waveform) is published into the SAB slot under
 * the shared seqlock (audit RT-3). It used to be a `postMessage` carrying a
 * freshly-allocated `Float32Array(128)` with a transfer list, issued from inside
 * `process()` — an allocation *and* a MessagePort send on the render thread.
 * Neither remains: steady-state `process()` now performs plain stores into an
 * already-mapped view between two `Atomics` counter bumps.
 */

import { resolveProcessorWasmModule } from '../transformers/resolveProcessorWasmModule';
import { initSync, FermenterInstance } from '../wasm/daw_dsp.js';

import { beginTelemetryPublish, endTelemetryPublish } from './telemetrySeqlock';
import { WasmView } from './wasmView';

const AUTOMATION_PARAM_COUNT = 15;

// Fermenter telemetry SAB layout. Duplicated (not imported) from
// engine/telemetryAllocator.ts on purpose — worklet code stays isolated from app
// modules, so both sides pin the same literals and the processor specs assert
// against them. Must match FERMENTER_IDX / FERMENTER_SLOT_FLOATS there.
const TELEMETRY_SLOT_FLOATS = 160;
const TELEMETRY_PEAK_L_IDX = 0;
const TELEMETRY_PEAK_R_IDX = 1;
const TELEMETRY_SCOPE_BASE = 32;
const TELEMETRY_SCOPE_SAMPLES = 128;

/** Publish cadence in frames (~46 ms at 44.1 kHz) — unchanged from the port era. */
const TELEMETRY_PERIOD_FRAMES = 2048;

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
    paramId: number;
    segments: ParamAutomationSegment[];
    segmentIndex: number;
    lastValue: number | undefined;
};

/**
 * MPE per-note expression (audit MD-2). Values arrive already normalised to
 * engine units by `applyNoteExpression`, so the worklet only routes them.
 */
type NoteExpressionMsg = {
    type: 'noteExpression';
    note: number;
    channel: number;
    bendSemitones: number;
    pressure: number;
    slide: number;
    sampleFrame?: number;
};
type FermenterMsg =
    | { type: 'init' }
    | { type: 'init-sab'; sab: SharedArrayBuffer; byteOffset: number }
    | { type: 'noteOn'; note: number; velocity: number; sampleFrame?: number; channel?: number }
    | { type: 'noteOff'; note: number; sampleFrame?: number; channel?: number }
    | NoteExpressionMsg
    | { type: 'allNotesOff' }
    | { type: 'param'; name: string; value: number }
    | { type: 'paramAutomation'; paramId: number; segments: ParamAutomationSegment[] }
    | { type: 'patch'; patch: Record<string, number | number[]> };

type FermenterQueued =
    | { type: 'noteOn'; note: number; velocity: number; sampleFrame: number; channel?: number }
    | { type: 'noteOff'; note: number; sampleFrame: number; channel?: number }
    | (NoteExpressionMsg & { sampleFrame: number });

class FermenterProcessor extends AudioWorkletProcessor {
    _instance: FermenterInstance | null = null;
    _memory: WebAssembly.Memory | null = null;
    _ready = false;
    _faulted = false;
    _queue: FermenterQueued[] = [];
    _queueHead = 0;
    _paramAutomation: ParamAutomationSchedule[] = [];
    /** Telemetry slot floats (peaks + scope waveform); null until `init-sab`. */
    _telemetryView: Float32Array | null = null;
    /** Int32 view over the same slot bytes — carries the seqlock counter (RT-2/RT-3). */
    _telemetrySeqView: Int32Array | null = null;
    // Cached WASM linear-memory views — reused across render quanta so process()
    // performs no per-block Float32Array allocation (audit RT-1); each revalidates
    // on a memory.grow() buffer-identity change (audit RT-7). See wasmView.ts.
    _outLeftView = new WasmView();
    _outRightView = new WasmView();

    constructor(...args: unknown[]) {
        super();
        let wasmModule = resolveProcessorWasmModule(args[0]);
        this.port.onmessage = (event: MessageEvent<FermenterMsg>) => {
            const msg = event.data;
            try {
                if (msg.type === 'init') {
                    if (this._ready) {
                        return;
                    }
                    if (!wasmModule) {
                        throw new TypeError('FermenterProcessor requires a compiled WASM module');
                    }
                    this._initWasm(wasmModule);
                    wasmModule = null;
                } else if (msg.type === 'init-sab') {
                    this._telemetryView = new Float32Array(msg.sab, msg.byteOffset, TELEMETRY_SLOT_FLOATS);
                    this._telemetrySeqView = new Int32Array(msg.sab, msg.byteOffset, TELEMETRY_SLOT_FLOATS);
                } else if (this._ready && !this._faulted) {
                    this._handleMessage(msg);
                }
            } catch (error) {
                // Same policy as the process() catch below. A throw at the wasm
                // boundary may leave the instance trapped, and a trap carries no
                // message, so it cannot be told apart from a recoverable error.
                // Reporting only while `!_ready` left a post-startup fault in a
                // worklet console, with the device still accepting work after.
                console.error('FermenterProcessor error:', error);
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
            if (
                !Number.isInteger(msg.paramId) ||
                msg.paramId < 0 ||
                msg.paramId >= AUTOMATION_PARAM_COUNT ||
                msg.segments.length === 0
            ) {
                return;
            }
            const schedule: ParamAutomationSchedule = {
                paramId: msg.paramId,
                segments: msg.segments,
                segmentIndex: 0,
                lastValue: undefined,
            };
            const existingIndex = this._paramAutomation.findIndex(
                (candidate) => candidate.paramId === schedule.paramId
            );
            if (existingIndex >= 0) {
                this._paramAutomation[existingIndex] = schedule;
            } else {
                this._paramAutomation.push(schedule);
            }
            return;
        }
        if (
            (msg.type === 'noteOn' || msg.type === 'noteOff' || msg.type === 'noteExpression') &&
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
            // Both are consumed by the constructor's port handler and never
            // reach the dispatcher; listed so the switch stays exhaustive.
            case 'init':
            case 'init-sab':
                break;
            case 'noteOn':
                inst.note_on_with_channel(msg.note, msg.velocity, msg.channel ?? 0);
                break;
            case 'noteOff':
                // Without a channel every voice at the pitch is released —
                // the historical behaviour channel-unaware callers rely on.
                if (msg.channel === undefined) {
                    inst.note_off(msg.note);
                } else {
                    inst.note_off_on_channel(msg.note, msg.channel);
                }
                break;
            case 'noteExpression':
                // MPE per-note expression (audit MD-2). Scheduled expression
                // carries the note's own start frame and is enqueued behind the
                // noteOn at that frame, so the voice exists before it is bent.
                inst.note_expression(msg.note, msg.channel, msg.bendSemitones, msg.pressure, msg.slide);
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
            if (!queued || queued.sampleFrame >= blockEndFrame) {
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
                inst.set_param_by_id(schedule.paramId, value);
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

        try {
            const inst = this._instance;
            const mem = this._memory?.buffer;
            if (!inst || !mem) {
                return true;
            }

            this._applyParamAutomation(currentFrame);
            const leftPtr = inst.process(frames);
            const rightPtr = inst.get_right_ptr();

            // Re-read the live buffer AFTER process(): a Rust-side allocation can
            // grow the linear memory mid-call and detach the previous buffer, so the
            // output views (also read below for peak/scope telemetry) must map the
            // post-grow buffer (audit RT-7). Steady state reuses the cached view.
            const outMem = this._memory?.buffer ?? mem;

            const outL = this._outLeftView.get(outMem, leftPtr, frames);
            out0.set(outL);

            const out1 = output[1];
            let outR: Float32Array | null = null;
            if (out1) {
                outR = this._outRightView.get(outMem, rightPtr, frames);
                out1.set(outR);
            }

            // Publish telemetry (peaks + scope waveform) every 2048 frames
            // (~46 ms at 44.1 kHz) into the SAB slot (audit RT-3). Every store
            // below targets the already-mapped `telemetryView`, so this branch
            // allocates nothing and sends no port message; the two Atomics bumps
            // bracketing it are the shared seqlock, so a main-thread poll landing
            // mid-publish retries instead of pairing a new peak with a half-written
            // waveform. Skipped entirely when no slot was supplied.
            const telemetryView = this._telemetryView;
            if (telemetryView && currentFrame % TELEMETRY_PERIOD_FRAMES < frames) {
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
                const step = frames / TELEMETRY_SCOPE_SAMPLES;
                beginTelemetryPublish(this._telemetrySeqView);
                telemetryView[TELEMETRY_PEAK_L_IDX] = peakL;
                telemetryView[TELEMETRY_PEAK_R_IDX] = peakR;
                for (let index = 0; index < TELEMETRY_SCOPE_SAMPLES; index++) {
                    telemetryView[TELEMETRY_SCOPE_BASE + index] = outL[Math.floor(index * step)] ?? 0;
                }
                endTelemetryPublish(this._telemetrySeqView);
            }
        } catch (error) {
            this._faulted = true;
            this.port.postMessage({ type: 'error', message: String(error) });
        }

        return true;
    }
}

registerProcessor('fermenter-processor', FermenterProcessor);
