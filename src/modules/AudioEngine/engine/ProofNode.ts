/**
 * ProofNode — AudioWorkletNode wrapper for the Proof mastering suite.
 *
 * Same pattern as GlutenNode: caches WASM binary, resumes AudioContext,
 * provides setParam/setBypass/reorder via MessagePort.
 *
 * Effect processor: 1 input, 1 output.
 */

import proofProcessorUrl from '../services/proofProcessor.ts?worker&url';
import { telemetryAllocator, PROOF_IDX } from './telemetryAllocator';

const DEFAULT_WASM_URL = '/wasm/daw-dsp/daw_dsp_bg.wasm';

const workletRegistrations = new WeakMap<BaseAudioContext, Promise<void>>();
let cachedWasmBytes: ArrayBuffer | null = null;

async function ensureWorkletRegistered(ctx: BaseAudioContext): Promise<void> {
    let promise = workletRegistrations.get(ctx);
    if (!promise) {
        promise = ctx.audioWorklet.addModule(proofProcessorUrl);
        workletRegistrations.set(ctx, promise);
    }
    return promise;
}

async function fetchWasmBinary(url: string): Promise<ArrayBuffer> {
    if (cachedWasmBytes) {
        return cachedWasmBytes;
    }
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to fetch Proof WASM: ${response.status}`);
    }
    cachedWasmBytes = await response.arrayBuffer();
    return cachedWasmBytes;
}

export type ProofMeterData = {
    inputLufs: number;
    outputLufs: number;
    outputStLufs: number;
    integratedLufs: number;
    truePeakDb: number;
    lra: number;
    correlation: number;
    limiterGrDb: number;
    dynGr: [number, number, number, number];
    tapPeaks: Array<{ peakL: number; peakR: number }>;
    latency: number;
};

export type ProofNodeResult = {
    workletNode: AudioWorkletNode;
    setParam: (name: string, value: number) => void;
    setBypass: (bypassed: boolean) => void;
    reorderModules: (order: [number, number, number, number, number]) => void;
    resetIntegrated: () => void;
    onMeterData: (cb: (data: ProofMeterData) => void) => void;
    connect: (dest: AudioNode) => void;
    disconnect: () => void;
    destroy: () => void;
    ready: Promise<void>;
};

export function isProofDevice(deviceType: string): boolean {
    return deviceType === 'proof';
}

export async function createProofNode(ctx: BaseAudioContext, wasmUrl?: string): Promise<ProofNodeResult> {
    await ensureWorkletRegistered(ctx);

    if (ctx instanceof AudioContext && ctx.state === 'suspended') {
        await ctx.resume();
    }

    const node = new AudioWorkletNode(ctx, 'proof-processor', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
    });

    let bypassed = false;
    let settled = false;
    let meterCallback: ((data: ProofMeterData) => void) | null = null;
    let sabSlot = telemetryAllocator.allocateSlot();
    let pollInterval: ReturnType<typeof setInterval> | null = null;

    const readyPromise = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
            if (!settled) {
                settled = true;
                reject(new Error('ProofNode init timeout (10s)'));
            }
        }, 10_000);
        node.port.onmessage = (e: MessageEvent) => {
            if (e.data.type === 'ready' && !settled) {
                settled = true;
                clearTimeout(timeout);
                if (sabSlot) {
                    node.port.postMessage({ type: 'init-sab', sab: sabSlot.sab, byteOffset: sabSlot.byteOffset });
                    const view = sabSlot.view;
                    pollInterval = setInterval(() => {
                        if (meterCallback) {
                            meterCallback({
                                inputLufs: view[PROOF_IDX.inputLufs]!,
                                outputLufs: view[PROOF_IDX.outputLufs]!,
                                outputStLufs: view[PROOF_IDX.outputStLufs]!,
                                integratedLufs: view[PROOF_IDX.integratedLufs]!,
                                truePeakDb: view[PROOF_IDX.truePeakDb]!,
                                lra: view[PROOF_IDX.lra]!,
                                correlation: view[PROOF_IDX.correlation]!,
                                limiterGrDb: view[PROOF_IDX.limiterGrDb]!,
                                dynGr: [
                                    view[PROOF_IDX.dynGr0]!,
                                    view[PROOF_IDX.dynGr1]!,
                                    view[PROOF_IDX.dynGr2]!,
                                    view[PROOF_IDX.dynGr3]!,
                                ],
                                tapPeaks: [
                                    { peakL: view[PROOF_IDX.tap0PeakL]!, peakR: view[PROOF_IDX.tap0PeakR]! },
                                    { peakL: view[PROOF_IDX.tap1PeakL]!, peakR: view[PROOF_IDX.tap1PeakR]! },
                                    { peakL: view[PROOF_IDX.tap2PeakL]!, peakR: view[PROOF_IDX.tap2PeakR]! },
                                    { peakL: view[PROOF_IDX.tap3PeakL]!, peakR: view[PROOF_IDX.tap3PeakR]! },
                                    { peakL: view[PROOF_IDX.tap4PeakL]!, peakR: view[PROOF_IDX.tap4PeakR]! },
                                    { peakL: view[PROOF_IDX.tap5PeakL]!, peakR: view[PROOF_IDX.tap5PeakR]! },
                                ],
                                latency: view[PROOF_IDX.latency]!,
                            });
                        }
                    }, 16);
                }
                resolve();
            } else if (e.data.type === 'error' && !settled) {
                settled = true;
                clearTimeout(timeout);
                reject(new Error(e.data.message));
            }
        };
    });

    const wasmBytes = await fetchWasmBinary(wasmUrl ?? DEFAULT_WASM_URL);
    const copy = wasmBytes.slice(0);
    node.port.postMessage({ type: 'init', wasmBytes: copy }, [copy]);

    return {
        workletNode: node,
        setParam(name: string, value: number) {
            if (!bypassed && Number.isFinite(value)) {
                node.port.postMessage({ type: 'param', name, value });
            }
        },
        setBypass(state: boolean) {
            bypassed = state;
            node.port.postMessage({ type: 'param', name: 'bypass', value: state ? 1 : 0 });
        },
        reorderModules(order: [number, number, number, number, number]) {
            node.port.postMessage({ type: 'reorder', order });
        },
        resetIntegrated() {
            node.port.postMessage({ type: 'reset_integrated' });
        },
        onMeterData(cb: (data: ProofMeterData) => void) {
            meterCallback = cb;
        },
        connect(dest: AudioNode) {
            node.connect(dest);
        },
        disconnect() {
            try {
                node.disconnect();
            } catch {
                /* already disconnected */
            }
        },
        destroy() {
            if (pollInterval !== null) {
                clearInterval(pollInterval);
                pollInterval = null;
            }
            if (sabSlot) {
                telemetryAllocator.releaseSlot(sabSlot.byteOffset);
                sabSlot = null;
            }
            try {
                node.disconnect();
            } catch {}
            node.port.close();
        },
        ready: readyPromise,
    };
}
