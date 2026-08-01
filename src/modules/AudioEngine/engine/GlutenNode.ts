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

import glutenProcessorUrl from '../services/glutenProcessor.ts?worker&url';

import { requireSharedArrayBuffer } from './pluginHostingErrors';
import { telemetryAllocator, createTelemetryReader, GLUTEN_IDX, type TelemetrySlot } from './telemetryAllocator';

// Canonical combined DSP build — the legacy /wasm/gluten/ snapshot goes stale
// on every daw-dsp rebuild and its wasm-bindgen symbols stop matching the
// generated glue (initSync then throws "function import requires a callable").
const DEFAULT_WASM_URL = '/wasm/daw-dsp/daw_dsp_bg.wasm';

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
    setParam: (name: string, value: number) => void;
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
    signal?: AbortSignal
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

    if (slot) {
        node.port.postMessage({ type: 'init-sab', sab: slot.sab, byteOffset: slot.byteOffset });
    }

    const handshake = createReadyHandshake({ pluginName: 'GlutenNode' });
    node.port.onmessage = (event: MessageEvent) => {
        const outcome = handshake.onMessage(event);
        if (outcome === 'other') {
            const data = event.data as Record<string, unknown>;
            if (data && data.type === 'latency-changed' && typeof data.latency === 'number') {
                latencyCallback?.(data.latency);
            }
            return;
        }
    };
    const readyPromise = handshake.promise;

    node.port.postMessage({ type: 'init' });

    return {
        workletNode: node,
        setParam(name: string, value: number) {
            if (Number.isFinite(value)) {
                node.port.postMessage({ type: 'param', name, value });
            }
        },
        setBypass(state: boolean) {
            node.port.postMessage({ type: 'param', name: 'bypass', value: state ? 1 : 0 });
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
