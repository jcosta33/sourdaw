/**
 * ToasterNode — AudioWorkletNode wrapper for the Toaster drum machine.
 *
 * Same pattern as FermenterNode: caches WASM binary, resumes AudioContext,
 * provides noteOn/noteOff/setParam/setPadParam via MessagePort.
 */

import toasterProcessorUrl from '../services/toasterProcessor.ts?worker&url';

const DEFAULT_WASM_URL = '/wasm/daw-dsp/daw_dsp_bg.wasm';

const workletRegistrations = new WeakMap<BaseAudioContext, Promise<void>>();
let cachedWasmBytes: ArrayBuffer | null = null;

async function ensureWorkletRegistered(ctx: BaseAudioContext): Promise<void> {
    let promise = workletRegistrations.get(ctx);
    if (!promise) {
        promise = ctx.audioWorklet.addModule(toasterProcessorUrl);
        workletRegistrations.set(ctx, promise);
    }
    return promise;
}

async function fetchWasmBinary(url: string): Promise<ArrayBuffer> {
    if (cachedWasmBytes) { return cachedWasmBytes; }
    const response = await fetch(url);
    if (!response.ok) { throw new Error(`Failed to fetch Toaster WASM: ${response.status}`); }
    cachedWasmBytes = await response.arrayBuffer();
    return cachedWasmBytes;
}

export type ToasterNodeResult = {
    workletNode: AudioWorkletNode;
    noteOn: (pad: number, velocity: number, midiNote?: number, sampleFrame?: number) => void;
    noteOff: (pad: number, sampleFrame?: number) => void;
    setParam: (name: string, value: number) => void;
    setPadParam: (pad: number, name: string, value: number) => void;
    setBypass: (bypassed: boolean) => void;
    connect: (dest: AudioNode) => void;
    disconnect: () => void;
    destroy: () => void;
    ready: Promise<void>;
};

export function isToasterDevice(deviceType: string): boolean {
    return deviceType === 'toaster';
}

export async function createToasterNode(ctx: BaseAudioContext, wasmUrl?: string): Promise<ToasterNodeResult> {
    if (ctx instanceof AudioContext && ctx.state === 'suspended') {
        await ctx.resume();
    }

    await ensureWorkletRegistered(ctx);

    const node = new AudioWorkletNode(ctx, 'toaster-processor', {
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
            if (!settled) { settled = true; reject(new Error('ToasterNode init timeout (10s)')); }
        }, 10_000);
        node.port.onmessage = (e: MessageEvent) => {
            if (settled) { return; }
            if (e.data.type === 'ready') { settled = true; clearTimeout(timeout); resolve(); }
            else if (e.data.type === 'error') { settled = true; clearTimeout(timeout); reject(new Error(e.data.message)); }
        };
    });

    const wasmBytes = await fetchWasmBinary(wasmUrl ?? DEFAULT_WASM_URL);
    const copy = wasmBytes.slice(0);
    node.port.postMessage({ type: 'init', wasmBytes: copy }, [copy]);

    return {
        workletNode: node,
        noteOn(pad: number, velocity: number, midiNote: number = 60, sampleFrame?: number) {
            if (!bypassed) {
                node.port.postMessage({ type: 'noteOn', pad, velocity: Math.min(127, Math.max(0, velocity)), note: midiNote, sampleFrame });
            }
        },
        noteOff(pad: number, sampleFrame?: number) {
            node.port.postMessage({ type: 'noteOff', pad, sampleFrame });
        },
        setParam(name: string, value: number) {
            if (Number.isFinite(value)) {
                node.port.postMessage({ type: 'param', name, value });
            }
        },
        setPadParam(pad: number, name: string, value: number) {
            if (Number.isFinite(value)) {
                node.port.postMessage({ type: 'padParam', pad, name, value });
            }
        },
        setBypass(state: boolean) { bypassed = state; },
        connect(dest: AudioNode) { node.connect(dest); },
        disconnect() { try { node.disconnect(); } catch {} },
        destroy() { try { node.disconnect(); } catch {} node.port.close(); },
        ready: readyPromise,
    };
}
