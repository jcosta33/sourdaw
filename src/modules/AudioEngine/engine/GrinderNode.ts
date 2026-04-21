/**
 * GrinderNode — AudioWorkletNode wrapper for the Grinder amp simulator.
 */

import { logger } from '#/infra/logger/appLogger';

import grinderProcessorUrl from '../services/grinderProcessor.ts?worker&url';

import { requireSharedArrayBuffer } from './pluginHostingErrors';
import { telemetryAllocator, GRINDER_IDX, type TelemetrySlot } from './telemetryAllocator';
import { createReadyHandshake, ensureWorkletRegistered } from './workletInitShared';

const DEFAULT_WASM_URL = '/wasm/daw-dsp/daw_dsp_bg.wasm';

/**
 * Grinder intentionally bypasses the shared WASM binary cache: we always
 * fetch fresh bytes (`cache: 'no-store'`) so rebuilt local WASM is picked up
 * after a plugin reload or app restart instead of getting stuck on stale
 * cached worklet data.
 */
async function fetchGrinderWasm(url: string): Promise<ArrayBuffer> {
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
    // Grinder's neural-amp telemetry uses a SAB slot. Fail fast if the
    // environment cannot provide one — see `buildDeviceChain` for the UX path.
    requireSharedArrayBuffer('Grinder');

    if (ctx instanceof AudioContext && ctx.state === 'suspended') {
        await ctx.resume();
    }

    await ensureWorkletRegistered(ctx, grinderProcessorUrl);

    const node = new AudioWorkletNode(ctx, 'grinder-processor', {
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

    const handshake = createReadyHandshake({ pluginName: 'GrinderNode' });
    node.port.onmessage = (event: MessageEvent) => {
        const outcome = handshake.onMessage(event);
        if (outcome === 'late' && event.data?.type === 'error') {
            logger.warn('GrinderNode runtime fault (WASM panic — processor faulted):', event.data.message);
        }
    };
    const readyPromise = handshake.promise;

    const wasmBytes = await fetchGrinderWasm(wasmUrl ?? DEFAULT_WASM_URL);
    const copy = wasmBytes.slice(0);
    node.port.postMessage({ type: 'init', wasmBytes: copy }, [copy]);

    return {
        workletNode: node,
        setParam(name: string, value: number) {
            if (Number.isFinite(value)) {
                const param = node.parameters.get(name);
                if (param) {
                    param.setTargetAtTime(value, ctx.currentTime, 0.01);
                } else {
                    node.port.postMessage({ type: 'param', name, value });
                }
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
            if (!slot) {
                return;
            }
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
