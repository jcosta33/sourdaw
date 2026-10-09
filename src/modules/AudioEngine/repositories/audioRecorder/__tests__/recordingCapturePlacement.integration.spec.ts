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
import { playheadClockRef, tempoMapStore, transportStore } from '#/modules/Transport/stores';
import {
    defaultTransportState,
    getTransportHandlers,
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
import { activeSessions } from '../recordingSession';

type Processor = {
    port: { onmessage: ((event: { data: unknown }) => void) | null; postMessage: (message: unknown) => void };
    process(inputs: Float32Array[][]): boolean;
};
const hardware = vi.hoisted(() => ({
    now: 50,
    rollStarts: 0,
    rollGate: Promise.resolve(),
    buffer: null as AudioBuffer | null,
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
                terminate = vi.fn();
                addEventListener = vi.fn();
                removeEventListener = vi.fn();
                postMessage(data: { type: string; sab?: SharedArrayBuffer }) {
                    this.messages.push(data.type);
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

    it('places PCM from the first nonempty processor frame after native roll, with one undoable commit', async () => {
        let roll!: () => void;
        hardware.rollGate = new Promise<void>((resolve) => {
            roll = resolve;
        });
        toggleRecording();
        await vi.waitFor(() => expect(hardware.rollStarts).toBe(1), { interval: 1 });
        // Existing successful admission allows a roll request before worker
        // readiness or first input. This test repairs placement, not admission.
        expect(activeRecordingRef.current).toHaveLength(1);
        expect(activeSessions.get(TRACK_ID)?.status).toBe('starting');
        expect(worker.messages).toEqual(['init']);
        expect(publication()).toMatchObject({ sampleCount: 0, sampleZeroContextFrame: null });
        expect(audioRecordingStore.value?.isRecording).toBe(false);
        hardware.now = 50.2;
        roll();
        await vi.waitFor(() => expect(playheadClockRef.audioTimeSeconds).toBe(50.2), { interval: 1 });
        expect(playheadClockRef.beat).toBe(10);
        processor.process([[new Float32Array(128)]]);
        expect(publication().sampleCount).toBe(0);
        worker.onmessage?.({ data: { type: 'ready' } });
        expect(worker.messages).toEqual(['init', 'start']);
        expect(audioRecordingStore.value?.isRecording).toBe(true);
        processor.process([[]]);
        expect(publication().sampleZeroContextFrame).toBeNull();
        // The actual processor, not readiness/callback time, publishes sample zero.
        hardware.now = 50.4;
        const firstFrame = Math.round(hardware.now * context.sampleRate);
        for (let block = 0; block < 75; block++) {
            vi.stubGlobal('currentFrame', firstFrame + block * 128);
            processor.process([[Float32Array.from({ length: 128 }, (_value, index) => block * 128 + index)]]);
        }
        expect(publication()).toMatchObject({ sampleCount: 9600, sampleZeroContextFrame: firstFrame });
        hardware.now = 50.6;
        await stopPlayback();
        const clips = trackStore.value!.tracks[0]!.clips;
        expect(clips).toHaveLength(1);
        expect(clips[0]!.startBeat).toBeCloseTo(10.2, 10);
        // The existing #4994 carrier minimum survives; no PCM is fabricated
        // beyond the measured 0.2-second recording, which ends at beat 10.6.
        expect(clips[0]!.endBeat).toBeCloseTo(11.2, 10);
        const media = audioBufferCache.get(clips[0]!.audioBufferId!);
        expect(media?.duration).toBe(0.2);
        expect(media?.length).toBe(9600);
        expect(clips[0]!.startBeat + media!.duration * 2).toBeCloseTo(10.6, 10);
        expect(media?.getChannelData(0)[9599]).toBe(9599);
        expect(media?.getChannelData(0)[9600]).toBeUndefined();
        expect(media?.getChannelData(0)[0]).toBe(0);
        const clickFrame = Math.round(((10.4 - clips[0]!.startBeat) * 60 * context.sampleRate) / 120);
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
    });
});
