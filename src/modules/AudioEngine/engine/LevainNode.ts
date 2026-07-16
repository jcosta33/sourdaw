/**
 * LevainNode — AudioWorkletNode wrapper for the Levain suite engine.
 *
 * Creates and manages the WASM-powered worklet. Provides noteOn/noteOff/setParam/handleCc
 * methods that forward via MessagePort. Caches WASM binary and worklet registration.
 * Follows the same pattern as FermenterNode.
 */

import { logger } from '#/infra/logger/appLogger';

import levainProcessorUrl from '../services/levainProcessor.ts?worker&url';

import { createReadyHandshake, ensureWorkletRegistered, fetchWasmBinary } from './workletInitShared';

const DEFAULT_WASM_URL = '/wasm/daw-dsp/daw_dsp_bg.wasm';

export type LevainNodeResult = {
    workletNode: AudioWorkletNode;
    noteOn: (note: number, velocity: number, sampleFrame?: number) => void;
    noteOff: (note: number, sampleFrame?: number) => void;
    allNotesOff: () => void;
    setParam: (name: string, value: number) => void;
    handleCc: (cc: number, value: number) => void;
    setInstrument: (instrumentId: string) => void;
    setBypass: (bypassed: boolean) => void;
    connect: (dest: AudioNode) => void;
    disconnect: () => void;
    destroy: () => void;
    ready: Promise<Record<string, unknown>>;
};

export function isLevainDevice(deviceType: string): boolean {
    return deviceType === 'levain';
}

/**
 * Create an Levain AudioWorkletNode.
 *
 * Resumes the AudioContext if suspended. Caches WASM binary across calls.
 * Await `result.ready` before sending MIDI.
 *
 * `onFault` is invoked if the worklet posts a runtime-fault `error` message
 * after the ready handshake has already settled (a WASM panic mid-playback).
 * Callers use it to reflect the fault back into UI state (e.g. flip the panel's
 * "Ready" indicator), since the processor goes silent but the node stays alive.
 */
export async function createLevainNode(
    ctx: BaseAudioContext,
    wasmUrl?: string,
    onFault?: (message: string) => void
): Promise<LevainNodeResult> {
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
    node.port.onmessage = (event: MessageEvent<unknown>) => {
        const outcome = handshake.onMessage(event);
        if (
            outcome === 'late' &&
            event.data &&
            typeof event.data === 'object' &&
            'type' in event.data &&
            event.data.type === 'error'
        ) {
            const message = 'message' in event.data ? String(event.data.message) : 'Unknown error';
            logger.warn('LevainNode runtime fault (WASM panic — processor faulted):', message);
            onFault?.(message);
        }
    };
    const readyPromise = handshake.promise;

    // Fetch WASM and initialize the processor.
    const wasmBytes = await fetchWasmBinary(wasmUrl ?? DEFAULT_WASM_URL);
    const copy = wasmBytes.slice(0);
    node.port.postMessage({ type: 'init', wasmBytes: copy }, [copy]);

    // Sample loading is driven by `registerLevainDevice` → `loadSamplesForInstrument`,
    // which reads the active patch's `instrumentId`. Do NOT eagerly load a default
    // instrument here — doing so races the patch-driven load and wastes bandwidth
    // on samples the user did not ask for.

    const noteOn = (note: number, velocity: number, sampleFrame?: number): void => {
        if (!bypassed) {
            node.port.postMessage({ type: 'noteOn', note, velocity, sampleFrame });
        }
    };

    const noteOff = (note: number, sampleFrame?: number): void => {
        node.port.postMessage({ type: 'noteOff', note, sampleFrame });
    };

    // Silent all-notes-off used by the transport on stop. Avoids fanning
    // out 128 individual note-off messages, which would otherwise trigger
    // the per-noteOff realism release burst 128 times and produce the
    // "hi-hat ksshh" on every stop on bowed-string patches.
    const allNotesOff = (): void => {
        node.port.postMessage({ type: 'allNotesOff' });
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
        if (b) {
            // Release held voices at the source before muting the processor.
            // The worklet gates output while `_bypassed`, but the WASM voices
            // stay allocated and resume audibly on un-bypass unless released.
            // Order matters: allNotesOff must arrive before the bypass mute so
            // the release is processed before process() starts short-circuiting.
            node.port.postMessage({ type: 'allNotesOff' });
        }
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
        allNotesOff,
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
