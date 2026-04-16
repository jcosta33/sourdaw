/**
 * FermenterNode — AudioWorkletNode wrapper for the Fermenter synthesizer.
 *
 * Creates and manages the WASM-powered worklet. Provides noteOn/noteOff/setParam
 * methods that forward via MessagePort. Caches WASM binary and worklet registration.
 */

import fermenterProcessorUrl from '../services/fermenterProcessor.ts?worker&url';
import { createReadyHandshake, ensureWorkletRegistered, fetchWasmBinary } from './workletInitShared';

const DEFAULT_WASM_URL = '/wasm/daw-dsp/daw_dsp_bg.wasm';

export type FermenterNodeResult = {
    workletNode: AudioWorkletNode;
    noteOn: (note: number, velocity: number, sampleFrame?: number) => void;
    noteOff: (note: number, sampleFrame?: number) => void;
    setParam: (name: string, value: number) => void;
    setBypass: (bypassed: boolean) => void;
    connect: (dest: AudioNode) => void;
    disconnect: () => void;
    destroy: () => void;
    ready: Promise<void>;
};

export function isFermenterDevice(deviceType: string): boolean {
    return deviceType === 'fermenter';
}

/**
 * Create a Fermenter AudioWorkletNode.
 *
 * Resumes the AudioContext if suspended (worklet processors only run when active).
 * Caches WASM binary across calls. Await `result.ready` before sending MIDI.
 */
export async function createFermenterNode(ctx: BaseAudioContext, wasmUrl?: string): Promise<FermenterNodeResult> {
    if (ctx instanceof AudioContext && ctx.state === 'suspended') {
        await ctx.resume();
    }

    await ensureWorkletRegistered(ctx, fermenterProcessorUrl);

    const node = new AudioWorkletNode(ctx, 'fermenter-processor', {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        channelCount: 2,
        channelCountMode: 'explicit',
    });

    let bypassed = false;

    const handshake = createReadyHandshake({ pluginName: 'FermenterNode' });
    node.port.onmessage = (e: MessageEvent) => {
        handshake.onMessage(e);
    };
    const readyPromise = handshake.promise;

    const wasmBytes = await fetchWasmBinary(wasmUrl ?? DEFAULT_WASM_URL);
    const copy = wasmBytes.slice(0);
    node.port.postMessage({ type: 'init', wasmBytes: copy }, [copy]);

    return {
        workletNode: node,
        noteOn(note: number, velocity: number, _midiNote?: number, sampleFrame?: number) {
            if (!bypassed && note >= 0 && note < 128) {
                node.port.postMessage({
                    type: 'noteOn',
                    note,
                    velocity: Math.min(127, Math.max(0, velocity)),
                    sampleFrame,
                });
            }
        },
        noteOff(note: number, sampleFrame?: number) {
            node.port.postMessage({ type: 'noteOff', note, sampleFrame });
        },
        setParam(name: string, value: number) {
            if (Number.isFinite(value)) {
                node.port.postMessage({ type: 'param', name, value });
            }
        },
        setBypass(state: boolean) {
            bypassed = state;
        },
        connect(dest: AudioNode) {
            node.connect(dest);
        },
        disconnect() {
            try {
                node.disconnect();
            } catch {
                /* already disconnected */
            }
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
