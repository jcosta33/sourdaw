/**
 * OrchestraNode — AudioWorkletNode wrapper for the Orchestral suite engine.
 *
 * Creates and manages the WASM-powered worklet. Provides noteOn/noteOff/setParam/handleCc
 * methods that forward via MessagePort. Caches WASM binary and worklet registration.
 * Follows the same pattern as FermenterNode.
 */

import orchestraProcessorUrl from '../services/orchestraProcessor.ts?worker&url';
import { autoLoadOrchestraSamples } from '#/modules/Orchestral/useCases/autoLoadSamples';

const DEFAULT_WASM_URL = '/wasm/orchestral/orchestral_bg.wasm';

const workletRegistrations = new WeakMap<AudioContext, Promise<void>>();
let cachedWasmBytes: ArrayBuffer | null = null;

async function ensureWorkletRegistered(ctx: AudioContext): Promise<void> {
    let promise = workletRegistrations.get(ctx);
    if (!promise) {
        promise = ctx.audioWorklet.addModule(orchestraProcessorUrl);
        workletRegistrations.set(ctx, promise);
    }
    return promise;
}

async function fetchWasmBinary(url: string): Promise<ArrayBuffer> {
    if (cachedWasmBytes) {
        return cachedWasmBytes;
    }
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to fetch Orchestral WASM: ${response.status}`);
    }
    cachedWasmBytes = await response.arrayBuffer();
    return cachedWasmBytes;
}

export type OrchestraNodeResult = {
    workletNode: AudioWorkletNode;
    noteOn: (note: number, velocity: number) => void;
    noteOff: (note: number) => void;
    setParam: (name: string, value: number) => void;
    handleCc: (cc: number, value: number) => void;
    setBypass: (bypassed: boolean) => void;
    connect: (dest: AudioNode) => void;
    disconnect: () => void;
    destroy: () => void;
    ready: Promise<void>;
};

export function isOrchestraDevice(deviceType: string): boolean {
    return deviceType === 'orchestral';
}

/**
 * Create an Orchestral AudioWorkletNode.
 *
 * Resumes the AudioContext if suspended. Caches WASM binary across calls.
 * Await `result.ready` before sending MIDI.
 */
export async function createOrchestraNode(
    ctx: AudioContext,
    wasmUrl?: string,
): Promise<OrchestraNodeResult> {
    if (ctx.state === 'suspended') {
        await ctx.resume();
    }

    await ensureWorkletRegistered(ctx);

    const node = new AudioWorkletNode(ctx, 'orchestra-processor', {
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
                reject(new Error('OrchestraNode init timeout (10s)'));
            }
        }, 10_000);
        node.port.onmessage = (e: MessageEvent) => {
            if (!settled) {
                if (e.data.type === 'ready') {
                    settled = true;
                    clearTimeout(timeout);
                    resolve();
                } else if (e.data.type === 'error') {
                    settled = true;
                    clearTimeout(timeout);
                    reject(new Error(e.data.message));
                }
            }
            // After init, continue handling runtime messages (voice count, errors, etc.)
        };
    });

    // Fetch WASM and initialize the processor.
    const wasmBytes = await fetchWasmBinary(wasmUrl ?? DEFAULT_WASM_URL);
    const copy = wasmBytes.slice(0);
    node.port.postMessage({ type: 'init', wasmBytes: copy }, [copy]);

    // Auto-load orchestral samples after WASM is ready.
    readyPromise.then(() => {
        autoLoadOrchestraSamples(node.port).catch((err) => {
            console.warn('[OrchestraNode] Sample loading failed:', err);
        });
    }).catch(() => {
        // WASM init failed — no samples to load
    });

    const noteOn = (note: number, velocity: number): void => {
        if (!bypassed) {
            node.port.postMessage({ type: 'noteOn', note, velocity });
        }
    };

    const noteOff = (note: number): void => {
        node.port.postMessage({ type: 'noteOff', note });
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
        setBypass,
        connect,
        disconnect,
        destroy,
        ready: readyPromise,
    };
}
