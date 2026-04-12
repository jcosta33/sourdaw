/**
 * ScoringNode — AudioWorkletNode wrapper for the Scoring chromatic tuner.
 * Audio effect: input passes through, pitch analysis runs in WASM,
 * telemetry sent back via MessagePort.
 */

import scoringProcessorUrl from '../services/scoringProcessor.ts?worker&url';
import { telemetryAllocator, SCORING_IDX, type TelemetrySlot } from './telemetryAllocator';
import { NOTE_NAMES } from '#/utils/noteNames';

const DEFAULT_WASM_URL = '/wasm/scoring/scoring_bg.wasm';

const workletRegistrations = new WeakMap<BaseAudioContext, Promise<void>>();
let cachedWasmBytes: ArrayBuffer | null = null;

async function ensureWorkletRegistered(ctx: BaseAudioContext): Promise<void> {
    let promise = workletRegistrations.get(ctx);
    if (!promise) {
        promise = ctx.audioWorklet.addModule(scoringProcessorUrl);
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
        throw new Error(`Failed to fetch Scoring WASM: ${response.status}`);
    }
    cachedWasmBytes = await response.arrayBuffer();
    return cachedWasmBytes;
}

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

export type ScoringNodeResult = {
    workletNode: AudioWorkletNode;
    setParam: (name: string, value: number) => void;
    setBypass: (bypassed: boolean) => void;
    onTelemetry: (callback: (data: TunerTelemetry) => void) => void;
    connect: (dest: AudioNode) => void;
    disconnect: () => void;
    destroy: () => void;
    ready: Promise<void>;
};

export function isScoringDevice(deviceType: string): boolean {
    return deviceType === 'native-scoring';
}

export async function createScoringNode(ctx: BaseAudioContext): Promise<ScoringNodeResult> {
    if (ctx instanceof AudioContext && ctx.state === 'suspended') {
        await ctx.resume();
    }

    await ensureWorkletRegistered(ctx);

    const node = new AudioWorkletNode(ctx, 'scoring-processor', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        channelCount: 2,
        channelCountMode: 'explicit',
    });

    let settled = false;
    let slot: TelemetrySlot | null = telemetryAllocator.allocateSlot();
    let telemetryRafId: number | null = null;

    if (slot) {
        node.port.postMessage({ type: 'init-sab', sab: slot.sab, byteOffset: slot.byteOffset });
    }

    const readyPromise = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
            if (!settled) {
                settled = true;
                reject(new Error('ScoringNode init timeout'));
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
        };
    });

    const wasmBytes = await fetchWasmBinary(DEFAULT_WASM_URL);
    const copy = wasmBytes.slice(0);
    node.port.postMessage({ type: 'init', wasmBytes: copy }, [copy]);

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
            if (telemetryRafId !== null) {
                cancelAnimationFrame(telemetryRafId);
                telemetryRafId = null;
            }
            if (!slot) {return;}
            const view = slot.view;
            const poll = () => {
                const active = view[SCORING_IDX.active] !== 0;
                if (active) {
                    const noteIndex = view[SCORING_IDX.noteIndex] ?? 0;
                    callback({
                        active: true,
                        frequency: view[SCORING_IDX.frequency] ?? 0,
                        cents: view[SCORING_IDX.cents] ?? 0,
                        confidence: view[SCORING_IDX.confidence] ?? 0,
                        noteIndex,
                        octave: view[SCORING_IDX.octave] ?? 0,
                        midiNote: view[SCORING_IDX.midiNote] ?? 0,
                        noteName: NOTE_NAMES[noteIndex % 12] ?? 'C',
                    });
                } else {
                    callback({
                        active: false,
                        frequency: 0,
                        cents: 0,
                        confidence: 0,
                        noteIndex: 0,
                        octave: 0,
                        midiNote: 0,
                        noteName: '',
                    });
                }
                telemetryRafId = requestAnimationFrame(poll);
            };
            telemetryRafId = requestAnimationFrame(poll);
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
            if (telemetryRafId !== null) {
                cancelAnimationFrame(telemetryRafId);
                telemetryRafId = null;
            }
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
