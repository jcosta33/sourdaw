/**
 * GlutenNode — AudioWorkletNode wrapper for the Gluten bus compressor.
 *
 * Same pattern as FermenterNode/ToasterNode: caches WASM binary, resumes
 * AudioContext, provides setParam/setBypass via MessagePort.
 *
 * Key difference: Gluten is an *effect* (1 input, 1 output), not an instrument.
 */

import glutenProcessorUrl from '../services/glutenProcessor.ts?worker&url';

const DEFAULT_WASM_URL = '/wasm/gluten/gluten_bg.wasm';

const workletRegistrations = new WeakMap<BaseAudioContext, Promise<void>>();
let cachedWasmBytes: ArrayBuffer | null = null;

async function ensureWorkletRegistered(ctx: BaseAudioContext): Promise<void> {
    let promise = workletRegistrations.get(ctx);
    if (!promise) {
        promise = ctx.audioWorklet.addModule(glutenProcessorUrl);
        workletRegistrations.set(ctx, promise);
    }
    return promise;
}

async function fetchWasmBinary(url: string): Promise<ArrayBuffer> {
    if (cachedWasmBytes) { return cachedWasmBytes; }
    const response = await fetch(url);
    if (!response.ok) { throw new Error(`Failed to fetch Gluten WASM: ${response.status}`); }
    cachedWasmBytes = await response.arrayBuffer();
    return cachedWasmBytes;
}

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
    if (ctx instanceof AudioContext && ctx.state === 'suspended') {
        await ctx.resume();
    }

    await ensureWorkletRegistered(ctx);

    const node = new AudioWorkletNode(ctx, 'gluten-processor', {
        numberOfInputs: 2,     // Input 0: main audio, Input 1: external sidechain
        numberOfOutputs: 1,
        outputChannelCount: [2],
        channelCount: 2,
        channelCountMode: 'explicit',
    });

    let settled = false;
    let meterCallback: ((data: GlutenMeterData) => void) | null = null;

    const readyPromise = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
            if (!settled) { settled = true; reject(new Error('GlutenNode init timeout (10s)')); }
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
                meterCallback(e.data as GlutenMeterData);
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
        onMeterData(cb: (data: GlutenMeterData) => void) {
            meterCallback = cb;
        },
        connect(dest: AudioNode) { node.connect(dest); },
        disconnect() { try { node.disconnect(); } catch {} },
        destroy() { try { node.disconnect(); } catch {} node.port.close(); },
        ready: readyPromise,
    };
}
