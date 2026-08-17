/**
 * GrinderNode — AudioWorkletNode wrapper for the Grinder amp simulator.
 */

import { raceAbortSignal } from '#/infra/audioWorklet/raceAbortSignal';
import { createReadyHandshake, ensureWorkletRegistered, fetchWasmModule } from '#/infra/audioWorklet/workletInitShared';
import { logger } from '#/infra/logger/appLogger';

import { type RuntimeDeviceControlTarget } from '../models/RuntimeDeviceControl';
import { compileRuntimeDeviceControl } from '../services/compileRuntimeDeviceControl';
import grinderProcessorUrl from '../services/grinderProcessor.ts?worker&url';

import { requireSharedArrayBuffer } from './pluginHostingErrors';
import { telemetryAllocator, createTelemetryReader, GRINDER_IDX, type TelemetrySlot } from './telemetryAllocator';

const DEFAULT_WASM_URL = '/wasm/daw-dsp/daw_dsp_bg.wasm';

export type GrinderMeterData = {
    inputDb: number;
    preampDb: number;
    powerAmpDb: number;
    outputDb: number;
    gateOpen: number;
    gateEnvelopeDb: number;
    sagVoltage: number;
    latency: number;
    neuralCpuPercent: number;
    neuralWarmupProgress: number;
};

/** Slot floats → meter snapshot. Pure: the seqlock reader may re-run it on retry. */
function projectGrinderMeter(view: Float32Array): GrinderMeterData {
    return {
        inputDb: view[GRINDER_IDX.inputDb] ?? 0,
        preampDb: view[GRINDER_IDX.preampDb] ?? 0,
        powerAmpDb: view[GRINDER_IDX.powerAmpDb] ?? 0,
        outputDb: view[GRINDER_IDX.outputDb] ?? 0,
        gateOpen: view[GRINDER_IDX.gateOpen] ?? 0,
        gateEnvelopeDb: view[GRINDER_IDX.gateEnvelopeDb] ?? 0,
        sagVoltage: view[GRINDER_IDX.sagVoltage] ?? 0,
        latency: view[GRINDER_IDX.latency] ?? 0,
        neuralCpuPercent: view[GRINDER_IDX.neuralCpuPercent] ?? 0,
        neuralWarmupProgress: view[GRINDER_IDX.neuralWarmupProgress] ?? 0,
    };
}

export type GrinderNodeResult = {
    workletNode: AudioWorkletNode;
    setParam: (name: string, value: number, sampleFrame?: number) => void;
    setPatch: (patch: Record<string, unknown>) => void;
    setBypass: (bypassed: boolean) => void;
    onMeterData: (cb: (data: GrinderMeterData) => void) => void;
    onLatencyChanged: (cb: (latency: number) => void) => void;
    connect: (dest: AudioNode) => void;
    disconnect: () => void;
    destroy: () => void;
    ready: Promise<Record<string, unknown>>;
};

const CONTROL_DEADLINE_FRAMES = 128;
let nextWorkletControlGeneration = 1;

type PendingParamPost = Readonly<{
    value: number;
    targetFrame: number | null;
    deadlineFrame: number | null;
}>;

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

export function isGrinderDevice(deviceType: string): boolean {
    return deviceType === 'grinder';
}

export async function createGrinderNode(
    ctx: BaseAudioContext,
    wasmUrl?: string,
    signal?: AbortSignal,
    controlTarget?: RuntimeDeviceControlTarget
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

    let node: AudioWorkletNode;
    try {
        node = new AudioWorkletNode(ctx, 'grinder-processor', {
            numberOfInputs: 1,
            numberOfOutputs: 1,
            outputChannelCount: [2],
            channelCount: 2,
            channelCountMode: 'explicit',
            processorOptions: { wasmModule: wasmLease.module },
        });
        wasmLease.commit();
    } catch (error) {
        wasmLease.release();
        throw error;
    }

    let slot: TelemetrySlot | null = telemetryAllocator.allocateSlot();
    let meterRafId: number | null = null;
    let latencyCallback: ((latency: number) => void) | null = null;
    let lastReportedLatency: number | null = null;
    const reportLatencyChange = (latency: number): void => {
        if (latency === lastReportedLatency) {
            return;
        }
        lastReportedLatency = latency;
        latencyCallback?.(latency);
    };

    if (slot) {
        node.port.postMessage({ type: 'init-sab', sab: slot.sab, byteOffset: slot.byteOffset });
    }

    // Per-frame coalescing applies only to immediate message-port controls
    // (those without a backing AudioParam). Scheduled automation carries a
    // sample-frame contract and is posted in call order without coalescing.
    const pendingParamPosts = new Map<string, PendingParamPost>();
    let paramFlushRafId: number | null = null;
    const canCoalesce = typeof requestAnimationFrame === 'function';
    const workletGeneration = allocateWorkletControlGeneration();
    const fallbackControlTarget = controlTarget
        ? Object.freeze({
              trackId: controlTarget.trackId,
              deviceId: controlTarget.deviceId,
              deviceType: controlTarget.deviceType,
              parameterIds: Object.freeze([...new Set([...controlTarget.parameterIds, 'bypass'])]),
          })
        : undefined;
    let nextControlSequence = 1;

    const postFallbackControl = (name: string, pending: PendingParamPost): void => {
        if (!fallbackControlTarget || nextControlSequence > Number.MAX_SAFE_INTEGER) {
            return;
        }
        const result = compileRuntimeDeviceControl(
            {
                schemaVersion: 1,
                command: 'set-fallback-param',
                target: {
                    trackId: fallbackControlTarget.trackId,
                    deviceId: fallbackControlTarget.deviceId,
                    deviceType: fallbackControlTarget.deviceType,
                    parameterId: name,
                },
                value: pending.value,
                correlation: {
                    workletGeneration,
                    controlSequence: nextControlSequence,
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
        nextControlSequence++;
        node.port.postMessage(result.control);
    };

    const flushParamPosts = (): void => {
        paramFlushRafId = null;
        for (const [name, pending] of pendingParamPosts) {
            postFallbackControl(name, pending);
        }
        pendingParamPosts.clear();
    };

    const queueParamPost = (name: string, value: number, sampleFrame?: number): void => {
        const scheduling = toControlScheduling(sampleFrame);
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
        if (!canCoalesce) {
            // No rAF (offline render / non-DOM host): apply at the next safe
            // boundary instead of stranding the already validated control.
            postFallbackControl(name, pending);
            return;
        }
        pendingParamPosts.set(name, pending);
        paramFlushRafId ??= requestAnimationFrame(flushParamPosts);
    };

    const handshake = createReadyHandshake({ pluginName: 'GrinderNode' });
    node.port.onmessage = (event: MessageEvent<unknown>) => {
        const outcome = handshake.onMessage(event);
        if (outcome === 'other') {
            const data = event.data as Record<string, unknown>;
            if (data && data.type === 'latency-changed' && typeof data.latency === 'number') {
                reportLatencyChange(data.latency);
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
        }
    };
    const readyPromise = handshake.promise;

    if (fallbackControlTarget) {
        node.port.postMessage(
            Object.freeze({
                schemaVersion: 1,
                command: 'initialize-fallback-control',
                target: Object.freeze({
                    trackId: fallbackControlTarget.trackId,
                    deviceId: fallbackControlTarget.deviceId,
                    deviceType: fallbackControlTarget.deviceType,
                    parameterIds: fallbackControlTarget.parameterIds,
                }),
                correlation: Object.freeze({ workletGeneration }),
            })
        );
    }
    node.port.postMessage({ type: 'init' });

    return {
        workletNode: node,
        setParam(name: string, value: number, sampleFrame?: number) {
            if (Number.isFinite(value)) {
                const param = node.parameters.get(name);
                if (param) {
                    // Immediate UI writes smooth from now; scheduled writes use
                    // TrackNode's sample-frame time, bounded at the live context.
                    param.setTargetAtTime(value, toAudioParamTime(ctx, sampleFrame), 0.01);
                } else {
                    // Message-port params: coalesce per frame to avoid flooding the
                    // worklet port on rapid automation/knob drags.
                    queueParamPost(name, value, sampleFrame);
                }
            }
        },
        setPatch(patch: Record<string, unknown>) {
            node.port.postMessage({ type: 'patch', patch });
        },
        setBypass(state: boolean) {
            postFallbackControl(
                'bypass',
                Object.freeze({ value: state ? 1 : 0, targetFrame: null, deadlineFrame: null })
            );
        },
        onMeterData(cb: (data: GrinderMeterData) => void) {
            if (meterRafId !== null) {
                cancelAnimationFrame(meterRafId);
                meterRafId = null;
            }
            if (!slot) {
                return;
            }
            // Read under the slot seqlock (audit RT-2): without it a poll could pair
            // a gate state with a latency reported from a different quantum. Built
            // once, outside the poll, since it retains the last consistent snapshot.
            const readMeter = createTelemetryReader({ slot, project: projectGrinderMeter });
            const poll = () => {
                const data = readMeter();
                reportLatencyChange(data.latency);
                cb(data);
                meterRafId = requestAnimationFrame(poll);
            };
            meterRafId = requestAnimationFrame(poll);
        },
        onLatencyChanged(cb: (latency: number) => void) {
            latencyCallback = cb;
        },
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
            if (meterRafId !== null) {
                cancelAnimationFrame(meterRafId);
                meterRafId = null;
            }
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
}
