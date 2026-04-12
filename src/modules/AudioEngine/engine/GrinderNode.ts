/**
 * GrinderNode — AudioWorkletNode wrapper for the Grinder amp simulator.
 */

import grinderProcessorUrl from '../services/grinderProcessor.ts?worker&url';
import { telemetryAllocator, GRINDER_IDX, type TelemetrySlot } from './telemetryAllocator';
import { logger } from '#/infra/logger/appLogger';

const DEFAULT_WASM_URL = '/wasm/daw-dsp/daw_dsp_bg.wasm';

const workletRegistrations = new WeakMap<BaseAudioContext, Promise<void>>();

async function ensureWorkletRegistered(ctx: BaseAudioContext): Promise<void> {
    let promise = workletRegistrations.get(ctx);
    if (!promise) {
        promise = ctx.audioWorklet.addModule(grinderProcessorUrl);
        workletRegistrations.set(ctx, promise);
    }
    return promise;
}

async function fetchWasmBinary(url: string): Promise<ArrayBuffer> {
    // Always fetch fresh bytes so rebuilt local WASM is picked up after a
    // plugin reload or app restart instead of getting stuck on stale cached
    // worklet data.
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) {
        throw new Error(`Failed to fetch Grinder WASM: ${response.status}`);
    }
    return await response.arrayBuffer();
}

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

export type GrinderNodeResult = {
    workletNode: AudioWorkletNode;
    setParam: (name: string, value: number) => void;
    setBypass: (bypassed: boolean) => void;
    onMeterData: (cb: (data: GrinderMeterData) => void) => void;
    connect: (dest: AudioNode) => void;
    disconnect: () => void;
    destroy: () => void;
    ready: Promise<void>;
};

export function isGrinderDevice(deviceType: string): boolean {
    return deviceType === 'grinder';
}

export async function createGrinderNode(ctx: BaseAudioContext, wasmUrl?: string): Promise<GrinderNodeResult> {
    if (ctx instanceof AudioContext && ctx.state === 'suspended') {
        await ctx.resume();
    }

    await ensureWorkletRegistered(ctx);

    const node = new AudioWorkletNode(ctx, 'grinder-processor', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        channelCount: 2,
        channelCountMode: 'explicit',
    });

    let settled = false;
    let slot: TelemetrySlot | null = telemetryAllocator.allocateSlot();
    let meterRafId: number | null = null;

    if (slot) {
        node.port.postMessage({ type: 'init-sab', sab: slot.sab, byteOffset: slot.byteOffset });
    }

    const readyPromise = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
            if (!settled) {
                settled = true;
                reject(new Error('GrinderNode init timeout (10s)'));
            }
        }, 10_000);
        node.port.onmessage = (e: MessageEvent) => {
            if (e.data.type === 'ready') {
                if (!settled) {
                    settled = true;
                    clearTimeout(timeout);
                    resolve();
                }
            } else if (e.data.type === 'error') {
                if (!settled) {
                    settled = true;
                    clearTimeout(timeout);
                    reject(new Error(e.data.message));
                } else {
                    logger.warn('GrinderNode runtime fault (WASM panic — processor faulted):', e.data.message);
                }
            }
        };
    });

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
        onMeterData(cb: (data: GrinderMeterData) => void) {
            if (meterRafId !== null) {
                cancelAnimationFrame(meterRafId);
                meterRafId = null;
            }
            if (!slot) return;
            const view = slot.view;
            const poll = () => {
                cb({
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
