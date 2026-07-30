/**
 * KneadNode — AudioWorkletNode wrapper for the Knead real-time pitch processor.
 *
 * Synchronizes with the kneadStore to receive per-clip pitch blobs and parameters.
 */

import { ensureWorkletRegistered, fetchWasmBinary, createReadyHandshake } from '#/infra/audioWorklet/workletInitShared';

import kneadProcessorUrl from '../services/kneadProcessor.ts?worker&url';

const DEFAULT_WASM_URL = '/wasm/daw-dsp/daw_dsp_bg.wasm';

export type KneadNodeResult = {
    workletNode: AudioWorkletNode;
    setParam: (name: string, value: number | number[]) => void;
    setBypass: (bypassed: boolean) => void;
    updateState: (state: Record<string, unknown>) => void;
    destroy: () => void;
    ready: Promise<Record<string, unknown>>;
};

export function isKneadDevice(deviceType: string): boolean {
    return deviceType.toLowerCase() === 'knead';
}

export async function createKneadNode(
    ctx: BaseAudioContext,
    transportSAB?: SharedArrayBuffer
): Promise<KneadNodeResult> {
    if (ctx instanceof AudioContext && ctx.state === 'suspended') {
        await ctx.resume();
    }

    await ensureWorkletRegistered(ctx, kneadProcessorUrl);

    const node = new AudioWorkletNode(ctx, 'knead-processor', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        channelCount: 2,
        channelCountMode: 'explicit',
    });

    const handshake = createReadyHandshake({ pluginName: 'KneadNode' });
    node.port.onmessage = (event: MessageEvent) => {
        handshake.onMessage(event);
    };
    const readyPromise = handshake.promise;

    const wasmBytes = await fetchWasmBinary(DEFAULT_WASM_URL);
    const copy = wasmBytes.slice(0);
    node.port.postMessage(
        {
            type: 'init',
            wasmBytes: copy,
            transportSAB,
        },
        [copy]
    );

    return {
        workletNode: node,
        setParam: (name, value) => {
            node.port.postMessage({ type: 'param', name, value });
        },
        setBypass: (bypassed) => {
            node.port.postMessage({ type: 'bypass', bypassed });
        },
        updateState: (clips: Record<string, unknown>) => {
            node.port.postMessage({ type: 'update-state', clips });
        },
        destroy: () => {
            try {
                node.disconnect();
            } catch {
                // The node may already be detached during teardown.
            }
            node.port.close();
        },
        ready: readyPromise,
    };
}
