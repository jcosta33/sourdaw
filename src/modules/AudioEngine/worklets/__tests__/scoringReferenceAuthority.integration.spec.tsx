import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockAudioContext } from '#/helpers/__tests__/audioContext.mock';
import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';

import type { ScoringNodeResult, TunerTelemetry } from '../../engine/ScoringNode';

// Only the asset-fetch seam is replaced. Both generated bindings and the
// production processor execute the committed Scoring binary below.
const wasmModule = new WebAssembly.Module(readFileSync(resolve(process.cwd(), 'public/wasm/scoring/scoring_bg.wasm')));
vi.mock('#/infra/audioWorklet/workletInitShared', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/infra/audioWorklet/workletInitShared')>()),
    fetchWasmModule: async () => ({ module: wasmModule, commit: () => {}, release: () => {} }),
}));

const SAMPLE_RATE = 48_000;
const FRAMES = 128;
const TONE_HZ = 446;
const TRACK_ID = 'reference-track';
const DEVICE_ID = 'reference-scoring';
const INITIAL_REFERENCE = 440;

type Processor = {
    process: (inputs: Float32Array[][], outputs: Float32Array[][]) => boolean;
};

/** Synchronous message delivery models transport only, never the DSP result. */
class LocalPort {
    onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
    peer: LocalPort | null = null;

    postMessage(data: unknown): void {
        this.peer?.onmessage?.(new MessageEvent('message', { data }));
    }

    close(): void {
        this.onmessage = null;
    }
}

const processors = new Map<string, new (...args: unknown[]) => Processor>();
let constructingPort: LocalPort | null = null;

class ProcessorScope {
    readonly port: LocalPort;

    constructor() {
        if (!constructingPort) {
            throw new Error('Scoring processor constructed outside its platform host');
        }
        this.port = constructingPort;
    }
}

class WorkletHost {
    readonly port = new LocalPort();
    readonly processor: Processor;

    constructor(_context: BaseAudioContext, name: string, options: AudioWorkletNodeOptions) {
        const ProcessorClass = processors.get(name);
        if (!ProcessorClass) {
            throw new Error(`Unregistered processor: ${name}`);
        }
        const inner = new LocalPort();
        this.port.peer = inner;
        inner.peer = this.port;
        constructingPort = inner;
        try {
            this.processor = new ProcessorClass(options);
        } finally {
            constructingPort = null;
        }
        workletHosts.push(this);
    }

    connect(): void {}
    disconnect(): void {}
}

const workletHosts: WorkletHost[] = [];
const animationFrames = new Map<number, FrameRequestCallback>();
let nextAnimationFrame = 0;
const pointerDescriptors = new Map(
    ['setPointerCapture', 'releasePointerCapture'].map((name) => [
        name,
        Object.getOwnPropertyDescriptor(Element.prototype, name),
    ])
);

function pollTelemetry(): void {
    const pending = [...animationFrames.values()];
    animationFrames.clear();
    for (const callback of pending) {
        callback(0);
    }
}

async function importRuntime() {
    // Establish one production composition graph before importing its barrels.
    // Concurrent imports of this cyclic graph can deadlock Vitest's module runner.
    await import('#/app/registerProjectLifecycle');
    const projections = await import('#/app/registerProjectSlotProjections');
    const arrangement = await import('#/modules/Arrangement/useCases');
    const arrangementStores = await import('#/modules/Arrangement/stores');
    const command = await import('#/modules/Command/useCases');
    const commandStores = await import('#/modules/Command/stores');
    const crdt = await import('#/modules/CrdtDocument/useCases');
    const tuner = await import('#/modules/Tuner/presentations/views');
    const tunerStores = await import('#/modules/Tuner/stores');
    const audio = await import('../../useCases');
    const engine = await import('../../repositories/createWebAudioEngine');
    const scoring = await import('../../engine/ScoringNode');
    return {
        projections,
        arrangement,
        arrangementStores,
        command,
        commandStores,
        crdt,
        tuner,
        tunerStores,
        audio,
        engine,
        scoring,
    };
}

let runtime: Awaited<ReturnType<typeof importRuntime>>;
let scoringNode: ScoringNodeResult | undefined;
let latestTelemetry: TunerTelemetry | undefined;
let frame = 0;
let setupComplete = false;
let unsubscribeHistory: (() => void) | undefined;

function rawReference(): number | undefined {
    const root = runtime.crdt.getCrdtDoc<{
        tracks?: {
            tracks: Array<{ id: string; devices: Array<{ id: string; parameterValues: Record<string, number> }> }>;
        };
    }>('root');
    return root?.tracks?.tracks
        .find((track) => track.id === TRACK_ID)
        ?.devices.find((device) => device.id === DEVICE_ID)?.parameterValues.a4_hz;
}

function projectedReference(): number | undefined {
    return runtime.arrangementStores.trackStore.value?.tracks
        .find((track) => track.id === TRACK_ID)
        ?.devices.find((device) => device.id === DEVICE_ID)?.parameterValues.a4_hz;
}

function undoDepth(): number {
    return runtime.commandStores.undoStore.value?.past.length ?? 0;
}

function durableHistoryDepth(): number {
    return (
        runtime.crdt.getCrdtDoc<{ actionHistory?: { entries: unknown[] } }>('root')?.actionHistory?.entries.length ?? 0
    );
}

function expectedPitch(reference: number): { midi: number; cents: number } {
    const semitones = 12 * Math.log2(TONE_HZ / reference);
    const midi = Math.round(69 + semitones);
    return { midi, cents: semitones * 100 - (midi - 69) * 100 };
}

/**
 * Pump known PCM straight through the real processor, not through a model of
 * Web Audio's graph. Stop on the actual published detection, with a two-second
 * sample budget matching the real-Rust reference oracle.
 */
function detect(reference: number): TunerTelemetry {
    const host = workletHosts.at(-1);
    if (!host) {
        throw new Error('The production ScoringNode did not construct its processor');
    }
    const expected = expectedPitch(reference);
    const input = [new Float32Array(FRAMES), new Float32Array(FRAMES)];
    const output = [new Float32Array(FRAMES), new Float32Array(FRAMES)];
    let inputEnergy = 0;
    for (let quantum = 0; quantum < Math.ceil((2 * SAMPLE_RATE) / FRAMES); quantum++) {
        for (let index = 0; index < FRAMES; index++) {
            const value = 0.4 * Math.sin((2 * Math.PI * TONE_HZ * (frame + index)) / SAMPLE_RATE);
            input[0]![index] = value;
            input[1]![index] = value * 0.5;
            inputEnergy += value * value;
        }
        vi.stubGlobal('currentFrame', frame);
        expect(host.processor.process([input], [output])).toBe(true);
        frame += FRAMES;
        pollTelemetry();
        const reading = latestTelemetry;
        if (reading?.active && reading.midiNote === expected.midi && Math.abs(reading.cents - expected.cents) < 4) {
            expect(inputEnergy).toBeGreaterThan(0);
            expect(Number.isFinite(reading.frequency)).toBe(true);
            expect(Math.abs(reading.frequency - TONE_HZ)).toBeLessThan(2);
            expect(reading.confidence).toBeGreaterThan(0);
            expect(output[0]).toEqual(input[0]);
            expect(output[1]).toEqual(input[1]);
            return reading;
        }
    }
    throw new Error(
        `Scoring failed to detect ${TONE_HZ} Hz at reference ${reference}: ${JSON.stringify(latestTelemetry)}`
    );
}

beforeAll(async () => {
    // This context supplies construction APIs only; no sample is rendered by it.
    vi.stubGlobal('AudioContext', function ConstructionContext() {
        return createMockAudioContext();
    });
    vi.stubGlobal('AudioWorkletNode', WorkletHost);
    vi.stubGlobal('AudioWorkletProcessor', ProcessorScope);
    vi.stubGlobal('registerProcessor', (name: string, processor: new (...args: unknown[]) => Processor) => {
        processors.set(name, processor);
    });
    vi.stubGlobal('sampleRate', SAMPLE_RATE);
    vi.stubGlobal('currentFrame', 0);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
        const id = ++nextAnimationFrame;
        animationFrames.set(id, callback);
        return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
        animationFrames.delete(id);
    });
    Element.prototype.setPointerCapture = () => {};
    Element.prototype.releasePointerCapture = () => {};
    runtime = await importRuntime();
    await import('../meteringProcessor');
    await import('../scoringProcessor');
    runtime.projections.registerProjectSlotProjections();
    runtime.audio.initEngineDeviceCollaborators();
    setupComplete = true;
}, 30_000);

beforeEach(async () => {
    latestTelemetry = undefined;
    frame = 0;
    workletHosts.length = 0;
    animationFrames.clear();
    configureAutomergeStoragePort(null);
    runtime.crdt.resetCrdtProjectAuthority('Scoring reference authority integration');
    runtime.crdt.removeCrdtDoc('root');
    runtime.crdt.createCrdtDoc('root');
    runtime.crdt.registerCrdtStorageRuntime();
    runtime.commandStores.clearHandlerRegistry();
    runtime.commandStores.registerHandlerMap(runtime.arrangement.getArrangementHandlers());
    runtime.command.resetActionReplayAuthority();
    // Same metadata writer and published-history consumer as bootstrap.ts.
    runtime.command.setActionHistoryMetadataPort({
        record: runtime.crdt.recordActionHistoryEntry,
        recordBatch: runtime.crdt.recordActionHistoryEntries,
        markReverted: runtime.crdt.markActionHistoryEntryReverted,
        clear: runtime.crdt.clearActionHistory,
    });
    runtime.crdt.clearActionHistory();
    unsubscribeHistory = runtime.crdt.subscribeToPublishedActionHistory({
        onHistory: runtime.command.syncActionReplayMetadata,
        onRootReplaced: runtime.command.resetActionReplayAuthority,
    });
    runtime.arrangement.setArrangementEventBus({ emit: () => Promise.resolve() });
    // Initial document fixture only; the measured edits below all enter through
    // the mounted panel and production Command handler, including their replay.
    runtime.arrangementStores.trackStore.set({
        ...runtime.arrangementStores.defaultTrackState,
        tracks: runtime.arrangementStores.sanitizeTrackSnapshot({
            tracks: [
                {
                    id: TRACK_ID,
                    name: 'Reference input',
                    kind: 'audio',
                    devices: [
                        {
                            id: DEVICE_ID,
                            name: 'Scoring',
                            type: 'native-scoring',
                            bypassed: false,
                            parameterValues: { a4_hz: INITIAL_REFERENCE },
                        },
                    ],
                },
            ],
        }).tracks,
    });
    runtime.command.clearUndoHistory();

    // Register the production controller on the real engine's actual strip.
    // The construction shim provides no fallback controller or canned telemetry.
    const strip = runtime.engine.audioEngine.ensureTrackStrip(TRACK_ID);
    const context = runtime.engine.audioEngine.context;
    scoringNode = await runtime.scoring.createScoringNode(context);
    await scoringNode.ready;
    scoringNode.onTelemetry((reading) => {
        latestTelemetry = reading;
        runtime.tunerStores.updateTunerTelemetry(DEVICE_ID, reading);
    });
    strip.deviceNodes.push({
        deviceId: DEVICE_ID,
        type: 'native-scoring',
        nodes: [scoringNode.workletNode],
        inputNode: scoringNode.workletNode,
        outputNode: scoringNode.workletNode,
        controller: { setParam: scoringNode.setParam, setBypass: scoringNode.setBypass, destroy: scoringNode.destroy },
    });
});

afterEach(async () => {
    if (!setupComplete) {
        return;
    }
    cleanup();
    unsubscribeHistory?.();
    unsubscribeHistory = undefined;
    scoringNode?.destroy();
    scoringNode = undefined;
    runtime.engine.audioEngine.removeTrackStrip(TRACK_ID);
    runtime.command.clearUndoHistory();
    runtime.command.resetActionReplayAuthority();
    runtime.commandStores.clearHandlerRegistry();
    runtime.crdt.removeCrdtDoc('root');
    configureAutomergeStoragePort(null);
});

afterAll(async () => {
    try {
        if (setupComplete) {
            await runtime.engine.audioEngine.dispose();
        }
    } finally {
        for (const [name, descriptor] of pointerDescriptors) {
            if (descriptor) {
                Object.defineProperty(Element.prototype, name, descriptor);
            } else {
                Reflect.deleteProperty(Element.prototype, name);
            }
        }
        vi.unstubAllGlobals();
    }
});

describe('Scoring reference gesture authority and shipped DSP', () => {
    // This proves parameter/authority/DSP composition, not browser graph
    // rendering, actual worklet concurrency, or physical audio hardware.
    it.each([446, 415])(
        'restores reference %i across preview, commit, undo and redo in project truth, the panel and real pitch detection',
        async (reference) => {
            const { TunerPanel } = runtime.tuner;
            render(<TunerPanel deviceId={DEVICE_ID} />);
            const slider = screen.getByRole('slider', { name: 'Parameter control' });
            expect(slider).toHaveAttribute('aria-valuenow', String(INITIAL_REFERENCE));
            act(() => {
                detect(INITIAL_REFERENCE);
            });
            expect(rawReference()).toBe(INITIAL_REFERENCE);
            expect(projectedReference()).toBe(INITIAL_REFERENCE);
            const before = undoDepth();
            const durableBefore = durableHistoryDepth();

            // RotaryKnob spans its 90 Hz range over 150 px. More than one
            // distinct preview makes a per-pointer-sample history bug observable.
            const startY = 200;
            const endY = startY - ((reference - INITIAL_REFERENCE) / 90) * 150;
            fireEvent.pointerDown(slider, { pointerId: 1, button: 0, clientY: startY });
            fireEvent.pointerMove(slider, { pointerId: 1, clientY: (startY + endY) / 2 });
            fireEvent.pointerMove(slider, { pointerId: 1, clientY: endY });
            expect(slider).toHaveAttribute('aria-valuenow', String(reference));
            expect(rawReference()).toBe(INITIAL_REFERENCE);
            expect(projectedReference()).toBe(INITIAL_REFERENCE);
            expect(undoDepth()).toBe(before);
            expect(durableHistoryDepth()).toBe(durableBefore);
            act(() => {
                detect(reference);
            });

            fireEvent.pointerUp(slider, { pointerId: 1, clientY: endY });
            await waitFor(() => {
                expect(rawReference()).toBe(reference);
                expect(projectedReference()).toBe(reference);
                expect(undoDepth()).toBe(before + 1);
                expect(durableHistoryDepth()).toBe(durableBefore + 1);
            });
            expect(slider).toHaveAttribute('aria-valuenow', String(reference));
            act(() => {
                detect(reference);
            });

            await act(async () => {
                await runtime.command.undo();
            });
            expect(rawReference()).toBe(INITIAL_REFERENCE);
            expect(projectedReference()).toBe(INITIAL_REFERENCE);
            expect(slider).toHaveAttribute('aria-valuenow', String(INITIAL_REFERENCE));
            expect(undoDepth()).toBe(before);
            act(() => {
                detect(INITIAL_REFERENCE);
            });

            await act(async () => {
                await runtime.command.redo();
            });
            expect(rawReference()).toBe(reference);
            expect(projectedReference()).toBe(reference);
            expect(slider).toHaveAttribute('aria-valuenow', String(reference));
            expect(undoDepth()).toBe(before + 1);
            act(() => {
                detect(reference);
            });
        }
    );
});
