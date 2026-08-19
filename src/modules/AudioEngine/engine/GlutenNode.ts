/**
 * GlutenNode — AudioWorkletNode wrapper for the Gluten bus compressor.
 *
 * Same pattern as FermenterNode/ToasterNode: caches the compiled WASM module, resumes
 * AudioContext, provides setParam/setBypass via MessagePort.
 *
 * Key difference: Gluten is an *effect* (1 input, 1 output), not an instrument.
 */

import { raceAbortSignal } from '#/infra/audioWorklet/raceAbortSignal';
import { createReadyHandshake, ensureWorkletRegistered, fetchWasmModule } from '#/infra/audioWorklet/workletInitShared';
import { logger } from '#/infra/logger/appLogger';

import { createGlutenRuntimeParameterIds } from '../models/GlutenRuntimeControl';
import { type RuntimeDeviceControlTarget } from '../models/RuntimeDeviceControl';
import { compileRuntimeDeviceControl } from '../services/compileRuntimeDeviceControl';
import glutenProcessorUrl from '../services/glutenProcessor.ts?worker&url';

import { requireSharedArrayBuffer } from './pluginHostingErrors';
import { telemetryAllocator, createTelemetryReader, GLUTEN_IDX, type TelemetrySlot } from './telemetryAllocator';

// Canonical combined DSP build — the legacy /wasm/gluten/ snapshot goes stale
// on every daw-dsp rebuild and its wasm-bindgen symbols stop matching the
// generated glue (initSync then throws "function import requires a callable").
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

export type GlutenMeterData = {
    grDb: number;
    inputDb: number;
    outputDb: number;
    crest: number;
    phaseCorr: number;
    latency: number;
};

/** Slot floats → meter snapshot. Pure: the seqlock reader may re-run it on retry. */
function projectGlutenMeter(view: Float32Array): GlutenMeterData {
    return {
        grDb: view[GLUTEN_IDX.grDb] ?? 0,
        inputDb: view[GLUTEN_IDX.inputDb] ?? 0,
        outputDb: view[GLUTEN_IDX.outputDb] ?? 0,
        crest: view[GLUTEN_IDX.crest] ?? 0,
        phaseCorr: view[GLUTEN_IDX.phaseCorr] ?? 0,
        latency: view[GLUTEN_IDX.latency] ?? 0,
    };
}

export type GlutenNodeResult = {
    workletNode: AudioWorkletNode;
    setParam: (name: string, value: number, sampleFrame?: number) => void;
    setBypass: (bypassed: boolean) => void;
    onMeterData: (cb: (data: GlutenMeterData) => void) => void;
    onLatencyChanged: (cb: (latency: number) => void) => void;
    connect: (dest: AudioNode) => void;
    disconnect: () => void;
    destroy: () => void;
    ready: Promise<Record<string, unknown>>;
};

export function isGlutenDevice(deviceType: string): boolean {
    return deviceType === 'gluten';
}

export async function createGlutenNode(
    ctx: BaseAudioContext,
    wasmUrl?: string,
    signal?: AbortSignal,
    controlTarget?: RuntimeDeviceControlTarget,
    onRuntimeFailure?: (message: string) => void
): Promise<GlutenNodeResult> {
    // Gluten's meter readout lives in a SAB telemetry slot; without SAB the
    // worklet still runs but the UI silently freezes at the default values.
    // Fail fast with a typed error so `buildDeviceChain` surfaces the reason.
    requireSharedArrayBuffer('Gluten');

    if (ctx instanceof AudioContext && ctx.state === 'suspended') {
        await raceAbortSignal(ctx.resume(), signal);
    }

    await raceAbortSignal(ensureWorkletRegistered(ctx, glutenProcessorUrl), signal);
    const wasmLease = await raceAbortSignal(
        fetchWasmModule({ ctx, bundleId: 'daw-dsp', url: wasmUrl ?? DEFAULT_WASM_URL, signal }),
        signal
    );

    signal?.throwIfAborted();

    let node: AudioWorkletNode;
    try {
        node = new AudioWorkletNode(ctx, 'gluten-processor', {
            numberOfInputs: 2, // Input 0: main audio, Input 1: external sidechain
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
        trackId: 'offline-gluten-track',
        deviceId: 'offline-gluten-device',
        deviceType: 'gluten',
        parameterIds: [],
    };
    const fallbackControlTarget = Object.freeze({
        trackId: target.trackId,
        deviceId: target.deviceId,
        deviceType: target.deviceType,
        parameterIds: createGlutenRuntimeParameterIds(),
    });
    let nextControlSequence = 1;
    let destroyed = false;
    const postFallbackControl = (name: string, value: number, sampleFrame?: number): void => {
        // Gluten has no device-level scheduled-control contract. Reject a frame
        // instead of silently turning a scheduled write into an immediate one.
        if (
            destroyed ||
            sampleFrame !== undefined ||
            !Number.isFinite(value) ||
            nextControlSequence > Number.MAX_SAFE_INTEGER
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

    const handshake = createReadyHandshake({ pluginName: 'GlutenNode' });
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
            logger.warn('GlutenNode runtime fault (processor faulted):', message);
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
        onMeterData(cb: (data: GlutenMeterData) => void) {
            if (meterRafId !== null) {
                cancelAnimationFrame(meterRafId);
                meterRafId = null;
            }
            if (!slot) {
                return;
            }
            // Read under the slot seqlock (audit RT-2): the worklet publishes the
            // six fields with non-atomic stores, so a raw read here could pair a
            // GR value with a crest from a different meter block. Built once,
            // outside the poll, since it retains the last consistent snapshot.
            const readMeter = createTelemetryReader({ slot, project: projectGlutenMeter });
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
