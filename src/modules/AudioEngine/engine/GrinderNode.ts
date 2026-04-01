/**
 * GrinderNode — AudioWorkletNode wrapper for the Grinder amp simulator.
 */

import grinderProcessorUrl from '../services/grinderProcessor.ts?worker&url';

const DEFAULT_WASM_URL = '/wasm/daw-dsp/daw_dsp_bg.wasm';

const workletRegistrations = new WeakMap<BaseAudioContext, Promise<void>>();
let cachedWasmBytes: ArrayBuffer | null = null;

async function ensureWorkletRegistered(ctx: BaseAudioContext): Promise<void> {
    let promise = workletRegistrations.get(ctx);
    if (!promise) {
        promise = ctx.audioWorklet.addModule(grinderProcessorUrl);
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
        throw new Error(`Failed to fetch Grinder WASM: ${response.status}`);
    }
    cachedWasmBytes = await response.arrayBuffer();
    return cachedWasmBytes;
}

export type GrinderMeterData = {
    inputDb: number;
    preampDb: number;
    powerAmpDb: number;
    outputDb: number;
    sagVoltage: number;
    latency: number;
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
    let meterCallback: ((data: GrinderMeterData) => void) | null = null;

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
            } else if (e.data.type === 'error' && !settled) {
                settled = true;
                clearTimeout(timeout);
                reject(new Error(e.data.message));
            } else if (e.data.type === 'meters' && meterCallback) {
                meterCallback(e.data as GrinderMeterData);
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
            meterCallback = cb;
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
            try {
                node.disconnect();
            } catch {}
            node.port.close();
        },
        ready: readyPromise,
    };
}
