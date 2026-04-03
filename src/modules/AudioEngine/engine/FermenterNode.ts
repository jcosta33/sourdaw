/**
 * FermenterNode — AudioWorkletNode wrapper for the Fermenter synthesizer.
 *
 * Creates and manages the WASM-powered worklet. Provides noteOn/noteOff/setParam
 * methods that forward via MessagePort. Caches WASM binary and worklet registration.
 */

import fermenterProcessorUrl from '../services/fermenterProcessor.ts?worker&url';

const DEFAULT_WASM_URL = '/wasm/daw-dsp/daw_dsp_bg.wasm';

const workletRegistrations = new WeakMap<BaseAudioContext, Promise<void>>();
let cachedWasmBytes: ArrayBuffer | null = null;

async function ensureWorkletRegistered(ctx: BaseAudioContext): Promise<void> {
    let promise = workletRegistrations.get(ctx);
    if (!promise) {
        promise = ctx.audioWorklet.addModule(fermenterProcessorUrl);
        workletRegistrations.set(ctx, promise);
    }
    return promise;
}

async function fetchWasmBinary(url: string): Promise<ArrayBuffer> {
    if (cachedWasmBytes) return cachedWasmBytes;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to fetch Fermenter WASM: ${response.status}`);
    cachedWasmBytes = await response.arrayBuffer();
    return cachedWasmBytes;
}

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

    await ensureWorkletRegistered(ctx);

    const node = new AudioWorkletNode(ctx, 'fermenter-processor', {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        channelCount: 2,
        channelCountMode: 'explicit',
    });

    let bypassed = false;
    let settled = false;

    const readyPromise = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
            if (!settled) { settled = true; reject(new Error('FermenterNode init timeout (10s)')); }
        }, 10_000);
        node.port.onmessage = (e: MessageEvent) => {
            if (settled) return;
            if (e.data.type === 'ready') { settled = true; clearTimeout(timeout); resolve(); }
            else if (e.data.type === 'error') { settled = true; clearTimeout(timeout); reject(new Error(e.data.message)); }
        };
    });

    const wasmBytes = await fetchWasmBinary(wasmUrl ?? DEFAULT_WASM_URL);
    const copy = wasmBytes.slice(0);
    node.port.postMessage({ type: 'init', wasmBytes: copy }, [copy]);

    return {
        workletNode: node,
        noteOn(note: number, velocity: number, sampleFrame?: number) {
            if (!bypassed && note >= 0 && note < 128) {
                node.port.postMessage({ type: 'noteOn', note, velocity: Math.min(127, Math.max(0, velocity)), sampleFrame });
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
        setBypass(state: boolean) { bypassed = state; },
        connect(dest: AudioNode) { node.connect(dest); },
        disconnect() { try { node.disconnect(); } catch { /* already disconnected */ } },
        destroy() { try { node.disconnect(); } catch {} node.port.close(); },
        ready: readyPromise,
    };
}
