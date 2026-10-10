import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createEventBus } from '#/infra/events/createEventBus';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { activeRecordingRef, takeLaneStore, trackStore } from '#/modules/Arrangement/stores';
import {
    getArrangementHandlers,
    resolveClipsWithComping,
    setArrangementEventBus,
} from '#/modules/Arrangement/useCases';
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
import {
    playheadClockRef,
    playheadPositionRef,
    setGestureClockSource,
    tempoMapStore,
    transportStore,
} from '#/modules/Transport/stores';
import {
    defaultTransportState,
    getTransportHandlers,
    getSchedulerTimingDiagnostics,
    seekPlayhead,
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
    sourceStarts: [] as { sourceSeconds: number; durationSeconds: number }[],
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
    createGain: () => ({
        connect: vi.fn(),
        disconnect: vi.fn(),
        gain: { cancelScheduledValues: vi.fn(), setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() },
    }),
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
        getCurrentTime: () => hardware.now,
        ensureTrackStrip: () => ({ gainNode: {} }),
        createBufferSource: () => ({
            connect: vi.fn(),
            disconnect: vi.fn(),
            playbackRate: { value: 1 },
            start: (_when: number, sourceSeconds: number, durationSeconds: number) => {
                hardware.sourceStarts.push({ sourceSeconds, durationSeconds });
            },
        }),
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
const pendingAnimationFrames = new Map<number, FrameRequestCallback>();
let nextAnimationFrame = 0;
type Project = { tracks: NonNullable<typeof trackStore.value>; takeLanes: NonNullable<typeof takeLaneStore.value> };
function publication(sab = worker.sab) {
    if (!sab) {
        throw new Error('Recorder did not initialize its worker ring');
    }
    const result = readRecordingPublication(new Int32Array(sab, 0, RECORDING_RING_CONTROL_INTS));
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

async function schedulerTick(seconds: number): Promise<void> {
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
    await vi.waitFor(() => expect(getSchedulerTimingDiagnostics().ticksSettled).toBe(settled + 1), { interval: 1 });
}

describe('real recorder first-frame capture placement', () => {
    beforeEach(async () => {
        pendingAnimationFrames.clear();
        nextAnimationFrame = 0;
        vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
            const id = ++nextAnimationFrame;
            pendingAnimationFrames.set(id, callback);
            return id;
        });
        vi.stubGlobal('cancelAnimationFrame', (id: number) => pendingAnimationFrames.delete(id));
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
        hardware.sourceStarts = [];
        hardware.schedulerWorker = null;
        setGestureClockSource({ getAudioTimeSeconds: () => hardware.now, readNativeCursorBeats: () => null });
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
                private readonly ownedProcessor = new processorConstructor!();
                port = {
                    onmessage: null as ((event: { data: unknown }) => void) | null,
                    postMessage: (data: unknown) => this.ownedProcessor.port.onmessage?.({ data }),
                };
                connect = vi.fn();
                disconnect = vi.fn();
                constructor() {
                    processor = this.ownedProcessor;
                    this.ownedProcessor.port.postMessage = (data) => this.port.onmessage?.({ data });
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
                        const captured = publication(this.sab);
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

    it.each([120, 60])(
        'retains first PCM while another independently keyed input waits across the loop seam and finishes at %s BPM',
        async (tempo) => {
            const secondId = 'waiting-input';
            await executeAppAction(
                { type: 'addTrack', payload: { id: secondId, kind: 'audio', name: 'Waiting input' } },
                { skipUndo: true }
            );
            for (const [trackId, inputId] of [
                [TRACK_ID, 'input-a'],
                [secondId, 'input-b'],
            ]) {
                await executeAppAction(
                    { type: 'armTrack', payload: { trackId: trackId!, armed: true } },
                    { skipUndo: true }
                );
                await executeAppAction(
                    { type: 'setTrackInput', payload: { trackId: trackId!, inputId: inputId! } },
                    { skipUndo: true }
                );
            }
            let admitSecond!: (stream: MediaStream) => void;
            const stream = { getTracks: () => [{ stop: vi.fn() }] } as MediaStream;
            vi.mocked(navigator.mediaDevices.getUserMedia).mockImplementation(async (constraints) => {
                const audio = constraints?.audio;
                if (
                    typeof audio === 'object' &&
                    typeof audio.deviceId === 'object' &&
                    'exact' in audio.deviceId &&
                    audio.deviceId.exact === 'input-b'
                ) {
                    return new Promise<MediaStream>((resolve) => {
                        admitSecond = resolve;
                    });
                }
                return stream;
            });
            hardware.rollGate = Promise.resolve();
            hardware.now = 50.2;
            transportStore.set({ ...transportStore.value!, playheadPosition: 11.8, isLooping: true });
            setPlayback(true);
            await vi.waitFor(() => expect(playheadClockRef.beat).toBe(11.8), { interval: 1 });
            toggleRecording();
            await vi.waitFor(() => expect(activeSessions.has(TRACK_ID)).toBe(true), { interval: 1 });
            expect(activeRecordingRef.current).toEqual([]);
            worker.onmessage?.({ data: { type: 'ready' } });
            hardware.now = 50.25;
            const zeroFrame = Math.round(hardware.now * context.sampleRate);
            for (let offset = 0; offset < 9600; offset += 128) {
                hardware.now = (zeroFrame + offset) / context.sampleRate;
                vi.stubGlobal('currentFrame', zeroFrame + offset);
                processor.process([[Float32Array.from({ length: 128 }, (_value, index) => offset + index)]]);
                if (offset % 1024 === 0) {
                    await schedulerTick(hardware.now);
                }
            }
            expect(publication().sampleZeroContextFrame).toBe(2412000);
            for (const seconds of [50.45, 50.6, 50.8, 51, 51.2]) {
                await schedulerTick(seconds);
            }
            if (tempo !== 120) {
                hardware.now = 51.21;
                await executeAppAction({ type: 'setTempo', payload: { bpm: tempo } }, { skipUndo: true });
                await schedulerTick(51.22);
            }
            admitSecond(stream);
            await vi.waitFor(() => expect(activeRecordingRef.current).toHaveLength(2), { interval: 1 });
            hardware.now = 51.4;
            await stopPlayback();
            const clips = structuredClone(trackStore.value!.tracks[0]!.clips);
            const lanes = structuredClone(takeLaneStore.value!.lanes);
            expect(clips).toHaveLength(1);
            expect(((clips[0]!.startBeat - (clips[0]!.audioOffsetBeats ?? 0)) * 60) / tempo).toBeCloseTo(5.85, 10);
            expect(trackStore.value!.tracks[1]!.clips).toEqual([]);
            expect(undoHistoryStore.value?.past).toHaveLength(1);
            expectProjection();
            await undo();
            expect(trackStore.value!.tracks.every((track) => track.clips.length === 0)).toBe(true);
            expect(takeLaneStore.value!.lanes).toEqual([]);
            expectProjection();
            await redo();
            expect(trackStore.value!.tracks[0]!.clips).toEqual(clips);
            expect(takeLaneStore.value!.lanes).toEqual(lanes);
            expectProjection();
        }
    );

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
            endBeat: 12,
            originBeat: 11.7,
            pcmEndBeat: 12.1,
        },
        {
            route: 'joins playback before a loop wrap with an empty final lap',
            tempo: 120,
            startBeat: 8,
            endBeat: 12,
            originBeat: 11.7,
            pcmEndBeat: 12,
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
            const wrapsAfterInput = route.startsWith('joins playback before a loop wrap');
            const emptyFinalLap = route.endsWith('with an empty final lap');
            const capturedFrames = emptyFinalLap ? 7200 : 9600;
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
            const provisionalTakeId = takeLaneStore.value!.lanes[0]!.takes[0]!.id;
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
                for (let offset = 0; offset < capturedFrames; offset += 128) {
                    vi.stubGlobal('currentFrame', firstFrame + offset);
                    processor.process([
                        [
                            Float32Array.from(
                                { length: Math.min(128, capturedFrames - offset) },
                                (_value, index) => offset + index
                            ),
                        ],
                    ]);
                }
            };
            const firstFrame = Math.round((wrapsAfterInput ? 50.25 : 50.4) * context.sampleRate);
            if (wrapsAfterInput) {
                captureInput(50.25);
            }
            // The actual processor, not readiness/callback time, publishes sample zero.
            if (loops) {
                for (const seconds of [50.25, 50.3, 50.35, 50.4, 50.45, 50.5, 50.55, 50.6]) {
                    if (emptyFinalLap && seconds === 50.35) {
                        const previousChanges = tempoMapStore.value!.changes;
                        const callbacks = [...pendingAnimationFrames.values()];
                        pendingAnimationFrames.clear();
                        expect(callbacks.length).toBeGreaterThan(0);
                        for (const callback of callbacks) {
                            callback(performance.now());
                        }
                        expect(tempoMapStore.value!.changes).toEqual(previousChanges);
                        expect(tempoMapStore.value!.changes).not.toBe(previousChanges);
                    }
                    await schedulerTick(seconds);
                    expect(playheadClockRef.audioTimeSeconds).toBe(seconds);
                }
                expect(playheadClockRef.beat).toBeCloseTo(8.6, 10);
            } else {
                hardware.now = 50.4;
            }
            if (!wrapsAfterInput) {
                captureInput(50.4);
            }
            expect(publication()).toMatchObject({ sampleCount: capturedFrames, sampleZeroContextFrame: firstFrame });
            hardware.now = 50.6;
            await stopPlayback();
            const clips = trackStore.value!.tracks[0]!.clips;
            expect(clips).toHaveLength(1);
            expect(clips[0]!.startBeat).toBeCloseTo(startBeat, 10);
            // The existing #4994 carrier minimum survives; no PCM is fabricated
            // beyond the measured producer extent.
            expect(clips[0]!.endBeat).toBeCloseTo(endBeat, 10);
            const media = audioBufferCache.get(clips[0]!.audioBufferId!);
            expect(media?.duration).toBe(capturedFrames / context.sampleRate);
            expect(media?.length).toBe(capturedFrames);
            const placedOrigin = clips[0]!.startBeat - (clips[0]!.audioOffsetBeats ?? 0);
            expect(placedOrigin).toBeCloseTo(originBeat, 10);
            expect(placedOrigin + (media!.duration * tempo) / 60).toBeCloseTo(pcmEndBeat, 10);
            expect(media?.getChannelData(0)[capturedFrames - 1]).toBe(capturedFrames - 1);
            expect(media?.getChannelData(0)[capturedFrames]).toBeUndefined();
            expect(media?.getChannelData(0)[0]).toBe(0);
            const clickBeat = placedOrigin + (0.1 * tempo) / 60;
            const clickFrame = Math.round(((clickBeat - placedOrigin) * 60 * context.sampleRate) / tempo);
            expect(clickFrame).toBe(4800);
            expect(media?.getChannelData(0)[clickFrame]).toBe(4800);
            if (wrapsAfterInput && !emptyFinalLap) {
                const takes = takeLaneStore.value!.lanes[0]!.takes;
                expect(takes).toHaveLength(2);
                expect(takes.every((take) => take.sourceOffsetBeats !== undefined)).toBe(true);
            }
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
                const finalPass = takeLaneStore.value!.lanes[0]!.takes.find(
                    (take) => take.sourceOffsetBeats !== undefined && take.sourceOffsetBeats > 0
                );
                const selections = [
                    { take: capturedPass, sourceSeconds: 0.05, durationSeconds: 0.1, firstFrame: 2400 },
                ];
                if (!emptyFinalLap) {
                    expect(finalPass).toBeDefined();
                    expect(finalPass!.id).toBe(provisionalTakeId);
                    expect(finalPass!.name).toBe('Take 1');
                    expect(finalPass!.startBeat).toBe(8);
                    expect(finalPass!.endBeat).toBeCloseTo(8.1, 10);
                    expect(finalPass!.sourceOffsetBeats).toBeCloseTo(0.2, 10);
                    expect(finalPass!.passAnchorSeconds).toBeCloseTo(-1.85, 10);
                    expect(finalPass!.passDepthSeconds).toBeCloseTo(0.15, 10);
                    selections.push({ take: finalPass!, sourceSeconds: 0.15, durationSeconds: 0.05, firstFrame: 7200 });
                }
                for (const selection of selections) {
                    await executeAppAction(
                        {
                            type: 'setCompRegion',
                            payload: {
                                trackId: TRACK_ID,
                                takeId: selection.take.id,
                                startBeat: selection.take.startBeat,
                                endBeat: selection.take.endBeat,
                            },
                        },
                        { skipUndo: true }
                    );
                    const resolved = resolveClipsWithComping(TRACK_ID, trackStore.value!.tracks[0]!.clips);
                    const fragment = resolved.find((clip) => clip.startBeat === selection.take.startBeat)!;
                    expect((fragment.audioOffsetBeats ?? 0) / 2).toBeCloseTo(selection.sourceSeconds, 10);
                    seekPlayhead(selection.take.startBeat);
                    await vi.waitFor(() =>
                        expect(transportStore.value!.playheadPosition).toBe(selection.take.startBeat)
                    );
                    hardware.sourceStarts = [];
                    setPlayback(true);
                    await vi.waitFor(() => expect(playheadClockRef.beat).toBe(selection.take.startBeat));
                    await schedulerTick(hardware.now);
                    const started = hardware.sourceStarts.find(
                        (source) => Math.abs(source.sourceSeconds - selection.sourceSeconds) < 1e-9
                    )!;
                    expect(started).toBeDefined();
                    expect(
                        hardware.sourceStarts.filter(
                            (source) => Math.abs(source.sourceSeconds - selection.sourceSeconds) < 1e-9
                        )
                    ).toHaveLength(1);
                    expect(started.durationSeconds).toBeCloseTo(selection.durationSeconds, 10);
                    expect(media!.getChannelData(0)[Math.round(started.sourceSeconds * 48000)]).toBe(
                        selection.firstFrame
                    );
                    expect(
                        media!.getChannelData(0)[
                            Math.round((started.sourceSeconds + started.durationSeconds) * 48000) - 1
                        ]
                    ).toBe(selection.firstFrame + Math.round(selection.durationSeconds * 48000) - 1);
                    await stopPlayback();
                }
                if (emptyFinalLap) {
                    expect(finalPass).toBeUndefined();
                    const takes = takeLaneStore.value!.lanes[0]!.takes;
                    expect(takes).toHaveLength(1);
                    expect(takes[0]!.id).toBe(capturedPass.id);
                    expect(takes[0]!.id).not.toBe(provisionalTakeId);
                }
            }
        }
    );

    it('keeps automatic punch sample zero on a seam sounded before recorder admission settles', async () => {
        let admitMedia!: () => void;
        const mediaStream = { getTracks: () => [{ stop: vi.fn() }] };
        const mediaAdmission = new Promise<typeof mediaStream>((resolve) => {
            admitMedia = () => resolve(mediaStream);
        });
        Object.defineProperty(navigator, 'mediaDevices', {
            configurable: true,
            value: { getUserMedia: vi.fn(() => mediaAdmission) },
        });
        transportStore.set({
            ...transportStore.value!,
            playheadPosition: 9.8,
            loopStart: 8,
            loopEnd: 12,
            isLooping: true,
        });
        await executeAppAction({ type: 'setPunchIn', payload: { beat: 10 } }, { skipUndo: true });
        await executeAppAction({ type: 'setPunchOut', payload: { beat: 14 } }, { skipUndo: true });
        await executeAppAction({ type: 'togglePunch' }, { skipUndo: true });
        setPlayback(true);
        await vi.waitFor(() => expect(playheadClockRef).toEqual({ beat: 9.8, audioTimeSeconds: 50 }), {
            interval: 1,
        });

        await schedulerTick(50.05);
        await schedulerTick(50.1);
        expect(activeRecordingRef.current).toHaveLength(1);
        expect(activeSessions.size).toBe(0);
        expect(playheadClockRef.beat).toBeCloseTo(10, 10);

        for (const seconds of [
            50.15, 50.2, 50.25, 50.3, 50.35, 50.4, 50.45, 50.5, 50.55, 50.6, 50.65, 50.7, 50.75, 50.8, 50.85, 50.9,
            50.95, 51, 51.05, 51.1, 51.15,
        ]) {
            await schedulerTick(seconds);
        }
        expect(playheadClockRef.beat).toBeCloseTo(8.1, 10);
        expect(playheadClockRef.audioTimeSeconds).toBe(51.15);
        expect(activeSessions.size).toBe(0);

        admitMedia();
        await vi.waitFor(() => expect(activeSessions.get(TRACK_ID)?.status).toBe('starting'), { interval: 1 });
        expect(worker.messages).toEqual(['init']);
        expect(publication()).toMatchObject({
            status: 'stable',
            sampleCount: 0,
            sampleZeroContextFrame: null,
        });
        expect(audioRecordingStore.value?.isRecording).toBe(false);

        worker.onmessage?.({ data: { type: 'ready' } });
        expect(activeSessions.get(TRACK_ID)?.status).toBe('recording');
        expect(worker.messages).toEqual(['init', 'start']);
        expect(audioRecordingStore.value?.isRecording).toBe(true);
        processor.process([[]]);
        expect(publication()).toMatchObject({ sampleCount: 0, sampleZeroContextFrame: null });

        await schedulerTick(51.2);
        expect(playheadClockRef.beat).toBeCloseTo(8.2, 10);
        expect(playheadClockRef.audioTimeSeconds).toBe(51.2);
        const sampleZeroContextFrame = 2_457_600;
        vi.stubGlobal('currentFrame', sampleZeroContextFrame);
        processor.process([[Float32Array.from({ length: 128 }, (_value, index) => index)]]);
        expect(publication()).toMatchObject({
            status: 'stable',
            sampleCount: 128,
            sampleZeroContextFrame,
        });

        await schedulerTick(51.25);
        hardware.now = 51.3;
        await stopPlayback();
        const [clip] = trackStore.value!.tracks[0]!.clips;
        expect(clip).toBeDefined();
        expect(clip!.startBeat - (clip!.audioOffsetBeats ?? 0)).toBeCloseTo(8, 10);
        const media = audioBufferCache.get(clip!.audioBufferId!);
        expect(media?.length).toBe(128);
        expect(media?.duration).toBe(128 / context.sampleRate);
        expect(media?.getChannelData(0)[0]).toBe(0);
        expect(media?.getChannelData(0)[127]).toBe(127);
        expect(media?.getChannelData(0)[128]).toBeUndefined();
        expectProjection();
        expect(undoHistoryStore.value?.past).toHaveLength(1);
        const committedClips = structuredClone(trackStore.value!.tracks[0]!.clips);
        const committedLanes = structuredClone(takeLaneStore.value!.lanes);
        await undo();
        expect(trackStore.value!.tracks[0]!.clips).toEqual([]);
        expect(takeLaneStore.value!.lanes).toEqual([]);
        expectProjection();
        await redo();
        expect(trackStore.value!.tracks[0]!.clips).toEqual(committedClips);
        expect(takeLaneStore.value!.lanes).toEqual(committedLanes);
        expectProjection();
    });

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
