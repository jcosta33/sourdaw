/**
 * ToasterNode — AudioWorkletNode wrapper for the Toaster drum machine.
 *
 * Same pattern as FermenterNode: caches the compiled WASM module, resumes AudioContext,
 * provides noteOn/noteOff/setParam/setPadParam via MessagePort.
 */

import { raceAbortSignal } from '#/infra/audioWorklet/raceAbortSignal';
import { createReadyHandshake, ensureWorkletRegistered, fetchWasmModule } from '#/infra/audioWorklet/workletInitShared';
import { INIT_SAB_MESSAGE_TYPE } from '#/infra/audioWorklet/workletPortMessages';
import { logger } from '#/infra/logger/appLogger';

import { STEREO_CHANNEL_COUNT } from '../models/ChannelLaw';
import { TOASTER_AUTOMATION_PARAM_IDS } from '../models/ToasterAutomationParams';
import { TOASTER_PAD_PARAM_IDS } from '../models/ToasterPadParamIds';
import toasterProcessorUrl from '../services/toasterProcessor.ts?worker&url';

import {
    createTelemetryReader,
    telemetryAllocator,
    TELEMETRY_SEQ_IDX,
    TOASTER_IDX,
    type TelemetrySlot,
} from './telemetryAllocator';

import type { AudioProcessorLifecycleState } from '../models/AudioEngineState';

const DEFAULT_WASM_URL = '/wasm/daw-dsp/daw_dsp_bg.wasm';
const TOASTER_PAD_COUNT = 16;
/**
 * Re-exported from `models/ToasterAutomationParams` so this node stays the
 * single import site for consumers, while the table itself lives where the
 * AudioWorklet processor may also read it — `services/` cannot import `engine/`,
 * and the worklet's ordinal guard has to be *derived* from this table rather
 * than restate its size. See that file for the ordinal contract.
 */
export { TOASTER_AUTOMATION_PARAM_IDS };

function projectToasterLifecycle(view: Float32Array): AudioProcessorLifecycleState | null {
    switch (view[TOASTER_IDX.lifecycle]) {
        case 0:
            return 'continue';
        case 1:
            return 'continueIfNotQuiet';
        case 2:
            return 'tail';
        case 3:
            return 'sleep';
        case undefined:
            return null;
        default:
            return null;
    }
}

type OfflineAutomationSegment = {
    startFrame: number;
    endFrame: number;
    startValue: number;
    endValue: number;
};
/**
 * The schedule law shared with the worklet's own copy in
 * `services/toasterProcessor.ts` — keep the two identical. Segments chain
 * from the first one, whose opening frame may sit anywhere at or past 0
 * (#4744): a clip-scoped lane on a clip that starts after the export region
 * start compiles to a stream opening mid-render, and the parameter holds its
 * pre-stream value until that frame — the same thing live playback does.
 */
function isContiguousAutomationSchedule(segments: readonly OfflineAutomationSegment[]): boolean {
    if (segments.length === 0) {
        return false;
    }
    return segments.every((segment, index) => {
        const previous = segments[index - 1];
        return (
            Number.isInteger(segment.startFrame) &&
            Number.isInteger(segment.endFrame) &&
            segment.startFrame >= 0 &&
            segment.endFrame >= segment.startFrame &&
            (index === 0 || segment.startFrame === previous?.endFrame) &&
            Number.isFinite(segment.startValue) &&
            Number.isFinite(segment.endValue)
        );
    });
}

type ScheduleToasterHitInput = {
    pad: number;
    velocity: number;
    midiNote?: number;
    sampleFrame: number;
    padParams: Array<{ name: string; value: number }>;
    fillCondition?: 'fill' | 'not-fill';
};

/**
 * Translate a scheduled hit's named pad locks to their numeric
 * `TOASTER_PAD_PARAM_IDS` entries — here, on the main thread, never in the
 * worklet: `scheduledHit` is dispatched inside `process()`, where the
 * string-keyed `set_pad_param` glue heap-allocates once per locked parameter
 * per hit (#4633). A name without an id is dropped. The old path forwarded it
 * verbatim to Rust, where the snake_case spellings of these same 17 names and
 * a handful of synth params (`snappy`, `base_freq`, …) would have applied —
 * but no producer, current or historical, ever writes those keys into a
 * step's `paramLocks` (only persisted, hand-edited pattern JSON could carry
 * them), so dropping them narrows no reachable behavior (#4842 review).
 */
function toScheduledPadParamIds(
    padParams: Array<{ name: string; value: number }>
): Array<{ id: number; value: number }> {
    const mapped: Array<{ id: number; value: number }> = [];
    for (const param of padParams) {
        const id = Object.hasOwn(TOASTER_PAD_PARAM_IDS, param.name) ? TOASTER_PAD_PARAM_IDS[param.name] : undefined;
        if (id !== undefined) {
            mapped.push({ id, value: param.value });
        }
    }
    return mapped;
}

export type ToasterNodeResult = {
    workletNode: AudioWorkletNode;
    outputNode: GainNode;
    noteOn: (pad: number, velocity: number, midiNote?: number, sampleFrame?: number) => void;
    noteOff: (pad: number, sampleFrame?: number) => void;
    scheduleHit: (input: ScheduleToasterHitInput) => void;
    cancelScheduled: () => void;
    allNotesOff: () => void;
    setFillActive: (active: boolean) => void;
    setParam: (name: string, value: number) => void;
    acceptsScheduledParam: (name: string) => boolean;
    scheduleParam: (name: string, segments: readonly OfflineAutomationSegment[]) => void;
    setPadParam: (pad: number, name: string, value: number) => void;
    setPadDryRouted: (pad: number, routed: boolean) => void;
    setBypass: (bypassed: boolean) => void;
    processorLifecycle: () => AudioProcessorLifecycleState | null;
    connectPadOutput?: (pad: number, dest: AudioNode) => void;
    disconnectPadOutput?: (pad: number, dest: AudioNode) => void;
    connect: (dest: AudioNode) => void;
    disconnect: () => void;
    destroy: () => void;
    ready: Promise<Record<string, unknown>>;
};

export function isToasterDevice(deviceType: string): boolean {
    return deviceType === 'toaster';
}

export async function createToasterNode(
    ctx: BaseAudioContext,
    wasmUrl?: string,
    onFault?: (message: string) => void,
    signal?: AbortSignal
): Promise<ToasterNodeResult> {
    if (ctx instanceof AudioContext && ctx.state === 'suspended') {
        await raceAbortSignal(ctx.resume(), signal);
    }

    await raceAbortSignal(ensureWorkletRegistered(ctx, toasterProcessorUrl), signal);
    const wasmLease = await raceAbortSignal(
        fetchWasmModule({ ctx, bundleId: 'daw-dsp', url: wasmUrl ?? DEFAULT_WASM_URL, signal }),
        signal
    );

    signal?.throwIfAborted();

    let node: AudioWorkletNode;
    try {
        node = new AudioWorkletNode(ctx, 'toaster-processor', {
            numberOfInputs: 0,
            numberOfOutputs: 1 + TOASTER_PAD_COUNT,
            outputChannelCount: Array.from({ length: 1 + TOASTER_PAD_COUNT }, () => STEREO_CHANNEL_COUNT),
            channelCount: STEREO_CHANNEL_COUNT,
            channelCountMode: 'explicit',
            processorOptions: { wasmModule: wasmLease.module },
        });
        wasmLease.commit();
    } catch (error) {
        wasmLease.release();
        throw error;
    }
    const outputNode = ctx.createGain();
    outputNode.gain.value = 1;
    node.connect(outputNode, 0, 0);
    const padOutputGains = Array.from({ length: TOASTER_PAD_COUNT }, (_, pad) => {
        const gainNode = ctx.createGain();
        gainNode.gain.value = 1;
        node.connect(gainNode, pad + 1, 0);
        return gainNode;
    });

    let bypassed = false;
    let slot: TelemetrySlot | null =
        typeof SharedArrayBuffer === 'undefined' ? null : telemetryAllocator.allocateSlot();
    if (slot) {
        node.port.postMessage({ type: INIT_SAB_MESSAGE_TYPE, sab: slot.sab, byteOffset: slot.byteOffset });
    }
    const lifecycleReader = slot ? createTelemetryReader({ slot, project: projectToasterLifecycle }) : null;
    let lastLifecycle: AudioProcessorLifecycleState | null = null;
    let destroyRequested = false;
    let runtimeFaulted = false;
    let portClosed = false;

    function releaseTelemetrySlot(): void {
        if (!slot) {
            return;
        }
        telemetryAllocator.releaseSlot(slot.byteOffset);
        slot = null;
    }

    function closePort(): void {
        if (portClosed) {
            return;
        }
        portClosed = true;
        ctx.removeEventListener('statechange', handleContextStateChange);
        node.onprocessorerror = null;
        node.port.close();
    }

    function handleContextStateChange(): void {
        if (ctx.state !== 'closed') {
            return;
        }
        runtimeFaulted = true;
        releaseTelemetrySlot();
        closePort();
    }

    function handleTerminalFault(message: string, reportToOwner: boolean): void {
        if (runtimeFaulted) {
            return;
        }
        runtimeFaulted = true;
        releaseTelemetrySlot();
        if (reportToOwner) {
            logger.warn('ToasterNode runtime fault (processor terminated):', message);
            try {
                onFault?.(message);
            } catch (callbackError) {
                logger.error(new Error('ToasterNode runtime-failure callback failed', { cause: callbackError }));
            }
        }
        closePort();
    }

    const handshake = createReadyHandshake({ pluginName: 'ToasterNode' });
    node.port.onmessage = (event: MessageEvent<unknown>) => {
        if (event.data && typeof event.data === 'object' && 'type' in event.data && event.data.type === 'disposed') {
            releaseTelemetrySlot();
            closePort();
            return;
        }
        const outcome = handshake.onMessage(event);
        if (event.data && typeof event.data === 'object' && 'type' in event.data && event.data.type === 'error') {
            const message = 'message' in event.data ? String(event.data.message) : 'Unknown error';
            handleTerminalFault(message, outcome === 'late');
        }
    };
    node.onprocessorerror = () => {
        const message = 'ToasterNode worklet processor failed';
        const outcome = handshake.reject(new Error(message));
        handleTerminalFault(message, outcome === 'late');
    };
    ctx.addEventListener('statechange', handleContextStateChange);
    const readyPromise = handshake.promise;

    node.port.postMessage({ type: 'init' });

    return {
        workletNode: node,
        outputNode,
        noteOn(pad: number, velocity: number, midiNote: number = 60, sampleFrame?: number) {
            if (!bypassed) {
                node.port.postMessage({
                    type: 'noteOn',
                    pad,
                    velocity: Math.min(127, Math.max(0, velocity)),
                    note: midiNote,
                    sampleFrame,
                });
            }
        },
        noteOff(pad: number, sampleFrame?: number) {
            node.port.postMessage({ type: 'noteOff', pad, sampleFrame });
        },
        scheduleHit({ pad, velocity, midiNote = 60, sampleFrame, padParams, fillCondition }) {
            if (bypassed) {
                return;
            }
            node.port.postMessage({
                type: 'scheduledHit',
                pad,
                velocity: Math.min(127, Math.max(0, velocity)),
                note: midiNote,
                sampleFrame,
                padParams: toScheduledPadParamIds(padParams),
                fillCondition,
            });
        },
        cancelScheduled() {
            node.port.postMessage({ type: 'cancelScheduled' });
        },
        allNotesOff() {
            node.port.postMessage({ type: 'allNotesOff' });
        },
        setFillActive(active) {
            node.port.postMessage({ type: 'fillState', active });
        },
        setParam(name: string, value: number) {
            if (!Number.isFinite(value)) {
                return;
            }
            node.port.postMessage({ type: 'param', name, value });
        },
        acceptsScheduledParam(name: string) {
            return Object.hasOwn(TOASTER_AUTOMATION_PARAM_IDS, name);
        },
        scheduleParam(name: string, segments: readonly OfflineAutomationSegment[]) {
            const paramId = Object.hasOwn(TOASTER_AUTOMATION_PARAM_IDS, name)
                ? TOASTER_AUTOMATION_PARAM_IDS[name]
                : undefined;
            const valid = paramId !== undefined && isContiguousAutomationSchedule(segments);
            if (valid) {
                node.port.postMessage({ type: 'paramAutomation', paramId, segments });
            }
        },
        setPadParam(pad: number, name: string, value: number) {
            if (Number.isFinite(value)) {
                node.port.postMessage({ type: 'padParam', pad, name, value });
            }
        },
        setPadDryRouted(pad: number, routed: boolean) {
            if (Number.isInteger(pad) && pad >= 0 && pad < TOASTER_PAD_COUNT) {
                node.port.postMessage({ type: 'padDryRouted', pad, routed });
            }
        },
        setBypass(state: boolean) {
            bypassed = state;
        },
        processorLifecycle() {
            if (destroyRequested || runtimeFaulted || !slot || !lifecycleReader) {
                return null;
            }
            const before = Atomics.load(slot.seqView, TELEMETRY_SEQ_IDX);
            if (before === 0 || (before & 1) !== 0) {
                return lastLifecycle;
            }
            const lifecycle = lifecycleReader();
            const after = Atomics.load(slot.seqView, TELEMETRY_SEQ_IDX);
            if (before !== after || (after & 1) !== 0) {
                return lastLifecycle;
            }
            lastLifecycle = lifecycle;
            return lifecycle;
        },
        connectPadOutput(pad: number, dest: AudioNode) {
            if (Number.isInteger(pad) && pad >= 0 && pad < TOASTER_PAD_COUNT) {
                padOutputGains[pad]?.connect(dest);
            }
        },
        disconnectPadOutput(pad: number, dest: AudioNode) {
            if (!Number.isInteger(pad) || pad < 0 || pad >= TOASTER_PAD_COUNT) {
                return;
            }
            try {
                padOutputGains[pad]?.disconnect(dest);
            } catch {
                // The output edge may already have been removed by device teardown.
            }
        },
        connect(dest: AudioNode) {
            outputNode.connect(dest);
        },
        disconnect() {
            try {
                outputNode.disconnect();
            } catch {
                // ignore
            }
        },
        destroy() {
            if (destroyRequested) {
                return;
            }
            destroyRequested = true;
            if (!portClosed && ctx.state !== 'closed') {
                node.port.postMessage({ type: 'resetPadDryRouting' });
            }
            for (const gainNode of padOutputGains) {
                try {
                    gainNode.disconnect();
                } catch {
                    // The pad output may already have been disconnected.
                }
            }
            try {
                outputNode.disconnect();
            } catch {
                // The parent output may already be detached from the track graph.
            }
            try {
                node.disconnect();
            } catch {
                // ignore
            }
            if (ctx.state === 'closed') {
                runtimeFaulted = true;
                releaseTelemetrySlot();
                closePort();
            } else if (!portClosed) {
                node.port.postMessage({ type: 'dispose' });
            }
        },
        ready: readyPromise,
    };
}
