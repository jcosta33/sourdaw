/**
 * GrandBouleNode — AudioWorkletNode wrapper for the Grand Boule piano.
 *
 * Same pattern as ToasterNode/FermenterNode: caches WASM binary, resumes
 * AudioContext, provides noteOn/noteOff/setParam/pedals via MessagePort.
 */

import grandBouleProcessorUrl from '../services/grandBouleProcessor.ts?worker&url';

const DEFAULT_WASM_URL = '/wasm/daw-dsp/daw_dsp_bg.wasm';

const workletRegistrations = new WeakMap<BaseAudioContext, Promise<void>>();
let cachedWasmBytes: ArrayBuffer | null = null;

async function ensureWorkletRegistered(ctx: BaseAudioContext): Promise<void> {
    let promise = workletRegistrations.get(ctx);
    if (!promise) {
        promise = ctx.audioWorklet.addModule(grandBouleProcessorUrl);
        workletRegistrations.set(ctx, promise);
    }
    return promise;
}

async function fetchWasmBinary(url: string): Promise<ArrayBuffer> {
    if (cachedWasmBytes) {
        return cachedWasmBytes;
    }
    // Append a cache-buster in dev mode so rebuilt WASM is always picked up.
    const fetchUrl = import.meta.env.DEV ? `${url}?t=${Date.now()}` : url;
    const response = await fetch(fetchUrl);
    if (!response.ok) {
        throw new Error(`Failed to fetch Grand Boule WASM: ${response.status}`);
    }
    cachedWasmBytes = await response.arrayBuffer();
    return cachedWasmBytes;
}

export type GrandBouleNodeResult = {
    workletNode: AudioWorkletNode;
    noteOn: (midiNote: number, velocity: number, sampleFrame?: number) => void;
    noteOff: (midiNote: number, sampleFrame?: number) => void;
    setParam: (name: string, value: number) => void;
    setSustain: (position: number) => void;
    setUnaCorda: (engaged: boolean) => void;
    setSostenuto: (engaged: boolean) => void;
    noteOnMidi2: (midiNote: number, velocity16bit: number, pitchOffsetQ24: number) => void;
    setTemperament: (index: number) => void;
    loadAttackClip: (key: number, samples: Float32Array) => void;
    allNotesOff: () => void;
    setBypass: (bypassed: boolean) => void;
    connect: (dest: AudioNode) => void;
    disconnect: () => void;
    destroy: () => void;
    ready: Promise<void>;
};

export function isGrandBouleDevice(deviceType: string): boolean {
    return deviceType === 'grand-boule';
}

export async function createGrandBouleNode(
    ctx: BaseAudioContext,
    wasmUrl?: string,
): Promise<GrandBouleNodeResult> {
    if (ctx instanceof AudioContext && ctx.state === 'suspended') {
        await ctx.resume();
    }

    await ensureWorkletRegistered(ctx);

    const node = new AudioWorkletNode(ctx, 'grand-boule-processor', {
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
            if (!settled) {
                settled = true;
                reject(new Error('GrandBouleNode init timeout (10s)'));
            }
        }, 10_000);
        node.port.onmessage = (e: MessageEvent) => {
            if (settled) {
                return;
            }
            if (e.data.type === 'ready') {
                settled = true;
                clearTimeout(timeout);
                resolve();
            } else if (e.data.type === 'error') {
                settled = true;
                clearTimeout(timeout);
                reject(new Error(e.data.message));
            }
        };
    });

    const wasmBytes = await fetchWasmBinary(wasmUrl ?? DEFAULT_WASM_URL);
    const copy = wasmBytes.slice(0);
    node.port.postMessage({ type: 'init', wasmBytes: copy }, [copy]);

    return {
        workletNode: node,
        noteOn(midiNote: number, velocity: number, sampleFrame?: number) {
            if (!bypassed) {
                node.port.postMessage({ type: 'noteOn', midiNote, velocity, sampleFrame });
            }
        },
        noteOff(midiNote: number, sampleFrame?: number) {
            node.port.postMessage({ type: 'noteOff', midiNote, sampleFrame });
        },
        setParam(name: string, value: number) {
            if (Number.isFinite(value)) {
                node.port.postMessage({ type: 'param', name, value });
            }
        },
        setSustain(position: number) {
            node.port.postMessage({ type: 'sustain', position });
        },
        setUnaCorda(engaged: boolean) {
            node.port.postMessage({ type: 'unaCorda', engaged });
        },
        setSostenuto(engaged: boolean) {
            node.port.postMessage({ type: 'sostenuto', engaged });
        },
        noteOnMidi2(midiNote: number, velocity16bit: number, pitchOffsetQ24: number) {
            if (!bypassed) {
                node.port.postMessage({ type: 'noteOnMidi2', midiNote, velocity16bit, pitchOffsetQ24 });
            }
        },
        setTemperament(index: number) {
            node.port.postMessage({ type: 'temperament', index });
        },
        loadAttackClip(key: number, samples: Float32Array) {
            const copy = new Float32Array(samples);
            node.port.postMessage({ type: 'loadAttackClip', key, samples: copy }, [copy.buffer]);
        },
        allNotesOff() {
            node.port.postMessage({ type: 'allNotesOff' });
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
