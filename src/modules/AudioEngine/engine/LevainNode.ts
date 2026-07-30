/**
 * LevainNode — AudioWorkletNode wrapper for the Levain suite engine.
 *
 * Creates and manages the WASM-powered worklet. Provides noteOn/noteOff/setParam/handleCc
 * methods that forward via MessagePort. Caches the compiled WASM module and worklet registration.
 * Follows the same pattern as FermenterNode.
 */

import { raceAbortSignal } from '#/infra/audioWorklet/raceAbortSignal';
import { createReadyHandshake, ensureWorkletRegistered, fetchWasmModule } from '#/infra/audioWorklet/workletInitShared';
import { logger } from '#/infra/logger/appLogger';

import levainProcessorUrl from '../services/levainProcessor.ts?worker&url';

import {
    createTelemetryReader,
    LEVAIN_IDX,
    telemetryAllocator,
    TELEMETRY_SEQ_IDX,
    type TelemetrySlot,
} from './telemetryAllocator';

const DEFAULT_WASM_URL = '/wasm/daw-dsp/daw_dsp_bg.wasm';

type LevainProcessorLifecycle = 'continue' | 'continueIfNotQuiet' | 'tail' | 'sleep';

function projectLevainLifecycle(view: Float32Array): LevainProcessorLifecycle | null {
    switch (view[LEVAIN_IDX.lifecycle]) {
        case 0:
            return 'continue';
        case 1:
            return 'continueIfNotQuiet';
        case 2:
            return 'tail';
        case 3:
            return 'sleep';
        case undefined:
            return null;
        default:
            return null;
    }
}

export type LevainNodeResult = {
    workletNode: AudioWorkletNode;
    noteOn: (note: number, velocity: number, sampleFrame?: number, channel?: number) => void;
    noteOff: (note: number, sampleFrame?: number, channel?: number) => void;
    noteExpression: (
        note: number,
        channel: number,
        bendSemitones: number,
        pressure: number,
        slide: number,
        sampleFrame?: number
    ) => void;
    allNotesOff: () => void;
    setParam: (name: string, value: number) => void;
    handleCc: (cc: number, value: number) => void;
    setInstrument: (instrumentId: string) => void;
    setBypass: (bypassed: boolean) => void;
    processorLifecycle: () => LevainProcessorLifecycle | null;
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
 * Resumes the AudioContext if suspended. Caches the compiled WASM module across calls.
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
    onFault?: (message: string) => void,
    signal?: AbortSignal
): Promise<LevainNodeResult> {
    if (ctx instanceof AudioContext && ctx.state === 'suspended') {
        await raceAbortSignal(ctx.resume(), signal);
    }

    await raceAbortSignal(ensureWorkletRegistered(ctx, levainProcessorUrl), signal);
    const wasmModule = await raceAbortSignal(fetchWasmModule(wasmUrl ?? DEFAULT_WASM_URL), signal);

    signal?.throwIfAborted();

    const node = new AudioWorkletNode(ctx, 'levain-processor', {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        channelCount: 2,
        channelCountMode: 'explicit',
        processorOptions: { wasmModule },
    });

    let bypassed = false;
    let slot: TelemetrySlot | null =
        typeof SharedArrayBuffer === 'undefined' ? null : telemetryAllocator.allocateSlot();
    if (slot) {
        node.port.postMessage({ type: 'init-sab', sab: slot.sab, byteOffset: slot.byteOffset });
    }
    const lifecycleReader = slot ? createTelemetryReader({ slot, project: projectLevainLifecycle }) : null;
    let lastLifecycle: LevainProcessorLifecycle | null = null;
    let destroyRequested = false;
    let runtimeFaulted = false;

    const handshake = createReadyHandshake({ pluginName: 'LevainNode' });
    node.port.onmessage = (event: MessageEvent<unknown>) => {
        if (event.data && typeof event.data === 'object' && 'type' in event.data && event.data.type === 'disposed') {
            if (slot) {
                telemetryAllocator.releaseSlot(slot.byteOffset);
                slot = null;
            }
            node.port.close();
            return;
        }
        const outcome = handshake.onMessage(event);
        if (
            outcome === 'late' &&
            event.data &&
            typeof event.data === 'object' &&
            'type' in event.data &&
            event.data.type === 'error'
        ) {
            const message = 'message' in event.data ? String(event.data.message) : 'Unknown error';
            runtimeFaulted = true;
            logger.warn('LevainNode runtime fault (WASM panic — processor faulted):', message);
            onFault?.(message);
        }
    };
    const readyPromise = handshake.promise;

    // Initialize the processor with the binary acquired before node allocation.
    node.port.postMessage({ type: 'init' });

    // Sample loading is driven by `registerLevainDevice` → `loadSamplesForInstrument`,
    // which reads the active patch's `instrumentId`. Do NOT eagerly load a default
    // instrument here — doing so races the patch-driven load and wastes bandwidth
    // on samples the user did not ask for.

    const noteOn = (note: number, velocity: number, sampleFrame?: number, channel?: number): void => {
        if (!bypassed) {
            node.port.postMessage({ type: 'noteOn', note, velocity, sampleFrame, channel });
        }
    };

    // `channel` narrows the release to one MPE member channel; omit it and
    // every voice at that pitch is released, as before.
    const noteOff = (note: number, sampleFrame?: number, channel?: number): void => {
        node.port.postMessage({ type: 'noteOff', note, sampleFrame, channel });
    };

    // MPE per-note expression (audit MD-2). Bypass gates new notes but not
    // expression on voices already sounding, matching noteOff.
    const noteExpression = (
        note: number,
        channel: number,
        bendSemitones: number,
        pressure: number,
        slide: number,
        sampleFrame?: number
    ): void => {
        if (note < 0 || note > 127) {
            return;
        }
        if (!Number.isFinite(bendSemitones) || !Number.isFinite(pressure) || !Number.isFinite(slide)) {
            return;
        }
        node.port.postMessage({
            type: 'noteExpression',
            note,
            channel,
            bendSemitones,
            pressure,
            slide,
            sampleFrame,
        });
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
        // TrackNode removes the generator from the audible graph and sends
        // allNotesOff on bypass entry. The disconnected generator will no
        // longer be pulled, so hard-stop its sounding state before that graph
        // change to prevent a frozen release from resuming on un-bypass.
        bypassed = b;
        if (b) {
            node.port.postMessage({ type: 'allSoundsOff' });
        }
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
        if (destroyRequested) {
            return;
        }
        destroyRequested = true;
        disconnect();
        node.port.postMessage({ type: 'dispose' });
    };

    return {
        workletNode: node,
        noteOn,
        noteOff,
        noteExpression,
        allNotesOff,
        setParam,
        handleCc,
        setInstrument,
        setBypass,
        processorLifecycle() {
            if (destroyRequested || runtimeFaulted || !slot || !lifecycleReader) {
                return null;
            }
            const before = Atomics.load(slot.seqView, TELEMETRY_SEQ_IDX);
            if (before === 0 || (before & 1) !== 0) {
                return lastLifecycle;
            }
            const lifecycle = lifecycleReader();
            const after = Atomics.load(slot.seqView, TELEMETRY_SEQ_IDX);
            if (before !== after || (after & 1) !== 0) {
                return lastLifecycle;
            }
            lastLifecycle = lifecycle;
            return lifecycle;
        },
        connect,
        disconnect,
        destroy,
        ready: readyPromise,
    };
}
