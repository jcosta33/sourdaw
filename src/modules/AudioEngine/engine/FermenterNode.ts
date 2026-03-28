/**
 * Engine class: FermenterNode
 *
 * Wraps an AudioWorkletNode that hosts the Fermenter synthesizer WASM instance.
 * Provides noteOn/noteOff/setParam methods that forward via MessagePort.
 * Used when a track has a 'fermenter' instrument device.
 */

import fermenterProcessorUrl from '../services/fermenterProcessor.ts?worker&url';

/** Default WASM path — served from public/ via Vite. */
const DEFAULT_WASM_URL = '/wasm/fermenter/fermenter_bg.wasm';

let workletRegistered = false;

async function ensureWorkletRegistered(ctx: BaseAudioContext): Promise<void> {
    if (workletRegistered) {
        return;
    }
    await ctx.audioWorklet.addModule(fermenterProcessorUrl);
    workletRegistered = true;
}

export type FermenterNodeResult = {
    workletNode: AudioWorkletNode;
    noteOn: (note: number, velocity: number) => void;
    noteOff: (note: number) => void;
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
 * Returns immediately with an unconnected node; await `result.ready` before
 * sending MIDI events.
 *
 * @param ctx - The AudioContext (must be a real AudioContext, not OfflineAudioContext)
 * @param wasmUrl - Optional override for the WASM binary URL
 */
export async function createFermenterNode(
    ctx: BaseAudioContext,
    wasmUrl?: string
): Promise<FermenterNodeResult> {
    await ensureWorkletRegistered(ctx);

    const node = new AudioWorkletNode(ctx, 'fermenter-processor', {
        numberOfInputs: 0,   // Instruments generate audio — no audio input needed
        numberOfOutputs: 1,
        outputChannelCount: [2],
        channelCount: 2,
        channelCountMode: 'explicit',
    });

    let bypassed = false;

    const readyPromise = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('FermenterNode init timeout')), 10_000);
        node.port.onmessage = (e: MessageEvent) => {
            if (e.data.type === 'ready') {
                clearTimeout(timeout);
                resolve();
            } else if (e.data.type === 'error') {
                clearTimeout(timeout);
                reject(new Error(e.data.message as string));
            }
        };
    });

    // Fetch WASM binary on main thread (AudioWorklet scope lacks fetch on Safari/WKWebView)
    const resolvedWasmUrl = wasmUrl ?? DEFAULT_WASM_URL;
    const wasmResponse = await fetch(resolvedWasmUrl);
    const wasmBytes = await wasmResponse.arrayBuffer();

    node.port.postMessage(
        { type: 'init', wasmBytes },
        [wasmBytes] // Transfer ownership for zero-copy
    );

    const noteOn = (note: number, velocity: number): void => {
        if (!bypassed) {
            node.port.postMessage({ type: 'noteOn', note, velocity });
        }
    };

    const noteOff = (note: number): void => {
        if (!bypassed) {
            node.port.postMessage({ type: 'noteOff', note });
        }
    };

    const setParam = (name: string, value: number): void => {
        node.port.postMessage({ type: 'param', name, value });
    };

    const setBypass = (bypassState: boolean): void => {
        bypassed = bypassState;
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

    return {
        workletNode: node,
        noteOn,
        noteOff,
        setParam,
        setBypass,
        connect,
        disconnect,
        destroy,
        ready: readyPromise,
    };
}
