/**
 * AudioWorkletProcessor for the Toaster drum machine.
 *
 * Uses the generated wasm-bindgen JS bindings (daw_dsp.js) via initSync so all
 * WASM memory management is handled by the generated glue — no manual malloc/free.
 *
 * Messages from main thread:
 *   { type: 'init' }
 *   { type: 'noteOn', pad, velocity, note, sampleFrame? }
 *   { type: 'noteOff', pad, sampleFrame? }
 *   { type: 'scheduledHit', pad, velocity, note, sampleFrame, padParams, restoreEngineType? }
 *   { type: 'cancelScheduled' }
 *   { type: 'fillState', active }
 *   { type: 'param', name, value }
 *   { type: 'padParam', pad, name, value }
 *   { type: 'padDryRouted', pad, routed }
 *   { type: 'resetPadDryRouting' }
 */

import { resolveProcessorWasmModule } from '../transformers/resolveProcessorWasmModule';
import { initSync, ToasterInstance } from '../wasm/daw_dsp.js';

/** Pad count the ToasterInstance is created with; the allNotesOff release loop spans 0..PAD_COUNT-1. */
const TOASTER_PAD_COUNT = 16;
const TOASTER_MAX_BLOCK_SIZE = 4096;
const TOASTER_OUTPUT_COUNT = 1 + TOASTER_PAD_COUNT;
const TOASTER_AUTOMATION_PARAM_COUNT = 3;

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
function isParamAutomationSegment(value: unknown): value is ParamAutomationSegment {
    return (
        typeof value === 'object' &&
        value !== null &&
        'startFrame' in value &&
        'endFrame' in value &&
        'startValue' in value &&
        'endValue' in value &&
        typeof value.startFrame === 'number' &&
        typeof value.endFrame === 'number' &&
        typeof value.startValue === 'number' &&
        typeof value.endValue === 'number' &&
        Number.isInteger(value.startFrame) &&
        Number.isInteger(value.endFrame) &&
        value.startFrame >= 0 &&
        value.endFrame >= value.startFrame &&
        Number.isFinite(value.startValue) &&
        Number.isFinite(value.endValue)
    );
}

function isContiguousAutomationSchedule(value: unknown): value is ParamAutomationSegment[] {
    if (!Array.isArray(value) || value.length === 0) {
        return false;
    }
    const candidates: unknown[] = value;
    let previousEndFrame = 0;
    for (const candidate of candidates) {
        if (!isParamAutomationSegment(candidate) || candidate.startFrame !== previousEndFrame) {
            return false;
        }
        previousEndFrame = candidate.endFrame;
    }
    return true;
}

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
    | { type: 'init' }
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
    | { type: 'paramAutomation'; paramId: number; segments: ParamAutomationSegment[] }
    | { type: 'padParam'; pad: number; name: string; value: number }
    | { type: 'padDryRouted'; pad: number; routed: boolean }
    | { type: 'resetPadDryRouting' };

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
    _outputBasePtr = 0;
    _outputViews: Array<[Float32Array, Float32Array]> = [];
    _paramAutomation: ParamAutomationSchedule[] = [];

    constructor(...args: unknown[]) {
        super();
        let wasmModule = resolveProcessorWasmModule(args[0]);
        this.port.onmessage = (event: MessageEvent<ToasterMsg>) => {
            const msg = event.data;
            try {
                if (msg.type === 'init') {
                    if (this._ready) {
                        return;
                    }
                    if (!wasmModule) {
                        throw new TypeError('ToasterProcessor requires a compiled WASM module');
                    }
                    this._initWasm(wasmModule);
                    wasmModule = null;
                } else if (this._ready && !this._faulted) {
                    this._handleMessage(msg);
                }
            } catch (error) {
                // Same policy as the process() catch below. A throw at the wasm
                // boundary may leave the instance trapped, and a trap carries no
                // message, so it cannot be told apart from a recoverable error.
                // Reporting only while `!_ready` left a post-startup fault in a
                // worklet console, with the device still accepting work after.
                console.error('ToasterProcessor error:', error);
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
        this._instance = new ToasterInstance(sampleRate, TOASTER_PAD_COUNT);
        this._cacheOutputViews(this._instance.process(0), this._memory.buffer);
        this._ready = true;
        this.port.postMessage({ type: 'ready' });
    }

    _cacheOutputViews(basePtr: number, memory: ArrayBuffer): void {
        this._outputBasePtr = basePtr;
        this._outputViews = Array.from({ length: TOASTER_OUTPUT_COUNT }, (_, outputIndex) => {
            const firstChannel = outputIndex === 0 ? 0 : 2 + (outputIndex - 1) * 2;
            const leftOffset = basePtr + firstChannel * TOASTER_MAX_BLOCK_SIZE * Float32Array.BYTES_PER_ELEMENT;
            const rightOffset = leftOffset + TOASTER_MAX_BLOCK_SIZE * Float32Array.BYTES_PER_ELEMENT;
            return [
                new Float32Array(memory, leftOffset, TOASTER_MAX_BLOCK_SIZE),
                new Float32Array(memory, rightOffset, TOASTER_MAX_BLOCK_SIZE),
            ];
        });
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
        if (msg.type === 'paramAutomation') {
            if (
                !Number.isInteger(msg.paramId) ||
                msg.paramId < 0 ||
                msg.paramId >= TOASTER_AUTOMATION_PARAM_COUNT ||
                !isContiguousAutomationSchedule(msg.segments)
            ) {
                return;
            }
            const schedule = { paramId: msg.paramId, segments: msg.segments, segmentIndex: 0, lastValue: undefined };
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
            case 'paramAutomation':
                break;
            case 'padParam':
                inst.set_pad_param(msg.pad, PAD_PARAM_MAP[msg.name] ?? msg.name, msg.value);
                break;
            case 'padDryRouted':
                inst.set_pad_dry_routed(msg.pad, msg.routed);
                break;
            case 'resetPadDryRouting':
                inst.reset_pad_dry_routing();
                break;
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

        const parentOutput = outputs[0];
        if (!parentOutput || parentOutput.length < 2) {
            return true;
        }

        const out0 = parentOutput[0];
        if (!out0) {
            return true;
        }
        const frames = out0.length;
        if (frames > TOASTER_MAX_BLOCK_SIZE) {
            // The WASM instance has fixed RT buffers. An unexpected oversized
            // quantum is silenced without advancing DSP state or reading past them.
            for (const output of outputs) {
                for (const channel of output) {
                    channel.fill(0);
                }
            }
            return true;
        }

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
            // Re-read the live buffer AFTER process(): a Rust-side allocation can
            // grow the linear memory mid-call and detach the pre-call `mem`, so the
            // cache must revalidate against the CURRENT buffer (audit RT-7).
            // Comparing the stale cache against the equally-stale `mem` would match
            // after a mid-process grow and skip the rebuild, leaving the output
            // views mapping detached (NaN/zero) memory.
            const liveMem = this._memory?.buffer ?? mem;
            const cachedMemory = this._outputViews[0]?.[0].buffer;
            if (leftPtr !== this._outputBasePtr || cachedMemory !== liveMem) {
                this._cacheOutputViews(leftPtr, liveMem);
            }

            const outputCount = Math.min(outputs.length, this._outputViews.length);
            for (let outputIndex = 0; outputIndex < outputCount; outputIndex++) {
                const output = outputs[outputIndex];
                const views = this._outputViews[outputIndex];
                if (!output || !views) {
                    continue;
                }
                const outLeft = output[0];
                const outRight = output[1];
                for (let frame = 0; frame < frames; frame++) {
                    if (outLeft) {
                        outLeft[frame] = views[0][frame]!;
                    }
                    if (outRight) {
                        outRight[frame] = views[1][frame]!;
                    }
                }
            }
        } catch (error) {
            this._faulted = true;
            this.port.postMessage({ type: 'error', message: String(error) });
        }

        return true;
    }
}

registerProcessor('toaster-processor', ToasterProcessor);
