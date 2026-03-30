/**
 * BacteriaNode — AudioWorkletNode wrapper for the Bacteria creative multi-effects.
 *
 * Same pattern as GlutenNode: caches WASM binary, resumes AudioContext,
 * provides setParam/setBypass via MessagePort.
 */

import bacteriaProcessorUrl from '../services/bacteriaProcessor.ts?worker&url';

const DEFAULT_WASM_URL = '/wasm/daw-dsp/daw_dsp_bg.wasm';

let workletRegistrationPromise: Promise<void> | null = null;
let cachedWasmBytes: ArrayBuffer | null = null;

async function ensureWorkletRegistered(ctx: AudioContext): Promise<void> {
    if (!workletRegistrationPromise) {
        workletRegistrationPromise = ctx.audioWorklet.addModule(bacteriaProcessorUrl);
    }
    return workletRegistrationPromise;
}

async function fetchWasmBinary(url: string): Promise<ArrayBuffer> {
    if (cachedWasmBytes) { return cachedWasmBytes; }
    const response = await fetch(url);
    if (!response.ok) { throw new Error(`Failed to fetch Bacteria WASM: ${response.status}`); }
    cachedWasmBytes = await response.arrayBuffer();
    return cachedWasmBytes;
}

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

export async function createBacteriaNode(ctx: AudioContext, wasmUrl?: string): Promise<BacteriaNodeResult> {
    if (ctx.state === 'suspended') {
        await ctx.resume();
    }

    await ensureWorkletRegistered(ctx);

    const node = new AudioWorkletNode(ctx, 'bacteria-processor', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        channelCount: 2,
        channelCountMode: 'explicit',
    });

    let settled = false;
    let meterCallback: ((data: BacteriaMeterData) => void) | null = null;

    const readyPromise = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
            if (!settled) { settled = true; reject(new Error('BacteriaNode init timeout (10s)')); }
        }, 10_000);
        node.port.onmessage = (e: MessageEvent) => {
            if (e.data.type === 'ready') {
                if (!settled) {
                    settled = true;
                    clearTimeout(timeout);
                    resolve();
                }
            } else if (e.data.type === 'error' && !settled) {
                settled = true;
                clearTimeout(timeout);
                reject(new Error(e.data.message));
            } else if (e.data.type === 'meters' && meterCallback) {
                meterCallback(e.data as BacteriaMeterData);
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
        onMeterData(cb: (data: BacteriaMeterData) => void) {
            meterCallback = cb;
        },
        connect(dest: AudioNode) { node.connect(dest); },
        disconnect() { try { node.disconnect(); } catch {} },
        destroy() { try { node.disconnect(); } catch {} node.port.close(); },
        ready: readyPromise,
    };
}
