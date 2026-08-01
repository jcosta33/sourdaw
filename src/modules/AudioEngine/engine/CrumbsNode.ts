/**
 * CrumbsNode — AudioWorkletNode wrapper for the Crumbs sampler/slicer engine.
 *
 * Creates and manages the WASM-powered worklet, forwarding note, parameter and
 * sample messages over the MessagePort. Follows `LevainNode`, which is the
 * other sample-fed instrument in this family.
 *
 * Crumbs' native host loads samples off disk; a worklet has no file API at all,
 * so PCM is transferred in over the port instead (`addSample`). See
 * `crumbsProcessor.ts` for why that is the right shape for rendering rather
 * than a degraded one.
 */

import { createReadyHandshake, ensureWorkletRegistered, fetchWasmModule } from '#/infra/audioWorklet/workletInitShared';
import { logger } from '#/infra/logger/appLogger';

import crumbsProcessorUrl from '../services/crumbsProcessor.ts?worker&url';

const DEFAULT_WASM_URL = '/wasm/daw-dsp/daw_dsp_bg.wasm';

export type CrumbsNodeResult = {
    workletNode: AudioWorkletNode;
    /**
     * `(note, velocity, sampleFrame?, channel?)` — the melodic slot order the
     * other pitched instruments publish, which is what both callers use:
     * `bindMelodicNotes` in the offline factory table, and `scheduleMidiNotes`
     * through `crumbsControls`. It is *not* Toaster's pad order
     * (`pad, velocity, midiNote?, sampleFrame?`); writing that here silently
     * fed `sampleFrame` into a slot Crumbs discards and the MPE channel into
     * `sampleFrame`, so every scheduled note lost its placement. All four slots
     * are `number`, so nothing but this signature holds the distinction.
     */
    noteOn: (note: number, velocity: number, sampleFrame?: number, channel?: number) => void;
    noteOff: (note: number, sampleFrame?: number) => void;
    allNotesOff: () => void;
    allSoundOff: () => void;
    setParam: (name: string, value: number) => void;
    setMode: (mode: string) => void;
    setBypass: (bypassed: boolean) => void;
    connect: (dest: AudioNode) => void;
    disconnect: () => void;
    destroy: () => void;
    ready: Promise<Record<string, unknown>>;
};

export function isCrumbsDevice(deviceType: string): boolean {
    // The catalog id carries the `builtin-` prefix (`CrumbsDescriptor`). It is
    // matched exactly rather than by prefix, so the offline registry's
    // `builtin-` WebAudio arm keeps every other `builtin-*` id.
    return deviceType === 'builtin-crumbs';
}

/**
 * Create a Crumbs AudioWorkletNode.
 *
 * Resumes the AudioContext if suspended. Caches the compiled WASM module across calls.
 * Await `result.ready` before sending notes.
 *
 * `onFault` is invoked if the worklet posts a runtime-fault `error` message
 * after the ready handshake has settled (a WASM panic mid-playback). The
 * processor goes silent while the node stays alive, so callers use it to
 * reflect the fault into UI state.
 */
export async function createCrumbsNode(
    ctx: BaseAudioContext,
    wasmUrl?: string,
    onFault?: (message: string) => void
): Promise<CrumbsNodeResult> {
    if (ctx instanceof AudioContext && ctx.state === 'suspended') {
        await ctx.resume();
    }

    await ensureWorkletRegistered(ctx, crumbsProcessorUrl);
    const wasmModule = await fetchWasmModule({ ctx, bundleId: 'daw-dsp', url: wasmUrl ?? DEFAULT_WASM_URL });

    const node = new AudioWorkletNode(ctx, 'crumbs-processor', {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        channelCount: 2,
        channelCountMode: 'explicit',
        processorOptions: { wasmModule },
    });

    let bypassed = false;

    const handshake = createReadyHandshake({ pluginName: 'CrumbsNode' });
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
            logger.warn('CrumbsNode runtime fault (WASM panic — processor faulted):', message);
            onFault?.(message);
        }
    };
    const readyPromise = handshake.promise;

    node.port.postMessage({ type: 'init' });

    // Sample loading is driven by the Crumbs module (live registration, or
    // `prepareOfflineCrumbs` for a render). Nothing is loaded eagerly here:
    // which sample a device plays is project state, not a node default.

    // `channel` is accepted and dropped: `CrumbsEngine` allocates and releases
    // voices by pitch and has no MPE member-channel concept, which is also why
    // Crumbs is absent from `NOTE_EXPRESSION_DEVICES`. Taking the parameter
    // keeps the melodic slot order intact for callers that pass it.
    const noteOn = (note: number, velocity: number, sampleFrame?: number, _channel?: number): void => {
        if (!bypassed) {
            node.port.postMessage({ type: 'noteOn', note, velocity, sampleFrame });
        }
    };

    const noteOff = (note: number, sampleFrame?: number): void => {
        node.port.postMessage({ type: 'noteOff', note, sampleFrame });
    };

    const allNotesOff = (): void => {
        node.port.postMessage({ type: 'allNotesOff' });
    };

    const allSoundOff = (): void => {
        node.port.postMessage({ type: 'allSoundOff' });
    };

    const setParam = (name: string, value: number): void => {
        if (!Number.isFinite(value)) {
            return;
        }
        node.port.postMessage({ type: 'param', name, value });
    };

    const setMode = (mode: string): void => {
        node.port.postMessage({ type: 'mode', mode });
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
        allNotesOff,
        allSoundOff,
        setParam,
        setMode,
        setBypass,
        connect,
        disconnect,
        destroy,
        ready: readyPromise,
    };
}
