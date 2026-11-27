/**
 * GrinderNode — AudioWorkletNode wrapper for the Grinder amp simulator.
 */

import { raceAbortSignal } from '#/infra/audioWorklet/raceAbortSignal';
import { createReadyHandshake, ensureWorkletRegistered, fetchWasmModule } from '#/infra/audioWorklet/workletInitShared';
import { INIT_SAB_MESSAGE_TYPE, LATENCY_CHANGED_MESSAGE_TYPE } from '#/infra/audioWorklet/workletPortMessages';
import { logger } from '#/infra/logger/appLogger';

import { STEREO_CHANNEL_COUNT } from '../models/ChannelLaw';
import { GRINDER_LIVE_PARAMETER_IDS, isGrinderRuntimeParameter } from '../models/GrinderRuntimeControl';
import { GRINDER_PARAMETER_TIME_CONSTANT } from '../models/GrinderTimedParameterControl';
import { SET_FALLBACK_PARAM_COMMAND, type RuntimeDeviceControlTarget } from '../models/RuntimeDeviceControl';
import { GRINDER_PRESET_RESULT, type RuntimeGrinderPresetInput } from '../models/RuntimeGrinderPreset';
import { compileRuntimeDeviceControl } from '../services/compileRuntimeDeviceControl';
import { compileRuntimeGrinderNeuralPatch } from '../services/compileRuntimeGrinderNeuralPatch';
import grinderProcessorUrl from '../worklets/grinderProcessor.ts?worker&url';

import { createGrinderNodeMeter, type GrinderMeterData } from './createGrinderNodeMeter';
import {
    createGrinderPresetControl,
    createGrinderTimedParameters,
    type GrinderPresetControl,
} from './GrinderPresetControl';
import { requireSharedArrayBuffer } from './pluginHostingErrors';
import { telemetryAllocator, type TelemetrySlot } from './telemetryAllocator';

const DEFAULT_WASM_URL = '/wasm/daw-dsp/daw_dsp_bg.wasm';

export type { GrinderMeterData } from './createGrinderNodeMeter';

export type GrinderNodeResult = {
    workletNode: AudioWorkletNode;
    setParam: (name: string, value: number, sampleFrame?: number) => void;
    setPatch: (patch: Record<string, unknown>) => void;
    applyPreset?: (input: RuntimeGrinderPresetInput) => Promise<void>;
    setBypass: (bypassed: boolean) => void;
    reset: () => void;
    onMeterData: (cb: (data: GrinderMeterData) => void) => void;
    onLatencyChanged: (cb: (latency: number) => void) => void;
    connect: (dest: AudioNode) => void;
    disconnect: () => void;
    destroy: () => void;
    ready: Promise<Record<string, unknown>>;
    completeOfflineSetup?: () => Promise<void>;
};

const CONTROL_DEADLINE_FRAMES = 128;
let nextWorkletControlGeneration = 1;

type PendingParamPost = Readonly<{
    value: number;
    targetFrame: number | null;
    deadlineFrame: number | null;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSampleFrame(value: number | undefined): value is number {
    return value !== undefined && Number.isSafeInteger(value) && value >= 0;
}

function allocateWorkletControlGeneration(): number {
    const generation = nextWorkletControlGeneration;
    if (generation >= Number.MAX_SAFE_INTEGER) {
        nextWorkletControlGeneration = 1;
    } else {
        nextWorkletControlGeneration++;
    }
    return generation;
}

function toControlScheduling(sampleFrame: number | undefined): Readonly<{
    targetFrame: number | null;
    deadlineFrame: number | null;
}> {
    if (!Number.isSafeInteger(sampleFrame) || sampleFrame === undefined || sampleFrame < 0) {
        return { targetFrame: null, deadlineFrame: null };
    }
    const deadlineFrame = sampleFrame + CONTROL_DEADLINE_FRAMES;
    if (!Number.isSafeInteger(deadlineFrame)) {
        return { targetFrame: null, deadlineFrame: null };
    }
    return { targetFrame: sampleFrame, deadlineFrame };
}

function toAudioParamTime(context: BaseAudioContext, sampleFrame: number | undefined): number {
    if (!Number.isSafeInteger(sampleFrame) || sampleFrame === undefined || sampleFrame < 0) {
        return context.currentTime;
    }
    return Math.max(context.currentTime, sampleFrame / context.sampleRate);
}

function matchesOfflineSetupReady(
    data: object,
    expected: RuntimeDeviceControlTarget | undefined,
    generation: number,
    sequence: number
): boolean {
    const target = 'target' in data ? data.target : undefined;
    const correlation = 'correlation' in data ? data.correlation : undefined;
    if (
        !expected ||
        !('schemaVersion' in data) ||
        data.schemaVersion !== 1 ||
        !('sampleFrame' in data) ||
        data.sampleFrame !== 0 ||
        !('type' in data) ||
        data.type !== 'ready' ||
        !target ||
        typeof target !== 'object' ||
        !('trackId' in target) ||
        target.trackId !== expected.trackId ||
        !('deviceId' in target) ||
        target.deviceId !== expected.deviceId ||
        !('deviceType' in target) ||
        target.deviceType !== expected.deviceType ||
        !correlation ||
        typeof correlation !== 'object' ||
        !('workletGeneration' in correlation) ||
        correlation.workletGeneration !== generation ||
        !('controlSequence' in correlation) ||
        correlation.controlSequence !== sequence
    ) {
        return false;
    }
    return true;
}

function createGrinderFallbackControlTarget({
    target,
    offline,
}: {
    target: RuntimeDeviceControlTarget | undefined;
    offline: boolean;
}) {
    if (!target) {
        return undefined;
    }
    const capturedParameterIds = Object.freeze([
        ...new Set([...target.parameterIds.filter(isGrinderRuntimeParameter), 'bypass']),
    ]);
    let parameterIds = capturedParameterIds;
    if (!offline) {
        parameterIds = Object.freeze([...new Set([...capturedParameterIds, ...GRINDER_LIVE_PARAMETER_IDS])]);
    }
    return Object.freeze({
        trackId: target.trackId,
        deviceId: target.deviceId,
        deviceType: target.deviceType,
        capturedParameterIds,
        parameterIds,
    });
}

export function isGrinderDevice(deviceType: string): boolean {
    return deviceType === 'grinder';
}

function attachPresetControl(result: GrinderNodeResult, control: GrinderPresetControl | null): void {
    if (control) {
        result.applyPreset = (input) => control.applyPreset(input);
    }
}

export async function createGrinderNode(
    ctx: BaseAudioContext,
    wasmUrl?: string,
    signal?: AbortSignal,
    controlTarget?: RuntimeDeviceControlTarget,
    onRuntimeFailure?: (message: string) => void
): Promise<GrinderNodeResult> {
    // Grinder's neural-amp telemetry uses a SAB slot. Fail fast if the
    // environment cannot provide one — see `buildDeviceChain` for the UX path.
    requireSharedArrayBuffer('Grinder');

    if (ctx instanceof AudioContext && ctx.state === 'suspended') {
        await raceAbortSignal(ctx.resume(), signal);
    }

    await raceAbortSignal(ensureWorkletRegistered(ctx, grinderProcessorUrl), signal);
    const wasmLease = await raceAbortSignal(
        fetchWasmModule({ ctx, bundleId: 'daw-dsp', url: wasmUrl ?? DEFAULT_WASM_URL, signal }),
        signal
    );

    signal?.throwIfAborted();

    const offline = typeof OfflineAudioContext !== 'undefined' && ctx instanceof OfflineAudioContext;
    const fallbackControlTarget = createGrinderFallbackControlTarget({ target: controlTarget, offline });
    const timedParameters = createGrinderTimedParameters(fallbackControlTarget, offline);
    let node: AudioWorkletNode;
    try {
        node = new AudioWorkletNode(ctx, 'grinder-processor', {
            numberOfInputs: 1,
            numberOfOutputs: 1,
            outputChannelCount: [STEREO_CHANNEL_COUNT],
            channelCount: STEREO_CHANNEL_COUNT,
            channelCountMode: 'explicit',
            processorOptions: { wasmModule: wasmLease.module, grinderTimedParameters: timedParameters?.buffer },
        });
        wasmLease.commit();
    } catch (error) {
        wasmLease.release();
        throw error;
    }

    let slot: TelemetrySlot | null = telemetryAllocator.allocateSlot();
    const meter = createGrinderNodeMeter(slot);
    let destroyed = false;

    if (slot) {
        node.port.postMessage({ type: INIT_SAB_MESSAGE_TYPE, sab: slot.sab, byteOffset: slot.byteOffset });
    }

    // Per-frame coalescing applies only to immediate message-port controls
    // (those without a backing AudioParam). Scheduled automation carries a
    // sample-frame contract and is posted in call order without coalescing.
    const pendingParamPosts = new Map<string, PendingParamPost>();
    let paramFlushRafId: number | null = null;
    const canCoalesce = !offline && typeof requestAnimationFrame === 'function';
    const workletGeneration = allocateWorkletControlGeneration();
    const sequence = { next: 1 };
    let setupHandshake: ReturnType<typeof createReadyHandshake> | null = null;
    let setupSequence = 0;
    let setupPromise: Promise<void> | undefined;
    let runtimeError: Error | null = null;

    const postFallbackControl = (name: string, pending: PendingParamPost): void => {
        if (!fallbackControlTarget || sequence.next > Number.MAX_SAFE_INTEGER) {
            return;
        }
        const result = compileRuntimeDeviceControl(
            {
                schemaVersion: 1,
                command: SET_FALLBACK_PARAM_COMMAND,
                target: {
                    trackId: fallbackControlTarget.trackId,
                    deviceId: fallbackControlTarget.deviceId,
                    deviceType: fallbackControlTarget.deviceType,
                    parameterId: name,
                },
                value: pending.value,
                correlation: {
                    workletGeneration,
                    controlSequence: sequence.next,
                },
                scheduling: {
                    targetFrame: pending.targetFrame,
                    deadlineFrame: pending.deadlineFrame,
                },
            },
            fallbackControlTarget.parameterIds
        );
        if (result.status !== 'compiled') {
            return;
        }
        sequence.next++;
        node.port.postMessage(result.control);
    };

    const postNeuralPatch = (patch: Record<string, unknown>): void => {
        if (!fallbackControlTarget || sequence.next > Number.MAX_SAFE_INTEGER) {
            return;
        }
        const result = compileRuntimeGrinderNeuralPatch({
            schemaVersion: 1,
            command: 'apply-grinder-neural-patch',
            target: {
                trackId: fallbackControlTarget.trackId,
                deviceId: fallbackControlTarget.deviceId,
                deviceType: fallbackControlTarget.deviceType,
            },
            patch,
            correlation: {
                workletGeneration,
                controlSequence: sequence.next,
            },
            scheduling: { targetFrame: null, deadlineFrame: null },
        });
        if (result.status !== 'compiled') {
            return;
        }
        sequence.next++;
        node.port.postMessage(result.patch);
    };

    const flushParamPosts = (): void => {
        if (paramFlushRafId !== null) {
            cancelAnimationFrame(paramFlushRafId);
        }
        paramFlushRafId = null;
        for (const [name, pending] of pendingParamPosts) {
            postFallbackControl(name, pending);
        }
        pendingParamPosts.clear();
    };

    const presetControl = createGrinderPresetControl({
        node,
        ctx,
        target: fallbackControlTarget,
        offline,
        workletGeneration,
        controlSequence: sequence,
        timedParameters,
        getRuntimeError: () => {
            if (destroyed || ctx.state === 'closed') {
                return new Error('Grinder preset requires an open, bound live target');
            }
            return runtimeError;
        },
        flushParamPosts,
        onInstalledLatency: meter.reportPresetLatency,
    });

    const queueParamPost = (name: string, value: number, sampleFrame?: number): void => {
        const scheduling = toControlScheduling(sampleFrame);
        if (!fallbackControlTarget || !fallbackControlTarget.parameterIds.includes(name)) {
            return;
        }
        if (scheduling.targetFrame !== null && !fallbackControlTarget.capturedParameterIds.includes(name)) {
            return;
        }
        const pending = Object.freeze({ value, ...scheduling });
        if (scheduling.targetFrame !== null) {
            // Scheduled fallback controls apply on the render thread. Their latency
            // changes are observable only through the preallocated telemetry slot,
            // so reject them when the pool is exhausted rather than leave PDC stale.
            if (!slot) {
                return;
            }
            postFallbackControl(name, pending);
            return;
        }
        if (!canCoalesce || !fallbackControlTarget.capturedParameterIds.includes(name)) {
            // Offline setup cannot wait for an animation frame. Newly admitted live
            // controls post now so they cannot cross a later structured neural patch.
            postFallbackControl(name, pending);
            return;
        }
        pendingParamPosts.set(name, pending);
        paramFlushRafId ??= requestAnimationFrame(flushParamPosts);
    };

    const handshake = createReadyHandshake({ pluginName: 'GrinderNode' });
    node.port.onmessage = (event: MessageEvent<unknown>) => {
        const data = event.data;
        if (isRecord(data) && data.type === GRINDER_PRESET_RESULT) {
            presetControl?.receivePresetReply(data);
            return;
        }
        if (data && typeof data === 'object' && 'type' in data && data.type === 'error') {
            runtimeError = new Error('message' in data ? String(data.message) : 'GrinderNode processor failed');
            setupHandshake?.reject(runtimeError);
            presetControl?.rejectPendingPresets(runtimeError);
        }
        if (data && typeof data === 'object' && 'phase' in data && data.phase === 'offline-grinder-setup') {
            if (!setupHandshake) {
                return;
            }
            if (!matchesOfflineSetupReady(data, fallbackControlTarget, workletGeneration, setupSequence)) {
                setupHandshake.reject(new Error('GrinderNode offline setup acknowledgement is invalid'));
                return;
            }
            setupHandshake.onMessage(event);
            return;
        }
        const outcome = handshake.onMessage(event);
        if (outcome === 'other') {
            if (
                data &&
                typeof data === 'object' &&
                'type' in data &&
                data.type === LATENCY_CHANGED_MESSAGE_TYPE &&
                'latency' in data &&
                typeof data.latency === 'number'
            ) {
                meter.reportLatencyChange(data.latency);
            }
            return;
        }
        if (
            outcome === 'late' &&
            event.data &&
            typeof event.data === 'object' &&
            'type' in event.data &&
            event.data.type === 'error'
        ) {
            const message = 'message' in event.data ? String(event.data.message) : 'Unknown error';
            logger.warn('GrinderNode runtime fault (WASM panic — processor faulted):', message);
            onRuntimeFailure?.(message);
        }
    };
    const readyPromise = handshake.promise;
    node.onprocessorerror = () => {
        runtimeError = new Error(
            offline ? 'GrinderNode offline processor failed' : 'GrinderNode live processor failed'
        );
        if (handshake.reject(runtimeError) === 'late' && !offline) {
            onRuntimeFailure?.(runtimeError.message);
        }
        setupHandshake?.reject(runtimeError);
        presetControl?.rejectPendingPresets(runtimeError);
    };

    const writeContinuousParam = (name: string, param: AudioParam, value: number, sampleFrame?: number): void => {
        const targetTime = toAudioParamTime(ctx, sampleFrame);
        if (isSampleFrame(sampleFrame)) {
            presetControl?.postContinuousSchedule(name, value, targetTime);
        } else if (presetControl?.isRequestedPresetRate(name)) {
            // Keep this write ordered even while the worklet's preset receipt is in flight.
            postFallbackControl(name, { value, targetFrame: null, deadlineFrame: null });
        }
        if (!presetControl?.isInstalledRate(name)) {
            param.setTargetAtTime(value, targetTime, GRINDER_PARAMETER_TIME_CONSTANT);
        }
    };

    const completeOfflineSetup = (): Promise<void> => {
        if (destroyed || runtimeError) {
            return Promise.reject(runtimeError ?? new Error('GrinderNode destroyed before offline setup completed'));
        }
        if (setupPromise) {
            return setupPromise;
        }
        if (!fallbackControlTarget) {
            return Promise.reject(new Error('GrinderNode offline setup requires a control target'));
        }
        // MessagePort delivery can wait until the first offline suspend. Reuse
        // the bounded ready/error handshake to observe consumption before the
        // strategy returns and its caller can start the render.
        const pending = createReadyHandshake({ pluginName: 'GrinderNode offline setup' });
        setupHandshake = pending;
        setupSequence = sequence.next - 1;
        setupPromise = pending.promise
            .then(() => undefined)
            .finally(() => {
                setupHandshake = null;
            });
        try {
            node.port.postMessage({
                schemaVersion: 1,
                command: 'complete-offline-grinder-setup',
                target: {
                    trackId: fallbackControlTarget.trackId,
                    deviceId: fallbackControlTarget.deviceId,
                    deviceType: fallbackControlTarget.deviceType,
                },
                correlation: { workletGeneration, controlSequence: setupSequence },
            });
        } catch (error) {
            pending.reject(error instanceof Error ? error : new Error(String(error)));
        }
        return setupPromise;
    };

    if (fallbackControlTarget) {
        node.port.postMessage(
            Object.freeze({
                schemaVersion: 1,
                command: 'initialize-fallback-control',
                target: Object.freeze({
                    trackId: fallbackControlTarget.trackId,
                    deviceId: fallbackControlTarget.deviceId,
                    deviceType: fallbackControlTarget.deviceType,
                    parameterIds: fallbackControlTarget.capturedParameterIds,
                    allowUncapturedImmediate: !offline,
                }),
                correlation: Object.freeze({ workletGeneration }),
            })
        );
    }
    node.port.postMessage({ type: 'init' });

    const result: GrinderNodeResult = {
        workletNode: node,
        setParam(name: string, value: number, sampleFrame?: number) {
            if (!destroyed && ctx.state !== 'closed' && Number.isFinite(value) && isGrinderRuntimeParameter(name)) {
                const param = node.parameters.get(name);
                if (param) {
                    writeContinuousParam(name, param, value, sampleFrame);
                } else {
                    // Message-port params: coalesce per frame to avoid flooding the
                    // worklet port on rapid automation/knob drags.
                    queueParamPost(name, value, sampleFrame);
                }
            }
        },
        setPatch(patch: Record<string, unknown>) {
            postNeuralPatch(patch);
        },
        setBypass(state: boolean) {
            postFallbackControl(
                'bypass',
                Object.freeze({ value: state ? 1 : 0, targetFrame: null, deadlineFrame: null })
            );
        },
        reset() {
            if (destroyed) {
                return;
            }
            node.port.postMessage({ type: 'reset' });
        },
        onMeterData(callback) {
            if (!destroyed) {
                meter.start(callback);
            }
        },
        onLatencyChanged: meter.onLatencyChanged,
        connect(dest: AudioNode) {
            node.connect(dest);
        },
        disconnect() {
            try {
                node.disconnect();
            } catch {
                // ignore
            }
        },
        destroy() {
            if (destroyed) {
                return;
            }
            destroyed = true;
            setupHandshake?.reject(new Error('GrinderNode destroyed during offline setup'));
            presetControl?.rejectPendingPresets(new Error('GrinderNode destroyed during preset installation'));
            presetControl?.stopWatchingContext();
            meter.stop();
            // Cancel a scheduled param flush and drop any buffered posts so the
            // destroyed node does not post into a closed port on the next frame.
            if (paramFlushRafId !== null) {
                cancelAnimationFrame(paramFlushRafId);
                paramFlushRafId = null;
            }
            pendingParamPosts.clear();
            if (slot) {
                telemetryAllocator.releaseSlot(slot.byteOffset);
                slot = null;
            }
            try {
                node.disconnect();
            } catch {
                // ignore
            }
            node.port.close();
        },
        ready: readyPromise,
    };
    if (offline) {
        result.completeOfflineSetup = completeOfflineSetup;
    }
    attachPresetControl(result, presetControl);
    return result;
}
