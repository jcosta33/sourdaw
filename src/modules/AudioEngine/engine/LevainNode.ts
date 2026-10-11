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

import { STEREO_CHANNEL_COUNT } from '../models/ChannelLaw';
import levainProcessorUrl from '../services/levainProcessor.ts?worker&url';

const DEFAULT_WASM_URL = '/wasm/daw-dsp/daw_dsp_bg.wasm';

export type LevainNodeResult = {
    workletNode: AudioWorkletNode;
    noteOn: (note: number, velocity: number, sampleFrame?: number, channel?: number, articulationId?: number) => void;
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
    /** `stored` marks a move stored clip playback posts, so `discardStoredCc` can drop it while it is queued. */
    handleCc: (cc: number, value: number, sampleFrame?: number, stored?: boolean) => void;
    /** Drop every queued controller move stored playback posted; a performer's queued moves stay. */
    discardStoredCc: () => void;
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
    const wasmLease = await raceAbortSignal(
        fetchWasmModule({ ctx, bundleId: 'daw-dsp', url: wasmUrl ?? DEFAULT_WASM_URL, signal }),
        signal
    );

    signal?.throwIfAborted();

    let node: AudioWorkletNode;
    try {
        node = new AudioWorkletNode(ctx, 'levain-processor', {
            numberOfInputs: 0,
            numberOfOutputs: 1,
            outputChannelCount: [STEREO_CHANNEL_COUNT],
            channelCount: STEREO_CHANNEL_COUNT,
            channelCountMode: 'explicit',
            processorOptions: { wasmModule: wasmLease.module },
        });
        wasmLease.commit();
    } catch (error) {
        wasmLease.release();
        throw error;
    }

    let bypassed = false;
    let destroyed = false;

    const handshake = createReadyHandshake({ pluginName: 'LevainNode' });
    let portClosed = false;
    let drainingDisposal = false;

    // A closed live AudioContext no longer answers port messages, so only it is
    // treated as gone. A completed OfflineAudioContext also reports 'closed' but
    // its worklet scope still answers (measured in Chromium), so it drains.
    // `instanceof` is the check because the closed state alone cannot tell them apart.
    const isContextGone = (): boolean =>
        ctx.state === 'closed' && !(typeof OfflineAudioContext !== 'undefined' && ctx instanceof OfflineAudioContext);

    // The port stays open from `destroy()` until the drain ends: on `done` (the
    // engine freed, or poisoned by a throwing step and deliberately left unfreed)
    // or when a live context closes and takes the worklet scope with it. A
    // disposed processor never posts `error` during the drain, so closing on one
    // is a defensive stop only.
    const closePort = (): void => {
        if (portClosed) {
            return;
        }
        portClosed = true;
        ctx.removeEventListener('statechange', handleContextStateChange);
        node.port.close();
    };
    function handleContextStateChange(): void {
        if (isContextGone()) {
            closePort();
        }
    }
    const requestDisposalRelease = (): void => {
        node.port.postMessage({ type: 'releaseDisposedBanks' });
    };

    node.port.onmessage = (event: MessageEvent<unknown>) => {
        const data: unknown = event.data;
        const type = data && typeof data === 'object' && 'type' in data ? data.type : undefined;
        if (type === 'disposed') {
            handshake.reject(new Error('LevainNode disposed before initialization completed'));
            if (!drainingDisposal) {
                drainingDisposal = true;
                requestDisposalRelease();
            }
            return;
        }
        if (drainingDisposal) {
            // One bounded step per message keeps each free a fraction of a render quantum.
            if (type === 'disposedBanksReleased' && data && typeof data === 'object' && 'done' in data) {
                if (data.done === true) {
                    closePort();
                } else {
                    requestDisposalRelease();
                }
            } else if (type === 'error') {
                closePort();
            }
            return;
        }
        const outcome = handshake.onMessage(event);
        if (outcome === 'late' && type === 'error') {
            const message =
                data && typeof data === 'object' && 'message' in data ? String(data.message) : 'Unknown error';
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

    const noteOn = (
        note: number,
        velocity: number,
        sampleFrame?: number,
        channel?: number,
        articulationId?: number
    ): void => {
        if (!bypassed) {
            node.port.postMessage({ type: 'noteOn', note, velocity, sampleFrame, channel, articulationId });
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

    const handleCc = (cc: number, value: number, sampleFrame?: number, stored?: boolean): void => {
        node.port.postMessage({ type: 'cc', cc, value, sampleFrame, stored });
    };

    const discardStoredCc = (): void => {
        node.port.postMessage({ type: 'discardStoredCc' });
    };

    const setBypass = (b: boolean): void => {
        // Mutes the processor (process() short-circuits while bypassed) and
        // gates new noteOn. Releasing voices already held on bypass entry is
        // owned by TrackNode.updateBypass via controller.allNotesOff (wired
        // above) — the worklet's message handler dispatches allNotesOff to the
        // WASM instance even while muted, so the release lands regardless of
        // arrival order.
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
        if (destroyed) {
            return;
        }
        destroyed = true;
        disconnect();
        ctx.addEventListener('statechange', handleContextStateChange);
        if (isContextGone()) {
            closePort();
            return;
        }
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
        discardStoredCc,
        setBypass,
        connect,
        disconnect,
        destroy,
        ready: readyPromise,
    };
}
