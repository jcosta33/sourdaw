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
    setParam: (name: string, value: number | number[], sampleFrame?: number) => void;
    setPatch: (patch: Record<string, unknown>) => void;
    setBypass: (bypassed: boolean) => void;
    onTelemetry: (callback: (data: { peakL: number; peakR: number; scopeBuffer: Float32Array }) => void) => void;
    connect: (dest: AudioNode) => void;
    disconnect: () => void;
    destroy: () => void;
    ready: Promise<Record<string, unknown>>;
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
    const telemetryListeners = new Set<(data: { peakL: number; peakR: number; scopeBuffer: Float32Array }) => void>();
    node.port.onmessage = (event: MessageEvent) => {
        const payload = event.data as
            | { type?: string; peakL: number; peakR: number; scopeBuffer: Float32Array }
            | undefined;
        if (payload?.type === 'telemetry') {
            const data = { peakL: payload.peakL, peakR: payload.peakR, scopeBuffer: payload.scopeBuffer };
            for (const listener of telemetryListeners) {
                listener(data);
            }
        } else {
            handshake.onMessage(event);
        }
    };
    const readyPromise = handshake.promise;

    const wasmBytes = await fetchWasmBinary(wasmUrl ?? DEFAULT_WASM_URL);
    const copy = wasmBytes.slice(0);
    node.port.postMessage({ type: 'init', wasmBytes: copy }, [copy]);

    return {
        workletNode: node,
        noteOn(note: number, velocity: number, sampleFrame?: number) {
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
        setParam(name: string, value: number | number[], sampleFrame?: number) {
            if (Array.isArray(value) || Number.isFinite(value)) {
                node.port.postMessage({ type: 'param', name, value, sampleFrame });
            }
        },
        setPatch(patch: Record<string, unknown>) {
            node.port.postMessage({ type: 'patch', patch });
        },
        setBypass(state: boolean) {
            bypassed = state;
        },
        onTelemetry(cb: (data: { peakL: number; peakR: number; scopeBuffer: Float32Array }) => void) {
            telemetryListeners.add(cb);
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
            } catch {
                // ignore
            }
            node.port.close();
        },
        ready: readyPromise,
    };
}
