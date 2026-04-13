/**
 * LevainNode — AudioWorkletNode wrapper for the Levain suite engine.
 *
 * Creates and manages the WASM-powered worklet. Provides noteOn/noteOff/setParam/handleCc
 * methods that forward via MessagePort. Caches WASM binary and worklet registration.
 * Follows the same pattern as FermenterNode.
 */

import levainProcessorUrl from '../services/levainProcessor.ts?worker&url';
import { autoLoadLevainSamples } from '#/modules/Levain/useCases';
import { logger } from '#/infra/logger/appLogger';
import { createReadyHandshake, ensureWorkletRegistered, fetchWasmBinary } from './workletInitShared';

const DEFAULT_WASM_URL = '/wasm/daw-dsp/daw_dsp_bg.wasm';

export type LevainNodeResult = {
    workletNode: AudioWorkletNode;
    noteOn: (note: number, velocity: number, sampleFrame?: number) => void;
    noteOff: (note: number, sampleFrame?: number) => void;
    setParam: (name: string, value: number) => void;
    handleCc: (cc: number, value: number) => void;
    setInstrument: (instrumentId: string) => void;
    setBypass: (bypassed: boolean) => void;
    connect: (dest: AudioNode) => void;
    disconnect: () => void;
    destroy: () => void;
    ready: Promise<void>;
};

export function isLevainDevice(deviceType: string): boolean {
    return deviceType === 'levain';
}

/**
 * Create an Levain AudioWorkletNode.
 *
 * Resumes the AudioContext if suspended. Caches WASM binary across calls.
 * Await `result.ready` before sending MIDI.
 */
export async function createLevainNode(ctx: BaseAudioContext, wasmUrl?: string): Promise<LevainNodeResult> {
    if (ctx instanceof AudioContext && ctx.state === 'suspended') {
        await ctx.resume();
    }

    await ensureWorkletRegistered(ctx, levainProcessorUrl);

    const node = new AudioWorkletNode(ctx, 'levain-processor', {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        channelCount: 2,
        channelCountMode: 'explicit',
    });

    let bypassed = false;

    const handshake = createReadyHandshake({ pluginName: 'LevainNode' });
    node.port.onmessage = (e: MessageEvent) => {
        const outcome = handshake.onMessage(e);
        if (outcome === 'late' && e.data?.type === 'error') {
            logger.warn('LevainNode runtime fault (WASM panic — processor faulted):', e.data.message);
        }
    };
    const readyPromise = handshake.promise;

    // Fetch WASM and initialize the processor.
    const wasmBytes = await fetchWasmBinary(wasmUrl ?? DEFAULT_WASM_URL);
    const copy = wasmBytes.slice(0);
    node.port.postMessage({ type: 'init', wasmBytes: copy }, [copy]);

    // Auto-load levain samples after WASM is ready.
    readyPromise
        .then(() => {
            autoLoadLevainSamples(node.port).catch((err) => {
                logger.warn('[LevainNode] Sample loading failed:', err);
            });
        })
        .catch(() => {
            // WASM init failed — no samples to load
        });

    const noteOn = (note: number, velocity: number, sampleFrame?: number): void => {
        if (!bypassed) {
            node.port.postMessage({ type: 'noteOn', note, velocity, sampleFrame });
        }
    };

    const noteOff = (note: number, sampleFrame?: number): void => {
        node.port.postMessage({ type: 'noteOff', note, sampleFrame });
    };

    const setParam = (name: string, value: number): void => {
        if (!Number.isFinite(value)) {
            return;
        }
        node.port.postMessage({ type: 'param', name, value });
    };

    const handleCc = (cc: number, value: number): void => {
        node.port.postMessage({ type: 'cc', cc, value });
    };

    const setInstrument = (instrumentId: string): void => {
        node.port.postMessage({ type: 'setInstrument', instrumentId });
    };

    const setBypass = (b: boolean): void => {
        bypassed = b;
        node.port.postMessage({ type: 'bypass', bypassed: b });
    };

    const connect = (dest: AudioNode): void => {
        node.connect(dest);
    };

    const disconnect = (): void => {
        try {
            node.disconnect();
        } catch {
            // already disconnected
        }
    };

    const destroy = (): void => {
        disconnect();
        node.port.close();
    };

    return {
        workletNode: node,
        noteOn,
        noteOff,
        setParam,
        handleCc,
        setInstrument,
        setBypass,
        connect,
        disconnect,
        destroy,
        ready: readyPromise,
    };
}
