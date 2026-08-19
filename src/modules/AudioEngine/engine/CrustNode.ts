/**
 * CrustNode — AudioWorkletNode wrapper for the Crust true-peak limiter.
 *
 * Same pattern as GlutenNode: caches the compiled WASM module, resumes the
 * AudioContext, provides setParam/setBypass over the MessagePort, and reads
 * meters out of a SAB telemetry slot under the slot seqlock.
 *
 * Crust has look-ahead, so it has latency, and that latency is reported to the
 * host through `onLatencyChanged` for plugin delay compensation.
 */

import { raceAbortSignal } from '#/infra/audioWorklet/raceAbortSignal';
import { createReadyHandshake, ensureWorkletRegistered, fetchWasmModule } from '#/infra/audioWorklet/workletInitShared';
import { logger } from '#/infra/logger/appLogger';

import { createCrustRuntimeParameterIds } from '../models/CrustRuntimeControl';
import { type RuntimeDeviceControlTarget } from '../models/RuntimeDeviceControl';
import { compileRuntimeDeviceControl } from '../services/compileRuntimeDeviceControl';
import crustProcessorUrl from '../services/crustProcessor.ts?worker&url';

import { requireSharedArrayBuffer } from './pluginHostingErrors';
import { telemetryAllocator, createTelemetryReader, CRUST_IDX, type TelemetrySlot } from './telemetryAllocator';

const DEFAULT_WASM_URL = '/wasm/daw-dsp/daw_dsp_bg.wasm';

let nextWorkletControlGeneration = 1;

function allocateWorkletControlGeneration(): number {
    const generation = nextWorkletControlGeneration;
    nextWorkletControlGeneration = generation >= Number.MAX_SAFE_INTEGER ? 1 : generation + 1;
    return generation;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export type CrustMeterData = {
    grDb: number;
    inputDb: number;
    outputDb: number;
    lufsIntegrated: number;
    lufsShortTerm: number;
    lufsMomentary: number;
    lra: number;
    truepeakMax: number;
    truepeakExceeded: boolean;
    latency: number;
};

/** Slot floats → meter snapshot. Pure: the seqlock reader may re-run it on retry. */
function projectCrustMeter(view: Float32Array): CrustMeterData {
    return {
        grDb: view[CRUST_IDX.grDb] ?? 0,
        inputDb: view[CRUST_IDX.inputDb] ?? -100,
        outputDb: view[CRUST_IDX.outputDb] ?? -100,
        lufsIntegrated: view[CRUST_IDX.lufsIntegrated] ?? -100,
        lufsShortTerm: view[CRUST_IDX.lufsShortTerm] ?? -100,
        lufsMomentary: view[CRUST_IDX.lufsMomentary] ?? -100,
        lra: view[CRUST_IDX.lra] ?? 0,
        truepeakMax: view[CRUST_IDX.truePeakMax] ?? -100,
        truepeakExceeded: (view[CRUST_IDX.truePeakExceeded] ?? 0) > 0.5,
        latency: view[CRUST_IDX.latency] ?? 0,
    };
}

export type CrustNodeResult = {
    workletNode: AudioWorkletNode;
    setParam: (name: string, value: number, sampleFrame?: number) => void;
    setBypass: (bypassed: boolean) => void;
    onMeterData: (cb: (data: CrustMeterData) => void) => void;
    onLatencyChanged: (cb: (latency: number) => void) => void;
    connect: (dest: AudioNode) => void;
    disconnect: () => void;
    destroy: () => void;
    ready: Promise<Record<string, unknown>>;
};

export function isCrustDevice(deviceType: string): boolean {
    return deviceType === 'crust';
}

export async function createCrustNode(
    ctx: BaseAudioContext,
    wasmUrl?: string,
    signal?: AbortSignal,
    controlTarget?: RuntimeDeviceControlTarget,
    onRuntimeFailure?: (message: string) => void
): Promise<CrustNodeResult> {
    // Crust's whole readout — gain reduction, the LUFS set, the true-peak hold —
    // lives in a SAB telemetry slot. Without SAB the worklet still limits but
    // the panel silently freezes at its defaults, so fail with a typed error
    // that `buildDeviceChain` can surface.
    requireSharedArrayBuffer('Crust');

    if (ctx instanceof AudioContext && ctx.state === 'suspended') {
        await raceAbortSignal(ctx.resume(), signal);
    }

    await raceAbortSignal(ensureWorkletRegistered(ctx, crustProcessorUrl), signal);
    const wasmLease = await raceAbortSignal(
        fetchWasmModule({ ctx, bundleId: 'daw-dsp', url: wasmUrl ?? DEFAULT_WASM_URL, signal }),
        signal
    );

    signal?.throwIfAborted();

    let node: AudioWorkletNode;
    try {
        node = new AudioWorkletNode(ctx, 'crust-processor', {
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
    const workletGeneration = allocateWorkletControlGeneration();
    const target = controlTarget ?? {
        trackId: 'offline-crust-track',
        deviceId: 'offline-crust-device',
        deviceType: 'crust',
        parameterIds: [],
    };
    const fallbackControlTarget = Object.freeze({
        trackId: target.trackId,
        deviceId: target.deviceId,
        deviceType: target.deviceType,
        parameterIds: createCrustRuntimeParameterIds(),
    });
    let nextControlSequence = 1;
    let destroyed = false;
    const postFallbackControl = (name: string, value: number, sampleFrame?: number): void => {
        // Crust is explicitly exempt from device-level parameter automation:
        // a supplied frame is rejected, never degraded to an immediate write.
        // The protocol keeps timing fields so the processor can fail closed on
        // forged scheduled traffic too.
        if (
            destroyed ||
            sampleFrame !== undefined ||
            nextControlSequence > Number.MAX_SAFE_INTEGER ||
            !Number.isFinite(value)
        ) {
            return;
        }
        const compilation = compileRuntimeDeviceControl(
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
                scheduling: { targetFrame: null, deadlineFrame: null },
            },
            fallbackControlTarget.parameterIds
        );
        if (compilation.status === 'compiled') {
            nextControlSequence++;
            node.port.postMessage(compilation.control);
        }
    };

    if (slot) {
        node.port.postMessage({ type: 'init-sab', sab: slot.sab, byteOffset: slot.byteOffset });
    }

    const handshake = createReadyHandshake({ pluginName: 'CrustNode' });
    node.port.onmessage = (event: MessageEvent) => {
        const outcome = handshake.onMessage(event);
        if (outcome === 'other') {
            const data: unknown = event.data;
            if (isRecord(data) && data.type === 'latency-changed' && typeof data.latency === 'number') {
                latencyCallback?.(data.latency);
            }
            return;
        }
        if (outcome === 'late' && isRecord(event.data) && event.data.type === 'error') {
            const message = 'message' in event.data ? String(event.data.message) : 'Unknown error';
            logger.warn('CrustNode runtime fault (processor faulted):', message);
            onRuntimeFailure?.(message);
        }
    };
    const readyPromise = handshake.promise;

    node.port.postMessage(
        Object.freeze({
            schemaVersion: 1,
            command: 'initialize-fallback-control',
            target: fallbackControlTarget,
            correlation: Object.freeze({ workletGeneration }),
        })
    );
    node.port.postMessage({ type: 'init' });

    return {
        workletNode: node,
        setParam(name: string, value: number, sampleFrame?: number) {
            postFallbackControl(name, value, sampleFrame);
        },
        setBypass(state: boolean) {
            postFallbackControl('bypass', state ? 1 : 0);
        },
        onMeterData(cb: (data: CrustMeterData) => void) {
            if (meterRafId !== null) {
                cancelAnimationFrame(meterRafId);
                meterRafId = null;
            }
            if (!slot) {
                return;
            }
            // Read under the slot seqlock: the worklet publishes the ten fields
            // with non-atomic stores, so a raw read could pair a gain-reduction
            // value with a true-peak hold from a different meter block.
            const readMeter = createTelemetryReader({ slot, project: projectCrustMeter });
            const poll = () => {
                cb(readMeter());
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
