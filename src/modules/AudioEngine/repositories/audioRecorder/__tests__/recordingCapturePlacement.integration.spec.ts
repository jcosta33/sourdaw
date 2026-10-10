import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createEventBus } from '#/infra/events/createEventBus';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { activeRecordingRef, takeLaneStore, trackStore } from '#/modules/Arrangement/stores';
import { getArrangementHandlers, setArrangementEventBus } from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, registerHandlerMap, undoHistoryStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    executeAppAction,
    redo,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
    undo,
} from '#/modules/Command/useCases';
import {
    createCrdtDoc,
    getCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { playheadClockRef, playheadPositionRef, tempoMapStore, transportStore } from '#/modules/Transport/stores';
import {
    defaultTransportState,
    getTransportHandlers,
    getSchedulerTimingDiagnostics,
    setPlayback,
    stopPlayback,
    toggleRecording,
} from '#/modules/Transport/useCases';

import {
    readRecordingPublication,
    RECORDING_RING_CONTROL_BYTES,
    RECORDING_RING_CONTROL_INTS,
} from '../../../models/RecordingRingProtocol';
import { audioBufferCache } from '../../../stores/audioBufferCache';
import { audioRecordingStore } from '../../../stores/audioRecordingStore';
import { startAudioRecording } from '../recording';
import { activeSessions } from '../recordingSession';
import { stopAudioRecording } from '../stopAudioRecording';

type Processor = {
    port: { onmessage: ((event: { data: unknown }) => void) | null; postMessage: (message: unknown) => void };
    process(inputs: Float32Array[][]): boolean;
};
const hardware = vi.hoisted(() => ({
    now: 50,
    rollStarts: 0,
    rollGate: Promise.resolve(),
    buffer: null as AudioBuffer | null,
    schedulerWorker: null as {
        onmessage: ((event: { data: unknown }) => void) | null;
        generation: number;
        sequence: number;
    } | null,
}));
const context = {
    sampleRate: 48000,
    baseLatency: 0.1,
    outputLatency: 0,
    get currentTime() {
        return hardware.now;
    },
    createGain: () => ({ connect: vi.fn(), disconnect: vi.fn() }),
    createMediaStreamSource: () => ({ connect: vi.fn(), disconnect: vi.fn() }),
    decodeAudioData: () => {
        if (!hardware.buffer) {
            throw new Error('No processor PCM was flushed');
        }
        return Promise.resolve(hardware.buffer);
    },
};
vi.mock('../../createWebAudioEngine', () => ({
    audioEngine: {
        get context() {
            return context;
        },
        setTransportInfo: vi.fn(),
    },
}));
vi.mock('#/modules/AudioEngine/useCases', async (original) => {
    const real = await original<typeof import('#/modules/AudioEngine/useCases')>();
    return {
        ...real,
        getAudioContext: () => context,
        resumeEngine: () => Promise.resolve(),
        nativeLiveGraphSessionOffered: () => true,
        startNativeLiveGraphSession: async (): Promise<
            Awaited<ReturnType<typeof real.startNativeLiveGraphSession>>
        > => {
            hardware.rollStarts++;
            await hardware.rollGate;
            return { outcome: 'started', runtimeRevision: 1, reports: [] };
        },
        getCompensationDelay: () => 0,
        stopAllScheduled: vi.fn(),
        refreshSidechainAlignment: vi.fn(),
        scheduleAdjustmentLayers: vi.fn(),
        cancelTrackAutomationRamps: vi.fn(),
        stopNativeLiveGraphSession: () => Promise.resolve(),
        readNativeEnginePlayheadSeconds: () => null,
    };
});
vi.mock('#/modules/Arrangement/useCases', async (original) => {
    const real = await original<typeof import('#/modules/Arrangement/useCases')>();
    return {
        ...real,
        projectTrackToLiveStrip: (): ReturnType<typeof real.projectTrackToLiveStrip> => ({
            acceptance: 'accepted',
            application: 'applied',
            correlation: { appRevision: 0, projectRevision: 'recorder-placement-fixture' },
            runtimeRevision: 1,
        }),
    };
});
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: vi.fn() }));
vi.mock('#/modules/Automation/useCases', async (original) => ({
    ...(await original<typeof import('#/modules/Automation/useCases')>()),
    startAutomationRecording: vi.fn(),
    stopAutomationRecording: vi.fn(),
    applyModulation: vi.fn(),
    applyModulationToEngine: vi.fn(),
}));

const TRACK_ID = 'delayed-processor';
let processor: Processor;
let processorConstructor: (new () => Processor) | undefined;
let worker: {
    onmessage: ((event: { data: unknown }) => void) | null;
    sab: SharedArrayBuffer | null;
    messages: string[];
};
type Project = { tracks: NonNullable<typeof trackStore.value>; takeLanes: NonNullable<typeof takeLaneStore.value> };
function publication() {
    if (!worker.sab) {
        throw new Error('Recorder did not initialize its worker ring');
    }
    const result = readRecordingPublication(new Int32Array(worker.sab, 0, RECORDING_RING_CONTROL_INTS));
    if (result.status !== 'stable') {
        throw new Error('Processor did not publish a stable capture');
    }
    return result;
}
function expectProjection() {
    flushAutomergeStorageWrites();
    expect(getCrdtDoc<Project>('root')!.tracks.tracks).toEqual(trackStore.value!.tracks);
    expect(getCrdtDoc<Project>('root')!.takeLanes.lanes).toEqual(takeLaneStore.value!.lanes);
}

describe('real recorder first-frame capture placement', () => {
    beforeEach(async () => {
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('real recorder first-frame capture placement');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        registerHandlerMap(getTransportHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        setArrangementEventBus(createEventBus());
        setActionHistoryMetadataPort({
            record: () => [],
            markReverted: () => ({ status: 'unavailable' as const }),
            clear: () => undefined,
        });
        transportStore.set({
            ...defaultTransportState,
            tempo: 120,
            playheadPosition: 10,
            loopStart: 8,
            loopEnd: 12,
            isLooping: false,
        });
        tempoMapStore.set({ changes: [] });
        takeLaneStore.set({ lanes: [] });
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        await executeAppAction(
            { type: 'addTrack', payload: { id: TRACK_ID, kind: 'audio', name: 'Delayed processor' } },
            { skipUndo: true }
        );
        await executeAppAction({ type: 'armTrack', payload: { trackId: TRACK_ID, armed: true } }, { skipUndo: true });
        hardware.now = 50;
        hardware.rollStarts = 0;
        hardware.buffer = null;
        hardware.schedulerWorker = null;
        Object.defineProperty(navigator, 'mediaDevices', {
            configurable: true,
            value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] }) },
        });
        vi.stubGlobal(
            'AudioWorkletProcessor',
            class {
                port = { onmessage: null, postMessage: vi.fn() };
            }
        );
        vi.stubGlobal('registerProcessor', (_name: string, Constructor: new () => Processor) => {
            processorConstructor = Constructor;
        });
        vi.stubGlobal('currentFrame', 0);
        await import('../../../services/recordingProcessor');
        if (!processorConstructor) {
            throw new Error('Recording processor was not registered');
        }
        processor = new processorConstructor();
        vi.stubGlobal(
            'AudioWorkletNode',
            class {
                port = {
                    onmessage: null as ((event: { data: unknown }) => void) | null,
                    postMessage: (data: unknown) => processor.port.onmessage?.({ data }),
                };
                connect = vi.fn();
                disconnect = vi.fn();
                constructor() {
                    processor.port.postMessage = (data) => this.port.onmessage?.({ data });
                }
            }
        );
        vi.stubGlobal(
            'Worker',
            class {
                onmessage: ((event: { data: unknown }) => void) | null = null;
                sab: SharedArrayBuffer | null = null;
                messages: string[] = [];
                generation = 0;
                sequence = 0;
                terminate = vi.fn();
                addEventListener = vi.fn();
                removeEventListener = vi.fn();
                postMessage(data: { type: string; sab?: SharedArrayBuffer; generation?: number }) {
                    this.messages.push(data.type);
                    if (data.type === 'start' && data.generation !== undefined) {
                        this.generation = data.generation;
                        hardware.schedulerWorker = this;
                    }
                    if (data.type === 'init' && data.sab) {
                        this.sab = data.sab;
                        worker = { onmessage: this.onmessage, sab: this.sab, messages: this.messages };
                    }
                    if (data.type === 'stop' && this.sab) {
                        const captured = publication();
                        const pcm = new Float32Array(
                            this.sab,
                            RECORDING_RING_CONTROL_BYTES,
                            captured.sampleCount
                        ).slice();
                        const buffer: AudioBuffer = {
                            duration: pcm.length / context.sampleRate,
                            length: pcm.length,
                            sampleRate: context.sampleRate,
                            numberOfChannels: 1,
                            getChannelData: () => pcm,
                            copyFromChannel: (target, _channel, offset = 0) =>
                                target.set(pcm.subarray(offset, offset + target.length)),
                            copyToChannel: (source, _channel, offset = 0) => pcm.set(source, offset),
                        };
                        hardware.buffer = buffer;
                        this.onmessage?.({
                            data: {
                                type: 'wav',
                                buffer: new ArrayBuffer(45),
                                sampleZeroContextFrame: captured.sampleZeroContextFrame,
                                sampleRate: context.sampleRate,
                            },
                        });
                    }
                }
            }
        );
    });
    afterEach(async () => {
        await stopPlayback();
        expect(activeSessions.size).toBe(0);
        clearUndoHistory();
        clearHandlerRegistry();
        resetActionReplayAuthority();
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
        vi.unstubAllGlobals();
    });

    it.each([
        { route: 'starts playback', tempo: 120, startBeat: 10.2, endBeat: 11.2, originBeat: 10.2, pcmEndBeat: 10.6 },
        { route: 'joins playback', tempo: 120, startBeat: 10.2, endBeat: 11.2, originBeat: 10.2, pcmEndBeat: 10.6 },
        {
            route: 'joins playback after a loop wrap',
            tempo: 120,
            startBeat: 8,
            endBeat: 12,
            originBeat: 8,
            pcmEndBeat: 8.4,
        },
        {
            route: 'joins playback before a loop wrap',
            tempo: 120,
            startBeat: 8,
            endBeat: 12.1,
            originBeat: 11.7,
            pcmEndBeat: 12.1,
        },
        {
            route: 'joins playback through a tempo edit',
            tempo: 60,
            startBeat: 5.1,
            endBeat: 6.1,
            originBeat: 5.1,
            pcmEndBeat: 5.3,
        },
    ])(
        'places PCM from the first nonempty processor frame when Record $route, with one undoable commit',
        async ({ route, tempo, startBeat, endBeat, originBeat, pcmEndBeat }) => {
            let roll!: () => void;
            hardware.rollGate = new Promise<void>((resolve) => {
                roll = resolve;
            });
            const wrapsBeforeInput = route === 'joins playback after a loop wrap';
            const wrapsAfterInput = route === 'joins playback before a loop wrap';
            const loops = wrapsBeforeInput || wrapsAfterInput;
            if (loops) {
                hardware.now = 50.2;
                transportStore.set({ ...transportStore.value!, playheadPosition: 11.8, isLooping: true });
                roll();
                setPlayback(true);
                await vi.waitFor(() => expect(playheadClockRef.beat).toBe(11.8), { interval: 1 });
            } else if (route !== 'starts playback') {
                hardware.now = 50.2;
                transportStore.set({ ...transportStore.value!, isPlaying: true });
                playheadPositionRef.current = 10;
                playheadClockRef.beat = 10;
                playheadClockRef.audioTimeSeconds = 50.2;
            }
            toggleRecording();
            await vi.waitFor(() => expect(activeRecordingRef.current).toHaveLength(1), { interval: 1 });
            // Existing successful admission allows a roll request before worker
            // readiness or first input. This test repairs placement, not admission.
            expect(activeRecordingRef.current).toHaveLength(1);
            expect(activeSessions.get(TRACK_ID)?.status).toBe('starting');
            expect(worker.messages).toEqual(['init']);
            expect(publication()).toMatchObject({ sampleCount: 0, sampleZeroContextFrame: null });
            expect(audioRecordingStore.value?.isRecording).toBe(false);
            if (route === 'starts playback') {
                await vi.waitFor(() => expect(hardware.rollStarts).toBe(1), { interval: 1 });
                hardware.now = 50.2;
                roll();
            } else {
                expect(hardware.rollStarts).toBe(loops ? 1 : 0);
            }
            await vi.waitFor(() => expect(playheadClockRef.audioTimeSeconds).toBe(50.2), { interval: 1 });
            expect(playheadClockRef.beat).toBe(loops ? 11.8 : 10);
            processor.process([[new Float32Array(128)]]);
            expect(publication().sampleCount).toBe(0);
            worker.onmessage?.({ data: { type: 'ready' } });
            expect(worker.messages).toEqual(['init', 'start']);
            expect(audioRecordingStore.value?.isRecording).toBe(true);
            if (tempo === 60) {
                // The capture keeps its admitted song/context pair while the
                // current map changes before the first nonempty input block.
                await executeAppAction({ type: 'setTempo', payload: { bpm: tempo } }, { skipUndo: true });
            }
            processor.process([[]]);
            expect(publication().sampleZeroContextFrame).toBeNull();
            const captureInput = (seconds: number): void => {
                hardware.now = seconds;
                const firstFrame = Math.round(seconds * context.sampleRate);
                for (let block = 0; block < 75; block++) {
                    vi.stubGlobal('currentFrame', firstFrame + block * 128);
                    processor.process([[Float32Array.from({ length: 128 }, (_value, index) => block * 128 + index)]]);
                }
            };
            const firstFrame = Math.round((wrapsAfterInput ? 50.25 : 50.4) * context.sampleRate);
            if (wrapsAfterInput) {
                captureInput(50.25);
            }
            // The actual processor, not readiness/callback time, publishes sample zero.
            if (loops) {
                for (const seconds of [50.25, 50.3, 50.35, 50.4]) {
                    hardware.now = seconds;
                    const scheduler = hardware.schedulerWorker;
                    if (!scheduler?.onmessage) {
                        throw new Error('Playback did not open its scheduler worker');
                    }
                    const received = performance.timeOrigin + performance.now();
                    const settled = getSchedulerTimingDiagnostics().ticksSettled;
                    scheduler.onmessage({
                        data: {
                            type: 'tick',
                            generation: scheduler.generation,
                            sequence: ++scheduler.sequence,
                            scheduledAtMs: received - 2,
                            sentAtMs: received - 1,
                        },
                    });
                    await vi.waitFor(() => expect(getSchedulerTimingDiagnostics().ticksSettled).toBe(settled + 1), {
                        interval: 1,
                    });
                    expect(playheadClockRef.audioTimeSeconds).toBe(seconds);
                }
                expect(playheadClockRef.beat).toBeCloseTo(8.2, 10);
            } else {
                hardware.now = 50.4;
            }
            if (!wrapsAfterInput) {
                captureInput(hardware.now);
            }
            expect(publication()).toMatchObject({ sampleCount: 9600, sampleZeroContextFrame: firstFrame });
            hardware.now = 50.6;
            await stopPlayback();
            const clips = trackStore.value!.tracks[0]!.clips;
            expect(clips).toHaveLength(1);
            expect(clips[0]!.startBeat).toBeCloseTo(startBeat, 10);
            // The existing #4994 carrier minimum survives; no PCM is fabricated
            // beyond the measured 0.2-second recording.
            expect(clips[0]!.endBeat).toBeCloseTo(endBeat, 10);
            const media = audioBufferCache.get(clips[0]!.audioBufferId!);
            expect(media?.duration).toBe(0.2);
            expect(media?.length).toBe(9600);
            const placedOrigin = clips[0]!.startBeat - (clips[0]!.audioOffsetBeats ?? 0);
            expect(placedOrigin).toBeCloseTo(originBeat, 10);
            expect(placedOrigin + (media!.duration * tempo) / 60).toBeCloseTo(pcmEndBeat, 10);
            expect(media?.getChannelData(0)[9599]).toBe(9599);
            expect(media?.getChannelData(0)[9600]).toBeUndefined();
            expect(media?.getChannelData(0)[0]).toBe(0);
            const clickBeat = placedOrigin + (0.1 * tempo) / 60;
            const clickFrame = Math.round(((clickBeat - placedOrigin) * 60 * context.sampleRate) / tempo);
            expect(clickFrame).toBe(4800);
            expect(media?.getChannelData(0)[clickFrame]).toBe(4800);
            expectProjection();
            expect(undoHistoryStore.value?.past).toHaveLength(1);
            const committedClips = structuredClone(clips);
            const committedLanes = structuredClone(takeLaneStore.value!.lanes);
            await undo();
            expect(trackStore.value!.tracks[0]!.clips).toEqual([]);
            expect(takeLaneStore.value!.lanes).toEqual([]);
            expectProjection();
            await redo();
            expect(trackStore.value!.tracks[0]!.clips).toEqual(committedClips);
            expect(takeLaneStore.value!.lanes).toEqual(committedLanes);
            expectProjection();
            if (wrapsAfterInput) {
                expect(clips[0]!.audioOffsetBeats).toBeCloseTo(-3.7, 10);
                const capturedPass = takeLaneStore.value!.lanes[0]!.takes.find((take) => take.sourceOffsetBeats === 0)!;
                expect(capturedPass.startBeat).toBeCloseTo(11.8, 10);
                expect(capturedPass.passAnchorSeconds).toBeCloseTo(0.05, 10);
                expect(capturedPass.passDepthSeconds).toBeCloseTo(0.05, 10);
            }
        }
    );

    it('retires a producer clock when its captured session ends without adopting successor PCM', async () => {
        let readFirst: Parameters<NonNullable<Parameters<typeof startAudioRecording>[3]>>[0] | undefined;
        expect(
            await startAudioRecording(TRACK_ID, vi.fn(), null, (read) => {
                readFirst = read;
            })
        ).toBe(true);
        expect(readFirst?.()).toEqual({ status: 'pending' });
        worker.onmessage?.({ data: { type: 'ready' } });
        vi.stubGlobal('currentFrame', 50.4 * context.sampleRate);
        processor.process([[new Float32Array(128)]]);
        expect(readFirst?.()).toEqual({ status: 'captured', contextSeconds: 50.4 });
        await stopAudioRecording();
        expect(readFirst?.()).toEqual({ status: 'unavailable' });

        let readNext: typeof readFirst;
        expect(
            await startAudioRecording(TRACK_ID, vi.fn(), null, (read) => {
                readNext = read;
            })
        ).toBe(true);
        expect(readNext?.()).toEqual({ status: 'pending' });
        worker.onmessage?.({ data: { type: 'ready' } });
        vi.stubGlobal('currentFrame', 60 * context.sampleRate);
        processor.process([[new Float32Array(128)]]);
        expect(readNext?.()).toEqual({ status: 'captured', contextSeconds: 60 });
        expect(readFirst?.()).toEqual({ status: 'unavailable' });
        await stopAudioRecording();
    });
});
