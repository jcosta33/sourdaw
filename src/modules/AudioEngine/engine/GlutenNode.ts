/**
 * GlutenNode — AudioWorkletNode wrapper for the Gluten bus compressor.
 *
 * Same pattern as FermenterNode/ToasterNode: caches WASM binary, resumes
 * AudioContext, provides setParam/setBypass via MessagePort.
 *
 * Key difference: Gluten is an *effect* (1 input, 1 output), not an instrument.
 */

import glutenProcessorUrl from '../services/glutenProcessor.ts?worker&url';

import { requireSharedArrayBuffer } from './pluginHostingErrors';
import { telemetryAllocator, GLUTEN_IDX, type TelemetrySlot } from './telemetryAllocator';
import { createReadyHandshake, ensureWorkletRegistered, fetchWasmBinary } from './workletInitShared';

const DEFAULT_WASM_URL = '/wasm/gluten/gluten_bg.wasm';

export type GlutenMeterData = {
    grDb: number;
    inputDb: number;
    outputDb: number;
    crest: number;
    phaseCorr: number;
    latency: number;
};

export type GlutenNodeResult = {
    workletNode: AudioWorkletNode;
    setParam: (name: string, value: number) => void;
    setBypass: (bypassed: boolean) => void;
    onMeterData: (cb: (data: GlutenMeterData) => void) => void;
    connect: (dest: AudioNode) => void;
    disconnect: () => void;
    destroy: () => void;
    ready: Promise<void>;
};

export function isGlutenDevice(deviceType: string): boolean {
    return deviceType === 'gluten';
}

export async function createGlutenNode(ctx: BaseAudioContext, wasmUrl?: string): Promise<GlutenNodeResult> {
    // Gluten's meter readout lives in a SAB telemetry slot; without SAB the
    // worklet still runs but the UI silently freezes at the default values.
    // Fail fast with a typed error so `buildDeviceChain` surfaces the reason.
    requireSharedArrayBuffer('Gluten');

    if (ctx instanceof AudioContext && ctx.state === 'suspended') {
        await ctx.resume();
    }

    await ensureWorkletRegistered(ctx, glutenProcessorUrl);

    const node = new AudioWorkletNode(ctx, 'gluten-processor', {
        numberOfInputs: 2, // Input 0: main audio, Input 1: external sidechain
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

    const handshake = createReadyHandshake({ pluginName: 'GlutenNode' });
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
        onMeterData(cb: (data: GlutenMeterData) => void) {
            if (meterRafId !== null) {
                cancelAnimationFrame(meterRafId);
                meterRafId = null;
            }
            if (!slot) {
                return;
            }
            const view = slot.view;
            const poll = () => {
                cb({
                    grDb: view[GLUTEN_IDX.grDb] ?? 0,
                    inputDb: view[GLUTEN_IDX.inputDb] ?? 0,
                    outputDb: view[GLUTEN_IDX.outputDb] ?? 0,
                    crest: view[GLUTEN_IDX.crest] ?? 0,
                    phaseCorr: view[GLUTEN_IDX.phaseCorr] ?? 0,
                    latency: view[GLUTEN_IDX.latency] ?? 0,
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
