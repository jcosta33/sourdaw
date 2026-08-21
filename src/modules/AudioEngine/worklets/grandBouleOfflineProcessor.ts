/**
 * Retained inline Grand Boule host for focused offline transport tests.
 *
 * Released daw-dsp WASM supplies no Grand Boule constructor, and release
 * admission withholds this path. Tests inject a structural instance. This is a
 * sibling of `grandBouleProcessor`, not a mode of it. That one is a
 * SharedArrayBuffer ring consumer whose `process()` copies published frames out
 * of a ring the engine Worker fills; this one owns a `GrandBouleInstance` and
 * renders the block itself. The two share no field and no line of `process()`,
 * and threading a flag through a single class would produce exactly the
 * which-branch-am-I-in bugs this change exists to close.
 *
 * ## Why offline gets its own transport
 *
 * An `OfflineAudioContext` has no system-level audio callback, so it has no load
 * value and no underrun (Web Audio §2.6), and §2.2 puts its rendering on "a
 * normal thread". A worklet that takes 20 ms to fill a 2.667 ms quantum offline
 * produces bit-identical audio and a slower render. The ring therefore protects
 * against a deadline that does not exist offline, while its `TARGET_AHEAD`
 * back-pressure and macrotask pacing are what starve an export into 97–99 %
 * silence (INVENTORY-device-clock-parity G-1). The consumer cannot even wait for
 * the producer: `Atomics.wait` is banned in `AudioWorkletGlobalScope`, and the
 * working group explicitly refused to relax that for the offline case.
 *
 * The retained Worker-ring design isolates producer load from the consumer.
 *
 * ## Clock
 *
 * One clock, no sync plane. `drainNoteQueue(currentFrame + frames)` with the
 * exclusive `>=` bound the sibling processors share. Offline this is *more*
 * accurate than live: every note is posted before `startRendering()`, so the
 * queue is fully populated at frame 0 and no anchor has to stand in for a
 * measurement that has not happened.
 *
 * Messages from the main thread:
 *   `processorOptions.wasmModule: WebAssembly.Module`
 *   { type: 'init' }
 *   → { type: 'ready' }
 *   every member of `GrandBouleDispatchMsg`
 */

import { resolveProcessorWasmModule } from '../transformers/resolveProcessorWasmModule';

import {
    createGrandBouleBlockViews,
    createGrandBouleInstance,
    createGrandBouleNoteQueue,
    dispatch,
    receiveGrandBouleMessage,
    type GrandBouleDispatchMsg,
} from './grandBouleEngineCore';
import { type GrandBouleInstance } from './grandBouleWasmInstance';

/**
 * The Web Audio render quantum. Restated here rather than imported: worklet code
 * stays isolated from app modules, and `offlineRender/constants.ts` is one.
 */
const RENDER_QUANTUM_FRAMES = 128;

/** `GrandBouleInstance::process` pre-allocates this much; asking for more truncates. */
const MAX_BLOCK_FRAMES = 4096;

type RuntimeHealthCheckMessage = { type: 'runtimeHealthCheck'; requestId: number };
type OfflineAutomationSegment = {
    startFrame: number;
    endFrame: number;
    startValue: number;
    endValue: number;
};
type GrandBouleAutomationParam = 'masterGain' | 'soundboardSend' | 'sympatheticSend' | 'lidPosition' | 'micPosition';
type GrandBouleParamAutomationMessage = {
    type: 'paramAutomation';
    name: GrandBouleAutomationParam;
    segments: readonly OfflineAutomationSegment[];
};
type GrandBouleControlMessage = GrandBouleDispatchMsg | GrandBouleParamAutomationMessage;
type ScheduledParam = {
    name: GrandBouleAutomationParam;
    segments: readonly OfflineAutomationSegment[];
    segmentIndex: number;
    complete: boolean;
};

function isValidAutomationMessage(message: GrandBouleParamAutomationMessage): boolean {
    if (automationSlotFor(message.name) === null || message.segments.length === 0) {
        return false;
    }
    let previousEndFrame = 0;
    for (const segment of message.segments) {
        if (
            !Number.isInteger(segment.startFrame) ||
            !Number.isInteger(segment.endFrame) ||
            segment.startFrame < previousEndFrame ||
            segment.endFrame < segment.startFrame ||
            !Number.isFinite(segment.startValue) ||
            !Number.isFinite(segment.endValue)
        ) {
            return false;
        }
        previousEndFrame = segment.endFrame;
    }
    return true;
}

function automationSlotFor(name: string): number | null {
    switch (name) {
        case 'masterGain':
            return 0;
        case 'soundboardSend':
            return 1;
        case 'sympatheticSend':
            return 2;
        case 'lidPosition':
            return 3;
        case 'micPosition':
            return 4;
        default:
            return null;
    }
}

type AutomationFrameValue = { active: boolean; value: number; complete: boolean };

function automationValueAtFrame(schedule: ScheduledParam, frame: number): AutomationFrameValue {
    while (schedule.segmentIndex + 1 < schedule.segments.length) {
        const nextSegment = schedule.segments[schedule.segmentIndex + 1];
        if (!nextSegment || frame < nextSegment.startFrame) {
            break;
        }
        schedule.segmentIndex++;
    }
    const segment = schedule.segments[schedule.segmentIndex];
    if (!segment) {
        return { active: false, value: 0, complete: true };
    }
    if (frame < segment.startFrame) {
        return { active: false, value: segment.startValue, complete: false };
    }
    if (segment.endFrame === segment.startFrame) {
        return {
            active: true,
            value: segment.endValue,
            complete: schedule.segmentIndex === schedule.segments.length - 1,
        };
    }
    if (frame >= segment.endFrame) {
        return {
            active: true,
            value: segment.endValue,
            complete: schedule.segmentIndex === schedule.segments.length - 1,
        };
    }
    if (schedule.name === 'micPosition') {
        return { active: true, value: segment.startValue, complete: false };
    }
    const progress = (frame - segment.startFrame) / (segment.endFrame - segment.startFrame);
    return {
        active: true,
        value: segment.startValue + (segment.endValue - segment.startValue) * progress,
        complete: false,
    };
}

class GrandBouleOfflineProcessor extends AudioWorkletProcessor {
    _instance: GrandBouleInstance | null = null;
    _memory: WebAssembly.Memory | null = null;
    _ready = false;
    _faulted = false;
    _faultMessage: string | null = null;
    _pendingMessages: GrandBouleControlMessage[] = [];
    _paramAutomation: ScheduledParam[][] = [[], [], [], [], []];
    _queue = createGrandBouleNoteQueue();
    // Cached WASM linear-memory views, revalidated on a memory.grow() buffer
    // identity change (audit RT-7). In steady state `update` performs four
    // primitive comparisons and allocates nothing.
    _blockViews = createGrandBouleBlockViews();

    constructor(...args: unknown[]) {
        super();
        let wasmModule = resolveProcessorWasmModule(args[0]);
        this.port.onmessage = (
            event: MessageEvent<{ type: 'init' } | RuntimeHealthCheckMessage | GrandBouleControlMessage>
        ) => {
            const msg = event.data;
            if (msg.type === 'runtimeHealthCheck') {
                this.port.postMessage({
                    type: 'runtimeHealth',
                    requestId: msg.requestId,
                    error: this._faultMessage,
                });
                return;
            }
            try {
                if (msg.type === 'init') {
                    if (this._ready) {
                        return;
                    }
                    if (!wasmModule) {
                        throw new TypeError('GrandBouleOfflineProcessor requires a compiled WASM module');
                    }
                    this._initWasm(wasmModule);
                    wasmModule = null;
                } else if (!this._ready) {
                    this._pendingMessages.push(msg);
                } else if (!this._faulted) {
                    this._handleMessage(msg);
                }
            } catch (error) {
                // Same policy as Crumbs' and Levain's: a throw here is an OOM, a
                // malformed message or a trap left by an earlier panic, and
                // those are not distinguishable from this side. Treat the
                // instance as unrecoverable and say so, so `createGrandBouleNode`
                // rejects and `buildDeviceChain` reports a degraded device
                // rather than shipping an unannounced silent track.
                this._reportFault(error);
            }
        };
    }

    _reportFault(error: unknown): void {
        const message = error instanceof Error ? error.message : String(error);
        console.error('GrandBouleOfflineProcessor error:', error);
        this._faulted = true;
        this._faultMessage = message;
        this.port.postMessage({ type: 'error', message });
    }

    _initWasm(wasmModule: WebAssembly.Module): void {
        const engine = createGrandBouleInstance({ wasmModule, sampleRate });
        this._instance = engine.instance;
        this._memory = engine.memory;
        this._ready = true;

        for (const msg of this._pendingMessages) {
            this._handleMessage(msg);
        }
        this._pendingMessages = [];

        this.port.postMessage({ type: 'ready' });
    }

    _handleMessage(msg: GrandBouleControlMessage): void {
        const instance = this._instance;
        if (!instance) {
            return;
        }
        if (msg.type === 'paramAutomation') {
            if (!isValidAutomationMessage(msg)) {
                return;
            }
            const slot = automationSlotFor(msg.name);
            if (slot !== null) {
                this._paramAutomation[slot]?.push({
                    name: msg.name,
                    segments: msg.segments,
                    segmentIndex: 0,
                    complete: false,
                });
            }
            return;
        }
        // Offline scheduling posts the complete part before rendering starts.
        // Hold a note exactly on the next frame so frame-zero automation reaches
        // the sleeping engine first; preserve the shared host behavior for notes
        // already inside the remainder of the current quantum and for late notes.
        const holdAtCurrentFrame =
            (msg.type === 'noteOn' || msg.type === 'noteOff' || msg.type === 'noteExpression') &&
            msg.sampleFrame === currentFrame;
        receiveGrandBouleMessage({
            instance,
            queue: this._queue,
            msg,
            blockEndFrame: holdAtCurrentFrame ? currentFrame : currentFrame + RENDER_QUANTUM_FRAMES,
        });
    }

    _applyAutomation(instance: GrandBouleInstance, frame: number, blockEndFrame: number): void {
        for (let slot = 0; slot < this._paramAutomation.length; slot++) {
            const schedules = this._paramAutomation[slot];
            if (!schedules) {
                continue;
            }
            let retainedCount = 0;
            for (let scheduleIndex = 0; scheduleIndex < schedules.length; scheduleIndex++) {
                const schedule = schedules[scheduleIndex];
                if (!schedule) {
                    continue;
                }
                let next = automationValueAtFrame(schedule, frame);
                const upcomingStart = schedule.segments[schedule.segmentIndex]?.startFrame;
                if (!next.active && upcomingStart !== undefined && upcomingStart < blockEndFrame) {
                    next = automationValueAtFrame(schedule, upcomingStart);
                }
                if (!next.active) {
                    schedules[retainedCount] = schedule;
                    retainedCount++;
                } else {
                    dispatch(instance, { type: 'param', name: schedule.name, value: next.value });
                    schedule.complete = next.complete;
                    if (!schedule.complete) {
                        schedules[retainedCount] = schedule;
                        retainedCount++;
                    }
                }
            }
            schedules.length = retainedCount;
        }
    }

    process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
        const instance = this._instance;
        if (!this._ready || !instance || this._faulted) {
            return true;
        }

        const output = outputs[0];
        if (!output || output.length === 0) {
            return true;
        }

        const out0 = output[0];
        if (!out0) {
            return true;
        }
        const frames = out0.length;
        const processFrames = Math.min(frames, MAX_BLOCK_FRAMES);

        // Apply the block's parameter state before waking any note in it. The
        // sleeping engine snaps parameters; reversing this order creates an
        // audible 20 ms glide from defaults at the start of an offline part.
        this._applyAutomation(instance, currentFrame, currentFrame + frames);

        // Voice everything that belongs in the block about to be produced. The
        // engine has no sub-block note offset, so the block boundary is the only
        // place a note can be placed at all. Exclusive bound: a note landing
        // exactly on `currentFrame + frames` belongs to the next block.
        this._queue.drain(instance, currentFrame + frames);

        try {
            const mem = this._memory?.buffer;
            if (!mem) {
                return true;
            }

            const leftPtr = instance.process(processFrames);
            const rightPtr = instance.get_right_ptr();

            // Re-read the live buffer AFTER process(): a Rust-side allocation
            // can grow linear memory mid-call and detach the previous buffer.
            const outMem = this._memory?.buffer ?? mem;

            this._blockViews.update(outMem, leftPtr, rightPtr, processFrames);
            out0.set(this._blockViews.left);
            const out1 = output[1];
            if (out1) {
                out1.set(this._blockViews.right);
            }
        } catch (error) {
            this._reportFault(error);
        }

        return true;
    }
}

registerProcessor('grand-boule-offline-processor', GrandBouleOfflineProcessor);
