/**
 * ProofChamberNode — AudioWorkletNode wrapper for the Proof Chamber reverb.
 * Stereo effect: audio in → reverb processing → audio out.
 */

import proofChamberProcessorUrl from '../services/proofChamberProcessor.ts?worker&url';

const DEFAULT_WASM_URL = '/wasm/proof-chamber/proof_chamber_bg.wasm';

const workletRegistrations = new WeakMap<BaseAudioContext, Promise<void>>();
let cachedWasmBytes: ArrayBuffer | null = null;

async function ensureWorkletRegistered(ctx: BaseAudioContext): Promise<void> {
    let promise = workletRegistrations.get(ctx);
    if (!promise) {
        promise = ctx.audioWorklet.addModule(proofChamberProcessorUrl);
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
        throw new Error(`Failed to fetch Proof Chamber WASM: ${response.status}`);
    }
    cachedWasmBytes = await response.arrayBuffer();
    return cachedWasmBytes;
}

export type ProofChamberNodeResult = {
    workletNode: AudioWorkletNode;
    setParam: (name: string, value: number) => void;
    setBypass: (bypassed: boolean) => void;
    connect: (dest: AudioNode) => void;
    disconnect: () => void;
    destroy: () => void;
    ready: Promise<void>;
};

export function isProofChamberDevice(deviceType: string): boolean {
    return deviceType === 'native-proof-chamber';
}

export async function createProofChamberNode(
    ctx: BaseAudioContext,
): Promise<ProofChamberNodeResult> {
    if (ctx instanceof AudioContext && ctx.state === 'suspended') {
        await ctx.resume();
    }

    await ensureWorkletRegistered(ctx);

    const node = new AudioWorkletNode(ctx, 'proof-chamber-processor', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        channelCount: 2,
        channelCountMode: 'explicit',
    });

    let settled = false;

    const readyPromise = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
            if (!settled) {
                settled = true;
                reject(new Error('ProofChamberNode init timeout'));
            }
        }, 10_000);
        node.port.onmessage = (e: MessageEvent) => {
            if (!settled) {
                if (e.data.type === 'ready') {
                    settled = true;
                    clearTimeout(timeout);
                    resolve();
                } else if (e.data.type === 'error') {
                    settled = true;
                    clearTimeout(timeout);
                    reject(new Error(e.data.message));
                }
            }
        };
    });

    const wasmBytes = await fetchWasmBinary(DEFAULT_WASM_URL);
    const copy = wasmBytes.slice(0);
    node.port.postMessage({ type: 'init', wasmBytes: copy }, [copy]);

    const setParam = (name: string, value: number): void => {
        if (Number.isFinite(value)) {
            node.port.postMessage({ type: 'param', name, value });
        }
    };

    const setBypass = (bypassed: boolean): void => {
        node.port.postMessage({ type: 'bypass', bypassed });
    };

    const connect = (dest: AudioNode): void => {
        node.connect(dest);
    };

    const disconnect = (): void => {
        try { node.disconnect(); } catch { /* already disconnected */ }
    };

    const destroy = (): void => {
        disconnect();
        node.port.close();
    };

    return { workletNode: node, setParam, setBypass, connect, disconnect, destroy, ready: readyPromise };
};
