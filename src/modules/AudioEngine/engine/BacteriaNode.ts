/**
 * BacteriaNode — AudioWorkletNode wrapper for the Bacteria creative multi-effects.
 *
 * Same pattern as GlutenNode: caches WASM binary, resumes AudioContext,
 * provides setParam/setBypass via MessagePort.
 */

import bacteriaProcessorUrl from '../services/bacteriaProcessor.ts?worker&url';
import { telemetryAllocator, BACTERIA_IDX, type TelemetrySlot } from './telemetryAllocator';
import { createReadyHandshake, ensureWorkletRegistered, fetchWasmBinary } from './workletInitShared';

const DEFAULT_WASM_URL = '/wasm/daw-dsp/daw_dsp_bg.wasm';

export type BacteriaMeterData = {
    inputDb: number;
    outputDb: number;
    bandLevels: number[];
    latency: number;
};

export type BacteriaNodeResult = {
    workletNode: AudioWorkletNode;
    setParam: (name: string, value: number) => void;
    setBypass: (bypassed: boolean) => void;
    onMeterData: (cb: (data: BacteriaMeterData) => void) => void;
    connect: (dest: AudioNode) => void;
    disconnect: () => void;
    destroy: () => void;
    ready: Promise<void>;
};

export function isBacteriaDevice(deviceType: string): boolean {
    return deviceType === 'bacteria';
}

export async function createBacteriaNode(ctx: BaseAudioContext, wasmUrl?: string): Promise<BacteriaNodeResult> {
    if (ctx instanceof AudioContext && ctx.state === 'suspended') {
        await ctx.resume();
    }

    await ensureWorkletRegistered(ctx, bacteriaProcessorUrl);

    const node = new AudioWorkletNode(ctx, 'bacteria-processor', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        channelCount: 2,
        channelCountMode: 'explicit',
    });

    let slot: TelemetrySlot | null = telemetryAllocator.allocateSlot();
    let meterRafId: number | null = null;

    if (slot) {
        node.port.postMessage({ type: 'init-sab', sab: slot.sab, byteOffset: slot.byteOffset });
    }

    const handshake = createReadyHandshake({ pluginName: 'BacteriaNode' });
    node.port.onmessage = (e: MessageEvent) => {
        handshake.onMessage(e);
    };
    const readyPromise = handshake.promise;

    const wasmBytes = await fetchWasmBinary(wasmUrl ?? DEFAULT_WASM_URL);
    const copy = wasmBytes.slice(0);
    node.port.postMessage({ type: 'init', wasmBytes: copy }, [copy]);

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
            if (!slot) {return;}
            const view = slot.view;
            const poll = () => {
                cb({
                    inputDb: view[BACTERIA_IDX.inputDb] ?? 0,
                    outputDb: view[BACTERIA_IDX.outputDb] ?? 0,
                    bandLevels: [],
                    latency: view[BACTERIA_IDX.latency] ?? 0,
                });
                meterRafId = requestAnimationFrame(poll);
            };
            meterRafId = requestAnimationFrame(poll);
        },
        connect(dest: AudioNode) {
            node.connect(dest);
        },
        disconnect() {
            try {
                node.disconnect();
            } catch {}
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
            } catch {}
            node.port.close();
        },
        ready: readyPromise,
    };
}
