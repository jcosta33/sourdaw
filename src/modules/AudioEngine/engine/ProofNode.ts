/**
 * ProofNode — AudioWorkletNode wrapper for the Proof mastering suite.
 *
 * Same pattern as GlutenNode: caches WASM binary, resumes AudioContext,
 * provides setParam/setBypass/reorder via MessagePort.
 *
 * Effect processor: 1 input, 1 output.
 */

import proofProcessorUrl from '../services/proofProcessor.ts?worker&url';

const DEFAULT_WASM_URL = '/wasm/daw-dsp/daw_dsp_bg.wasm';

let workletRegistrationPromise: Promise<void> | null = null;
let cachedWasmBytes: ArrayBuffer | null = null;

async function ensureWorkletRegistered(ctx: AudioContext): Promise<void> {
    if (!workletRegistrationPromise) {
        workletRegistrationPromise = ctx.audioWorklet.addModule(proofProcessorUrl);
    }
    return workletRegistrationPromise;
}

async function fetchWasmBinary(url: string): Promise<ArrayBuffer> {
    if (cachedWasmBytes) { return cachedWasmBytes; }
    const response = await fetch(url);
    if (!response.ok) { throw new Error(`Failed to fetch Proof WASM: ${response.status}`); }
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

export async function createProofNode(ctx: AudioContext, wasmUrl?: string): Promise<ProofNodeResult> {
    await ensureWorkletRegistered(ctx);

    if (ctx.state === 'suspended') {
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

    const readyPromise = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
            if (!settled) { settled = true; reject(new Error('ProofNode init timeout (10s)')); }
        }, 10_000);
        node.port.onmessage = (e: MessageEvent) => {
            if (e.data.type === 'ready' && !settled) {
                settled = true;
                clearTimeout(timeout);
                resolve();
            } else if (e.data.type === 'error' && !settled) {
                settled = true;
                clearTimeout(timeout);
                reject(new Error(e.data.message));
            } else if (e.data.type === 'meters' && meterCallback) {
                const d = e.data;
                meterCallback({
                    inputLufs: d.inputLufs,
                    outputLufs: d.outputLufs,
                    outputStLufs: d.outputStLufs,
                    integratedLufs: d.integratedLufs,
                    truePeakDb: d.truePeakDb,
                    lra: d.lra,
                    correlation: d.correlation,
                    limiterGrDb: d.limiterGrDb,
                    dynGr: [d.dynGr0, d.dynGr1, d.dynGr2, d.dynGr3],
                    tapPeaks: [
                        { peakL: d.tap0PeakL, peakR: d.tap0PeakR },
                        { peakL: d.tap1PeakL, peakR: d.tap1PeakR },
                        { peakL: d.tap2PeakL, peakR: d.tap2PeakR },
                        { peakL: d.tap3PeakL, peakR: d.tap3PeakR },
                        { peakL: d.tap4PeakL, peakR: d.tap4PeakR },
                        { peakL: d.tap5PeakL, peakR: d.tap5PeakR },
                    ],
                    latency: d.latency,
                });
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
        connect(dest: AudioNode) { node.connect(dest); },
        disconnect() { try { node.disconnect(); } catch { /* already disconnected */ } },
        destroy() { try { node.disconnect(); } catch {} node.port.close(); },
        ready: readyPromise,
    };
}
