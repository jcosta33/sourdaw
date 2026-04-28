/**
 * ProofChamberNode — AudioWorkletNode wrapper for the Dutch Oven reverb.
 * Stereo effect: audio in → reverb processing → audio out.
 */

import proofChamberProcessorUrl from '../services/proofChamberProcessor.ts?worker&url';

import { createReadyHandshake, ensureWorkletRegistered, fetchWasmBinary } from './workletInitShared';

const DEFAULT_WASM_URL = '/wasm/proof-chamber/proof_chamber_bg.wasm';

export type ProofChamberNodeResult = {
    workletNode: AudioWorkletNode;
    setParam: (name: string, value: number) => void;
    setBypass: (bypassed: boolean) => void;
    connect: (dest: AudioNode) => void;
    disconnect: () => void;
    destroy: () => void;
    ready: Promise<Record<string, unknown>>;
};

export function isProofChamberDevice(deviceType: string): boolean {
    return deviceType === 'dutch-oven';
}

export async function createProofChamberNode(ctx: BaseAudioContext): Promise<ProofChamberNodeResult> {
    if (ctx instanceof AudioContext && ctx.state === 'suspended') {
        await ctx.resume();
    }

    await ensureWorkletRegistered(ctx, proofChamberProcessorUrl);

    const node = new AudioWorkletNode(ctx, 'proof-chamber-processor', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        channelCount: 2,
        channelCountMode: 'explicit',
    });

    const handshake = createReadyHandshake({ pluginName: 'ProofChamberNode' });
    node.port.onmessage = (event: MessageEvent) => {
        handshake.onMessage(event);
    };
    const readyPromise = handshake.promise;

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
        try {
            node.disconnect();
        } catch {
            /* already disconnected */
        }
    };

    const destroy = (): void => {
        disconnect();
        node.port.close();
    };

    return { workletNode: node, setParam, setBypass, connect, disconnect, destroy, ready: readyPromise };
}
