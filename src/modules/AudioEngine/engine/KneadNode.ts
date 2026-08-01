/**
 * KneadNode — AudioWorkletNode wrapper for the Knead real-time pitch processor.
 *
 * Synchronizes with the kneadStore to receive per-clip pitch blobs and parameters.
 */

import { raceAbortSignal } from '#/infra/audioWorklet/raceAbortSignal';
import { createReadyHandshake, ensureWorkletRegistered, fetchWasmModule } from '#/infra/audioWorklet/workletInitShared';

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
    transportSAB?: SharedArrayBuffer,
    signal?: AbortSignal
): Promise<KneadNodeResult> {
    if (ctx instanceof AudioContext && ctx.state === 'suspended') {
        await raceAbortSignal(ctx.resume(), signal);
    }

    await raceAbortSignal(ensureWorkletRegistered(ctx, kneadProcessorUrl), signal);
    const wasmLease = await raceAbortSignal(
        fetchWasmModule({ ctx, bundleId: 'daw-dsp', url: DEFAULT_WASM_URL, signal }),
        signal
    );

    signal?.throwIfAborted();

    let node: AudioWorkletNode;
    try {
        node = new AudioWorkletNode(ctx, 'knead-processor', {
            numberOfInputs: 1,
            numberOfOutputs: 1,
            outputChannelCount: [2],
            channelCount: 2,
            channelCountMode: 'explicit',
            processorOptions: { wasmModule: wasmLease.module },
        });
        wasmLease.commit();
    } catch (error) {
        wasmLease.release();
        throw error;
    }

    const handshake = createReadyHandshake({ pluginName: 'KneadNode' });
    node.port.onmessage = (event: MessageEvent) => {
        handshake.onMessage(event);
    };
    const readyPromise = handshake.promise;

    node.port.postMessage({
        type: 'init',
        transportSAB,
    });

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
