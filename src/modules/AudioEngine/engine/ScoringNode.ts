/**
 * ScoringNode — AudioWorkletNode wrapper for the Scoring chromatic tuner.
 * Audio effect: input passes through, pitch analysis runs in WASM,
 * telemetry sent back via MessagePort.
 */

import { raceAbortSignal } from '#/infra/audioWorklet/raceAbortSignal';
import { createReadyHandshake, ensureWorkletRegistered, fetchWasmModule } from '#/infra/audioWorklet/workletInitShared';
import { NOTE_NAMES } from '#/utils/noteNames';

import scoringProcessorUrl from '../services/scoringProcessor.ts?worker&url';

import { requireSharedArrayBuffer } from './pluginHostingErrors';
import { telemetryAllocator, createTelemetryReader, SCORING_IDX, type TelemetrySlot } from './telemetryAllocator';

const DEFAULT_WASM_URL = '/wasm/scoring/scoring_bg.wasm';

export type TunerTelemetry = {
    frequency: number;
    cents: number;
    confidence: number;
    noteIndex: number;
    octave: number;
    midiNote: number;
    noteName: string;
    active: boolean;
};

const INACTIVE_TUNER_TELEMETRY: TunerTelemetry = {
    active: false,
    frequency: 0,
    cents: 0,
    confidence: 0,
    noteIndex: 0,
    octave: 0,
    midiNote: 0,
    noteName: '',
};

/** Slot floats → tuner telemetry. Pure: the seqlock reader may re-run it on retry. */
function projectTunerTelemetry(view: Float32Array): TunerTelemetry {
    if (view[SCORING_IDX.active] === 0) {
        return INACTIVE_TUNER_TELEMETRY;
    }
    const noteIndex = view[SCORING_IDX.noteIndex] ?? 0;
    return {
        active: true,
        frequency: view[SCORING_IDX.frequency] ?? 0,
        cents: view[SCORING_IDX.cents] ?? 0,
        confidence: view[SCORING_IDX.confidence] ?? 0,
        noteIndex,
        octave: view[SCORING_IDX.octave] ?? 0,
        midiNote: view[SCORING_IDX.midiNote] ?? 0,
        noteName: NOTE_NAMES[noteIndex % 12] ?? 'C',
    };
}

export type ScoringNodeResult = {
    workletNode: AudioWorkletNode;
    setParam: (name: string, value: number) => void;
    setBypass: (bypassed: boolean) => void;
    onTelemetry: (callback: (data: TunerTelemetry) => void) => void;
    pollTelemetry: () => void;
    connect: (dest: AudioNode) => void;
    disconnect: () => void;
    destroy: () => void;
    ready: Promise<Record<string, unknown>>;
};

export function isScoringDevice(deviceType: string): boolean {
    return deviceType === 'native-scoring';
}

export async function createScoringNode(ctx: BaseAudioContext, signal?: AbortSignal): Promise<ScoringNodeResult> {
    // Scoring's tuner telemetry (frequency, cents, confidence) is SAB-backed.
    requireSharedArrayBuffer('Scoring');

    if (ctx instanceof AudioContext && ctx.state === 'suspended') {
        await raceAbortSignal(ctx.resume(), signal);
    }

    await raceAbortSignal(ensureWorkletRegistered(ctx, scoringProcessorUrl), signal);
    const wasmModule = await raceAbortSignal(fetchWasmModule(DEFAULT_WASM_URL), signal);

    signal?.throwIfAborted();

    const node = new AudioWorkletNode(ctx, 'scoring-processor', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        channelCount: 2,
        channelCountMode: 'explicit',
        processorOptions: { wasmModule },
    });

    let slot: TelemetrySlot | null = telemetryAllocator.allocateSlot();
    let telemetryCallback: ((data: TunerTelemetry) => void) | null = null;

    if (slot) {
        node.port.postMessage({ type: 'init-sab', sab: slot.sab, byteOffset: slot.byteOffset });
    }
    const readTelemetry = slot ? createTelemetryReader({ slot, project: projectTunerTelemetry }) : null;

    const handshake = createReadyHandshake({ pluginName: 'ScoringNode' });
    node.port.onmessage = (event: MessageEvent) => {
        handshake.onMessage(event);
    };
    const readyPromise = handshake.promise;

    node.port.postMessage({ type: 'init' });

    return {
        workletNode: node,
        setParam: (name, value) => {
            if (Number.isFinite(value)) {
                node.port.postMessage({ type: 'param', name, value });
            }
        },
        setBypass: (bypassed) => {
            node.port.postMessage({ type: 'bypass', bypassed });
        },
        onTelemetry: (callback) => {
            if (!slot || !readTelemetry) {
                return;
            }
            telemetryCallback = callback;
        },
        pollTelemetry: () => {
            if (!slot || !readTelemetry || !telemetryCallback) {
                return;
            }
            // Active and pitch fields are delivered from one settled seqlock
            // generation so the UI cannot combine different detections.
            telemetryCallback(readTelemetry());
        },
        connect: (dest) => node.connect(dest),
        disconnect: () => {
            try {
                node.disconnect();
            } catch {
                /* */
            }
        },
        destroy: () => {
            telemetryCallback = null;
            if (slot) {
                telemetryAllocator.releaseSlot(slot.byteOffset);
                slot = null;
            }
            try {
                node.disconnect();
            } catch {
                /* */
            }
            node.port.close();
        },
        ready: readyPromise,
    };
}
