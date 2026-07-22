/**
 * ProofChamberNode — AudioWorkletNode wrapper for the Dutch Oven reverb.
 * Stereo effect: audio in → reverb processing → audio out.
 */

import { createReadyHandshake, ensureWorkletRegistered, fetchWasmBinary } from '#/infra/audioWorklet/workletInitShared';

import { type OfflineAutomationSegment } from '../models/OfflineAutomationSegment';
import proofChamberProcessorUrl from '../services/proofChamberProcessor.ts?worker&url';

const DEFAULT_WASM_URL = '/wasm/proof-chamber/proof_chamber_bg.wasm';

export type ProofChamberNodeResult = {
    workletNode: AudioWorkletNode;
    setParam: (name: string, value: number) => void;
    scheduleParam: (name: string, segments: readonly OfflineAutomationSegment[]) => void;
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

    const scheduleParam = (name: string, segments: readonly OfflineAutomationSegment[]): void => {
        const valid =
            name.length > 0 &&
            segments.length > 0 &&
            segments.every(
                (segment) =>
                    Number.isInteger(segment.startFrame) &&
                    Number.isInteger(segment.endFrame) &&
                    segment.startFrame >= 0 &&
                    segment.endFrame >= segment.startFrame &&
                    Number.isFinite(segment.startValue) &&
                    Number.isFinite(segment.endValue)
            );
        if (valid) {
            node.port.postMessage({ type: 'paramAutomation', name, segments });
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

    return { workletNode: node, setParam, scheduleParam, setBypass, connect, disconnect, destroy, ready: readyPromise };
}
