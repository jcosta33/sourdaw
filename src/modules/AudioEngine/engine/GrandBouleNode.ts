/**
 * GrandBouleNode — double-buffered AudioWorkletNode for the Grand Boule piano.
 *
 * Architecture:
 *   Main thread  →  Web Worker (WASM engine)  →  SAB ring buffer  →  AudioWorklet (consumer)
 *
 * The WASM physical-modeling engine runs on a dedicated Web Worker that
 * renders ahead into a SharedArrayBuffer. The AudioWorklet process() just
 * copies from the ring buffer — microseconds of work, zero risk of
 * real-time underrun from DSP load.
 *
 * MIDI and control messages are routed to the Worker, not the worklet.
 */

import grandBouleProcessorUrl from '../services/grandBouleProcessor.ts?worker&url';

const DEFAULT_WASM_URL = '/wasm/daw-dsp/daw_dsp_bg.wasm';

const workletRegistrations = new WeakMap<BaseAudioContext, Promise<void>>();
let cachedWasmBytes: ArrayBuffer | null = null;

/** Ring buffer: 8192 stereo frames ≈ 170 ms at 48 kHz. */
const RING_FRAMES = 8192;
const HEADER_BYTES = 2 * Int32Array.BYTES_PER_ELEMENT; // writeHead + readHead
const SAB_BYTES = HEADER_BYTES + RING_FRAMES * 2 * Float32Array.BYTES_PER_ELEMENT;

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

export async function createGrandBouleNode(ctx: BaseAudioContext, wasmUrl?: string): Promise<GrandBouleNodeResult> {
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

    // Create SAB ring buffer shared between Worker and AudioWorklet.
    // Requires cross-origin isolation (COOP + COEP headers).
    if (typeof SharedArrayBuffer === 'undefined') {
        throw new Error(
            'SharedArrayBuffer is not available. The server must send ' +
                'Cross-Origin-Opener-Policy: same-origin and ' +
                'Cross-Origin-Embedder-Policy: require-corp headers.'
        );
    }
    const sab = new SharedArrayBuffer(SAB_BYTES);

    // Create the engine Worker.
    const engineWorker = new Worker(new URL('../workers/grandBouleEngineWorker.ts', import.meta.url), {
        type: 'module',
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

        engineWorker.onmessage = (e: MessageEvent) => {
            if (settled) {return;}
            if (e.data.type === 'ready') {
                settled = true;
                clearTimeout(timeout);
                // Now init the worklet side with the same SAB.
                node.port.postMessage({ type: 'init', sab });
                resolve();
            } else if (e.data.type === 'error') {
                settled = true;
                clearTimeout(timeout);
                reject(new Error(e.data.message));
            }
        };
    });

    // Send WASM bytes + SAB to the engine worker.
    const wasmBytes = await fetchWasmBinary(wasmUrl ?? DEFAULT_WASM_URL);
    const copy = wasmBytes.slice(0);
    engineWorker.postMessage({ type: 'init', wasmBytes: copy, sab, sampleRate: ctx.sampleRate }, [copy]);

    /** Post a message to the engine worker (not the AudioWorklet). */
    const post = (msg: Record<string, unknown>): void => {
        engineWorker.postMessage(msg);
    };

    return {
        workletNode: node,
        noteOn(midiNote: number, velocity: number, _sampleFrame?: number) {
            if (!bypassed) {
                post({ type: 'noteOn', midiNote, velocity });
            }
        },
        noteOff(midiNote: number, _sampleFrame?: number) {
            post({ type: 'noteOff', midiNote });
        },
        setParam(name: string, value: number) {
            if (Number.isFinite(value)) {
                post({ type: 'param', name, value });
            }
        },
        setSustain(position: number) {
            post({ type: 'sustain', position });
        },
        setUnaCorda(engaged: boolean) {
            post({ type: 'unaCorda', engaged });
        },
        setSostenuto(engaged: boolean) {
            post({ type: 'sostenuto', engaged });
        },
        noteOnMidi2(midiNote: number, velocity16bit: number, pitchOffsetQ24: number) {
            if (!bypassed) {
                post({ type: 'noteOnMidi2', midiNote, velocity16bit, pitchOffsetQ24 });
            }
        },
        setTemperament(index: number) {
            post({ type: 'temperament', index });
        },
        loadAttackClip(key: number, samples: Float32Array) {
            const buf = new Float32Array(samples);
            post({ type: 'loadAttackClip', key, samples: buf });
        },
        allNotesOff() {
            post({ type: 'allNotesOff' });
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
            engineWorker.postMessage({ type: 'stop' });
            engineWorker.terminate();
        },
        ready: readyPromise,
    };
}
