/**
 * FermenterNode — AudioWorkletNode wrapper for the Fermenter synthesizer.
 *
 * Creates and manages the WASM-powered worklet. Provides noteOn/noteOff/setParam
 * methods that forward via MessagePort. Caches WASM binary and worklet registration.
 *
 * Telemetry (peaks + oscilloscope) comes back through a SAB slot, not the port
 * (audit RT-3) — the worklet publishes under the shared seqlock and this node
 * polls it, so the render thread neither allocates nor sends a message.
 */

import { raceAbortSignal } from '#/infra/audioWorklet/raceAbortSignal';
import { createReadyHandshake, ensureWorkletRegistered, fetchWasmBinary } from '#/infra/audioWorklet/workletInitShared';

import fermenterProcessorUrl from '../services/fermenterProcessor.ts?worker&url';

import {
    createTelemetryReader,
    createWideTelemetrySlot,
    FERMENTER_IDX,
    FERMENTER_SCOPE_SAMPLES,
    FERMENTER_SLOT_FLOATS,
    TELEMETRY_SEQ_IDX,
    type TelemetrySlot,
} from './telemetryAllocator';

const DEFAULT_WASM_URL = '/wasm/daw-dsp/daw_dsp_bg.wasm';
export const FERMENTER_AUTOMATION_PARAM_IDS: Readonly<Record<string, number>> = {
    oscLevel: 0,
    filterCutoff: 1,
    filterResonance: 2,
    lfoRate: 3,
    lfoFilterAmount: 4,
    lfoPitchAmount: 5,
    filterEnvAmount: 6,
    msegToFilter: 7,
    unisonSpread: 8,
    fmLevel2: 9,
    fmFeedback: 10,
    noiseLevel: 11,
    grainDensity: 12,
    grainSize: 13,
    grainSpray: 14,
};

type OfflineAutomationSegment = {
    startFrame: number;
    endFrame: number;
    startValue: number;
    endValue: number;
};

export type FermenterTelemetryData = {
    peakL: number;
    peakR: number;
    scopeBuffer: Float32Array;
};

type FermenterProcessorLifecycle = 'continue' | 'continueIfNotQuiet' | 'tail' | 'sleep';

function projectFermenterLifecycle(view: Float32Array): FermenterProcessorLifecycle | null {
    switch (view[FERMENTER_IDX.lifecycle]) {
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

/**
 * Slot floats → telemetry snapshot. Pure, so the seqlock reader may re-run it on
 * retry. The waveform is copied out of shared memory into a fresh array rather
 * than handed out as a view: consumers keep the reference (the store holds it
 * until the next publish and selects on identity), and a live view would be
 * rewritten underneath them by the next render-thread publish.
 */
function projectFermenterTelemetry(view: Float32Array): FermenterTelemetryData {
    const scopeBuffer = new Float32Array(FERMENTER_SCOPE_SAMPLES);
    for (let index = 0; index < FERMENTER_SCOPE_SAMPLES; index++) {
        scopeBuffer[index] = view[FERMENTER_IDX.scopeBase + index] ?? 0;
    }
    return {
        peakL: view[FERMENTER_IDX.peakL] ?? 0,
        peakR: view[FERMENTER_IDX.peakR] ?? 0,
        scopeBuffer,
    };
}
export type FermenterNodeResult = {
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
    setParam: (name: string, value: number | number[], sampleFrame?: number) => void;
    acceptsScheduledParam?: (name: string) => boolean;
    scheduleParam?: (name: string, segments: readonly OfflineAutomationSegment[]) => void;
    setPatch: (patch: Record<string, unknown>) => void;
    setBypass: (bypassed: boolean) => void;
    onTelemetry: (callback: (data: FermenterTelemetryData) => void) => void;
    pollTelemetry: () => void;
    processorLifecycle: () => FermenterProcessorLifecycle | null;
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
export async function createFermenterNode(
    ctx: BaseAudioContext,
    wasmUrl?: string,
    signal?: AbortSignal
): Promise<FermenterNodeResult> {
    if (ctx instanceof AudioContext && ctx.state === 'suspended') {
        await raceAbortSignal(ctx.resume(), signal);
    }

    await raceAbortSignal(ensureWorkletRegistered(ctx, fermenterProcessorUrl), signal);
    const wasmBytes = await raceAbortSignal(fetchWasmBinary(wasmUrl ?? DEFAULT_WASM_URL), signal);

    signal?.throwIfAborted();

    const node = new AudioWorkletNode(ctx, 'fermenter-processor', {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        channelCount: 2,
        channelCountMode: 'explicit',
    });

    let bypassed = false;

    // Fermenter's scope waveform (128 floats) does not fit the pooled 32-float
    // telemetry slot, so it owns a wide one. Unlike Gluten/Scoring this is NOT a
    // hard requirement: without cross-origin isolation there is no SAB, the
    // worklet skips its publish, and the device still plays — only the scope and
    // peak meters stay flat. Failing the flagship instrument over a meter would
    // be a worse trade than the previous port-based path allowed.
    let slot: TelemetrySlot | null = createWideTelemetrySlot({
        floats: FERMENTER_SLOT_FLOATS,
        deviceName: 'Fermenter',
    });
    let telemetryCallback: ((data: FermenterTelemetryData) => void) | null = null;

    if (slot) {
        node.port.postMessage({ type: 'init-sab', sab: slot.sab, byteOffset: slot.byteOffset });
    }
    const readTelemetry = slot ? createTelemetryReader({ slot, project: projectFermenterTelemetry }) : null;
    let lastTelemetryGeneration = slot ? Atomics.load(slot.seqView, TELEMETRY_SEQ_IDX) : null;
    const lifecycleReader = slot ? createTelemetryReader({ slot, project: projectFermenterLifecycle }) : null;
    let lastLifecycle: FermenterProcessorLifecycle | null = null;

    const handshake = createReadyHandshake({ pluginName: 'FermenterNode' });
    node.port.onmessage = (event: MessageEvent) => {
        handshake.onMessage(event);
    };
    const readyPromise = handshake.promise;

    const copy = wasmBytes.slice(0);
    node.port.postMessage({ type: 'init', wasmBytes: copy }, [copy]);

    return {
        workletNode: node,
        noteOn(note: number, velocity: number, sampleFrame?: number, channel?: number) {
            if (!bypassed && note >= 0 && note < 128) {
                node.port.postMessage({
                    type: 'noteOn',
                    note,
                    velocity: Math.min(127, Math.max(0, velocity)),
                    sampleFrame,
                    channel,
                });
            }
        },
        // `channel` narrows the release to one MPE member channel; omit it
        // and every voice at that pitch is released, as before.
        noteOff(note: number, sampleFrame?: number, channel?: number) {
            node.port.postMessage({ type: 'noteOff', note, sampleFrame, channel });
        },
        noteExpression(
            note: number,
            channel: number,
            bendSemitones: number,
            pressure: number,
            slide: number,
            sampleFrame?: number
        ) {
            // MPE per-note expression (audit MD-2). Bypass gates new notes but
            // not expression on voices already sounding, matching noteOff.
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
        },
        allNotesOff() {
            // Single-message voice release the Fermenter worklet honors: drops
            // queued notes and releases all held voices. Called by the
            // transport-stop path and by TrackNode.updateBypass on bypass entry
            // (TrackNode owns bypass-entry release semantics).
            node.port.postMessage({ type: 'allNotesOff' });
        },
        setParam(name: string, value: number | number[], sampleFrame?: number) {
            if (Array.isArray(value) || Number.isFinite(value)) {
                node.port.postMessage({ type: 'param', name, value, sampleFrame });
            }
        },
        acceptsScheduledParam(name: string) {
            return Object.hasOwn(FERMENTER_AUTOMATION_PARAM_IDS, name);
        },
        scheduleParam(name: string, segments: readonly OfflineAutomationSegment[]) {
            const paramId = Object.hasOwn(FERMENTER_AUTOMATION_PARAM_IDS, name)
                ? FERMENTER_AUTOMATION_PARAM_IDS[name]
                : undefined;
            const valid =
                paramId !== undefined &&
                Number.isInteger(paramId) &&
                segments.length > 0 &&
                segments.every(
                    (segment) =>
                        Number.isInteger(segment.startFrame) &&
                        Number.isInteger(segment.endFrame) &&
                        segment.startFrame >= 0 &&
                        segment.endFrame >= segment.startFrame &&
                        Number.isFinite(segment.startValue) &&
                        Number.isFinite(segment.endValue)
                );
            if (valid) {
                node.port.postMessage({ type: 'paramAutomation', paramId, segments });
            }
        },
        setPatch(patch: Record<string, unknown>) {
            node.port.postMessage({ type: 'patch', patch });
        },
        setBypass(state: boolean) {
            // Only gates *new* noteOn. Releasing voices already held on bypass
            // entry is owned by TrackNode.updateBypass via controller.allNotesOff.
            bypassed = state;
        },
        onTelemetry(cb: (data: FermenterTelemetryData) => void) {
            if (!slot || !readTelemetry) {
                return;
            }
            telemetryCallback = cb;
            lastTelemetryGeneration = Atomics.load(slot.seqView, TELEMETRY_SEQ_IDX);
        },
        pollTelemetry() {
            if (!slot || !readTelemetry || !telemetryCallback || lastTelemetryGeneration === null) {
                return;
            }
            // Read under the slot seqlock (audit RT-2): peaks and the 128 waveform
            // samples are published as one block. Emit only when the generation
            // counter advances so downstream keeps one callback per publish.
            //
            // Only *settled* (even) generations advance the gate. A poll can land
            // mid-publish and sample the odd value; storing that would desync the
            // gate by one, so the same publish would emit twice — once on the odd
            // sample and again when the counter settles.
            const generation = Atomics.load(slot.seqView, TELEMETRY_SEQ_IDX);
            const settled = (generation & 1) === 0;
            if (!settled || generation === lastTelemetryGeneration) {
                return;
            }
            lastTelemetryGeneration = generation;
            telemetryCallback(readTelemetry());
        },
        processorLifecycle() {
            if (!slot || !lifecycleReader) {
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
            telemetryCallback = null;
            lastTelemetryGeneration = null;
            // A wide slot owns its SharedArrayBuffer outright and has no index in
            // the pooled allocator — dropping the reference is the whole release.
            slot = null;
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
