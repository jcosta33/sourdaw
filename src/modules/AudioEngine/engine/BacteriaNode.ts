/**
 * BacteriaNode — AudioWorkletNode wrapper for the Bacteria creative multi-effects.
 *
 * Same pattern as GlutenNode: caches the compiled WASM module, resumes AudioContext,
 * provides setParam/setBypass via MessagePort.
 */

import { raceAbortSignal } from '#/infra/audioWorklet/raceAbortSignal';
import { createReadyHandshake, ensureWorkletRegistered, fetchWasmModule } from '#/infra/audioWorklet/workletInitShared';
import { logger } from '#/infra/logger/appLogger';

import { createBacteriaRuntimeParameterIds } from '../models/BacteriaRuntimeControl';
import { type RuntimeDeviceControlTarget } from '../models/RuntimeDeviceControl';
import bacteriaProcessorUrl from '../services/bacteriaProcessor.ts?worker&url';
import { compileRuntimeDeviceControl } from '../services/compileRuntimeDeviceControl';

import { requireSharedArrayBuffer } from './pluginHostingErrors';
import {
    telemetryAllocator,
    createTelemetryReader,
    BACTERIA_IDX,
    BACTERIA_BAND_COUNT,
    type TelemetrySlot,
} from './telemetryAllocator';

/** Linear amplitude → dB with a -100 dB floor (matches input/output dB range). */
function linearToDb(linear: number): number {
    if (linear <= 1e-5) {
        return -100;
    }
    return 20 * Math.log10(linear);
}

const DEFAULT_WASM_URL = '/wasm/daw-dsp/daw_dsp_bg.wasm';

export type BacteriaMeterData = {
    inputDb: number;
    outputDb: number;
    bandLevels: number[];
    latency: number;
};

/** Slot floats → meter snapshot. Pure: the seqlock reader may re-run it on retry. */
function projectBacteriaMeter(view: Float32Array): BacteriaMeterData {
    const bandLevels = Array.from({ length: BACTERIA_BAND_COUNT }, (): number => 0);
    for (let index = 0; index < BACTERIA_BAND_COUNT; index++) {
        const linear = view[BACTERIA_IDX.bandLevelsBase + index] ?? 0;
        bandLevels[index] = linearToDb(linear);
    }
    return {
        inputDb: view[BACTERIA_IDX.inputDb] ?? 0,
        outputDb: view[BACTERIA_IDX.outputDb] ?? 0,
        bandLevels,
        latency: view[BACTERIA_IDX.latency] ?? 0,
    };
}

export type BacteriaNodeResult = {
    workletNode: AudioWorkletNode;
    setParam: (name: string, value: number, sampleFrame?: number) => void;
    setBypass: (bypassed: boolean) => void;
    onMeterData: (cb: (data: BacteriaMeterData) => void) => void;
    onLatencyChanged: (cb: (latency: number) => void) => void;
    connect: (dest: AudioNode) => void;
    disconnect: () => void;
    destroy: () => void;
    ready: Promise<Record<string, unknown>>;
};

const CONTROL_DEADLINE_FRAMES = 128;
let nextWorkletControlGeneration = 1;

function allocateWorkletControlGeneration(): number {
    const generation = nextWorkletControlGeneration;
    nextWorkletControlGeneration = generation >= Number.MAX_SAFE_INTEGER ? 1 : generation + 1;
    return generation;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function toControlScheduling(sampleFrame: number | undefined): {
    targetFrame: number | null;
    deadlineFrame: number | null;
} {
    if (!Number.isSafeInteger(sampleFrame) || sampleFrame === undefined || sampleFrame < 0) {
        return { targetFrame: null, deadlineFrame: null };
    }
    const deadlineFrame = sampleFrame + CONTROL_DEADLINE_FRAMES;
    return Number.isSafeInteger(deadlineFrame)
        ? { targetFrame: sampleFrame, deadlineFrame }
        : { targetFrame: null, deadlineFrame: null };
}

export function isBacteriaDevice(deviceType: string): boolean {
    return deviceType === 'bacteria';
}

export async function createBacteriaNode(
    ctx: BaseAudioContext,
    wasmUrl?: string,
    signal?: AbortSignal,
    controlTarget?: RuntimeDeviceControlTarget,
    onRuntimeFailure?: (message: string) => void
): Promise<BacteriaNodeResult> {
    // Bacteria's per-band meter telemetry lives in a SAB slot. Guard here so
    // the worklet setup doesn't run pointlessly in an un-isolated environment.
    requireSharedArrayBuffer('Bacteria');

    if (ctx instanceof AudioContext && ctx.state === 'suspended') {
        await raceAbortSignal(ctx.resume(), signal);
    }

    await raceAbortSignal(ensureWorkletRegistered(ctx, bacteriaProcessorUrl), signal);
    const wasmLease = await raceAbortSignal(
        fetchWasmModule({ ctx, bundleId: 'daw-dsp', url: wasmUrl ?? DEFAULT_WASM_URL, signal }),
        signal
    );

    signal?.throwIfAborted();

    let node: AudioWorkletNode;
    try {
        node = new AudioWorkletNode(ctx, 'bacteria-processor', {
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
        if (latency !== lastReportedLatency) {
            lastReportedLatency = latency;
            latencyCallback?.(latency);
        }
    };
    const workletGeneration = allocateWorkletControlGeneration();
    // Offline rendering retains the pre-existing direct Bacteria API, but it
    // still traverses the same validated worklet envelope with a local identity.
    const target = controlTarget ?? {
        trackId: 'offline-bacteria-track',
        deviceId: 'offline-bacteria-device',
        deviceType: 'bacteria',
        parameterIds: [],
    };
    const fallbackControlTarget = Object.freeze({
        trackId: target.trackId,
        deviceId: target.deviceId,
        deviceType: target.deviceType,
        parameterIds: createBacteriaRuntimeParameterIds(),
    });
    let nextControlSequence = 1;
    let destroyed = false;
    const postFallbackControl = (name: string, value: number, sampleFrame?: number): void => {
        if (destroyed || nextControlSequence > Number.MAX_SAFE_INTEGER) {
            return;
        }
        const scheduling = toControlScheduling(sampleFrame);
        if (scheduling.targetFrame !== null && !slot) {
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
                value,
                correlation: { workletGeneration, controlSequence: nextControlSequence },
                scheduling,
            },
            fallbackControlTarget.parameterIds
        );
        if (result.status === 'compiled') {
            nextControlSequence++;
            node.port.postMessage(result.control);
        }
    };

    if (slot) {
        node.port.postMessage({ type: 'init-sab', sab: slot.sab, byteOffset: slot.byteOffset });
    }

    const handshake = createReadyHandshake({ pluginName: 'BacteriaNode' });
    node.port.onmessage = (event: MessageEvent) => {
        const outcome = handshake.onMessage(event);
        if (outcome === 'other') {
            const data: unknown = event.data;
            if (isRecord(data) && data.type === 'latency-changed' && typeof data.latency === 'number') {
                reportLatencyChange(data.latency);
            }
            return;
        }
        if (outcome === 'late' && isRecord(event.data) && event.data.type === 'error') {
            const message = 'message' in event.data ? String(event.data.message) : 'Unknown error';
            logger.warn('BacteriaNode runtime fault (WASM panic — processor faulted):', message);
            onRuntimeFailure?.(message);
        }
    };
    const readyPromise = handshake.promise;

    if (fallbackControlTarget) {
        node.port.postMessage(
            Object.freeze({
                schemaVersion: 1,
                command: 'initialize-fallback-control',
                target: fallbackControlTarget,
                correlation: Object.freeze({ workletGeneration }),
            })
        );
    }
    node.port.postMessage({ type: 'init' });

    return {
        workletNode: node,
        setParam(name: string, value: number, sampleFrame?: number) {
            if (Number.isFinite(value)) {
                postFallbackControl(name, value, sampleFrame);
            }
        },
        setBypass(state: boolean) {
            postFallbackControl('bypass', state ? 1 : 0);
        },
        onMeterData(cb: (data: BacteriaMeterData) => void) {
            if (meterRafId !== null) {
                cancelAnimationFrame(meterRafId);
                meterRafId = null;
            }
            if (!slot) {
                return;
            }
            // Read under the slot seqlock (audit RT-2). This is the tear the audit
            // called out by name: the worklet blits all six band levels in one
            // `.set()`, but a raw poll could still straddle the blit and show bands
            // from two different blocks side by side. Built once, outside the poll,
            // since it retains the last consistent snapshot.
            const readMeter = createTelemetryReader({ slot, project: projectBacteriaMeter });
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
            if (destroyed) {
                return;
            }
            destroyed = true;
            if (meterRafId !== null) {
                cancelAnimationFrame(meterRafId);
                meterRafId = null;
            }
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
