/**
 * BacteriaNode — AudioWorkletNode wrapper for the Bacteria creative multi-effects.
 *
 * Same pattern as GlutenNode: caches the compiled WASM module, resumes AudioContext,
 * provides setParam/setBypass via MessagePort.
 */

import { raceAbortSignal } from '#/infra/audioWorklet/raceAbortSignal';
import { createReadyHandshake, ensureWorkletRegistered, fetchWasmModule } from '#/infra/audioWorklet/workletInitShared';

import bacteriaProcessorUrl from '../services/bacteriaProcessor.ts?worker&url';

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
    setParam: (name: string, value: number) => void;
    setBypass: (bypassed: boolean) => void;
    onMeterData: (cb: (data: BacteriaMeterData) => void) => void;
    onLatencyChanged: (cb: (latency: number) => void) => void;
    connect: (dest: AudioNode) => void;
    disconnect: () => void;
    destroy: () => void;
    ready: Promise<Record<string, unknown>>;
};

export function isBacteriaDevice(deviceType: string): boolean {
    return deviceType === 'bacteria';
}

export async function createBacteriaNode(
    ctx: BaseAudioContext,
    wasmUrl?: string,
    signal?: AbortSignal
): Promise<BacteriaNodeResult> {
    // Bacteria's per-band meter telemetry lives in a SAB slot. Guard here so
    // the worklet setup doesn't run pointlessly in an un-isolated environment.
    requireSharedArrayBuffer('Bacteria');

    if (ctx instanceof AudioContext && ctx.state === 'suspended') {
        await raceAbortSignal(ctx.resume(), signal);
    }

    await raceAbortSignal(ensureWorkletRegistered(ctx, bacteriaProcessorUrl), signal);
    const wasmModule = await raceAbortSignal(
        fetchWasmModule({ ctx, bundleId: 'daw-dsp', url: wasmUrl ?? DEFAULT_WASM_URL }),
        signal
    );

    signal?.throwIfAborted();

    const node = new AudioWorkletNode(ctx, 'bacteria-processor', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        channelCount: 2,
        channelCountMode: 'explicit',
        processorOptions: { wasmModule },
    });

    let slot: TelemetrySlot | null = telemetryAllocator.allocateSlot();
    let meterRafId: number | null = null;
    let latencyCallback: ((latency: number) => void) | null = null;

    if (slot) {
        node.port.postMessage({ type: 'init-sab', sab: slot.sab, byteOffset: slot.byteOffset });
    }

    const handshake = createReadyHandshake({ pluginName: 'BacteriaNode' });
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
