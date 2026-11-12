import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerDeviceEnginePorts } from '#/app/registerDeviceEnginePorts';
import { createMockAudioContext } from '#/helpers/__tests__/audioContext.mock';
import { createEventBus } from '#/infra/events/createEventBus';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { markerStore, trackStore, takeLaneStore, activeRecordingRef } from '#/modules/Arrangement/stores';
import { addSection, createTrack, getMarkerState } from '#/modules/Arrangement/useCases';
import { automationStore } from '#/modules/Automation/stores';
import { clearHandlerRegistry, registerHandlerMap, getHandlerMap, undoHistoryStore } from '#/modules/Command/stores';
import { clearUndoHistory, executeAppAction } from '#/modules/Command/useCases';
import {
    createCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { defaultMidiStoreState, midiStore } from '#/modules/MIDI/stores';
import { type AppAction } from '#/utils/handlerContract';
import {
    setNotificationEventBus,
    type NotifyPayload,
    type ConfirmPayload,
    type PromptPayload,
} from '#/utils/Notification/notificationEventBus';

import { defaultTransportState } from '../../../models/TransportState';
import { setGestureClockSource } from '../../../stores/gestureClockSource';
import { playheadClockRef } from '../../../stores/playheadClockRef';
import { playheadPositionRef } from '../../../stores/playheadPositionRef';
import { tempoMapStore } from '../../../stores/tempoMapStore';
import { timeSignatureMapStore } from '../../../stores/timeSignatureMapStore';
import { transportStore } from '../../../stores/transportStore';
import { getTransportHandlers } from '../../getTransportHandlers';
import { disposePlayheadScheduler } from '../../playheadScheduler/disposePlayheadScheduler';
import { schedulerSession } from '../../playheadScheduler/schedulerSession';
import * as seekModule from '../executePlayheadSeek';
import { notePanicParticipants } from '../notePanicParticipants';
import { recordingLifecycle } from '../recordingLifecycle';
import { seekPlayhead } from '../seekPlayhead';
import * as playbackModule from '../startPlayback';
import * as recordingStopModule from '../stopActiveRecording';
import { stopPlayback } from '../stopPlayback';
import { toggleRecording } from '../toggleRecording';

const io = vi.hoisted(() => ({
    context: null as ReturnType<typeof createMockAudioContext> | null,
    initializeStrip: vi.fn(() => ({ acceptance: 'accepted', application: 'applied' })),
    clicks: vi.fn(),
    startRecorder: vi.fn(async () => true),
    stopRecorder: vi.fn<() => Promise<void>>(async () => undefined),
    transport: vi.fn(),
}));

// Only the actual AudioEngine/hardware edge is replaced. Every Transport and
// Arrangement operation, recording lifecycle, admission and scheduler is real.
vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    audioEngine: {
        get context() {
            return io.context;
        },
        beginAudioPreviewIntent: () => ({
            release: () => undefined,
            isCurrent: () => true,
            signal: new AbortController().signal,
        }),
        setTransportInfo: io.transport,
    },
    getAudioContext: () => io.context,
    getCurrentTime: () => io.context!.currentTime,
    nativeLiveGraphSessionOffered: () => false,
    resumeEngine: async () => undefined,
    initializeTrackStripFromSnapshot: io.initializeStrip,
    setTrackGain: vi.fn(),
    setTrackPan: vi.fn(),
    setTrackMute: vi.fn(),
    setTrackSoloGate: vi.fn(),
    scheduleClick: io.clicks,
    stopAllScheduled: vi.fn(),
    cancelTrackAutomationRamps: vi.fn(),
    startAudioRecording: io.startRecorder,
    stopAudioRecording: io.stopRecorder,
    refreshSidechainAlignment: vi.fn(),
    scheduleAdjustmentLayers: vi.fn(),
    readNativeEnginePlayheadSeconds: () => null,
}));

type NotificationEvents = { 'ui.notify': NotifyPayload; 'ui.confirm': ConfirmPayload; 'ui.prompt': PromptPayload };
const notifications: NotifyPayload[] = [];
const workers: DiagnosticWorker[] = [];
class DiagnosticWorker {
    onmessage: ((event: MessageEvent) => void) | null = null;
    messages: unknown[] = [];
    terminated = false;
    constructor(readonly url: URL) {
        workers.push(this);
    }
    postMessage(message: unknown): void {
        this.messages.push(message);
    }
    terminate(): void {
        this.terminated = true;
    }
}

function snapshot() {
    const state = transportStore.value;
    return {
        position: state?.playheadPosition,
        refPosition: playheadPositionRef.current,
        playing: state?.isPlaying,
        recording: state?.isRecording,
        loop: { enabled: state?.isLooping, start: state?.loopStart, end: state?.loopEnd },
        generation: schedulerSession.generation,
        pendingStart: recordingLifecycle.hasPendingRecordingStart(),
        countInArmed: recordingLifecycle.countInTimerId !== null,
        closing: recordingLifecycle.isClosingRecording(),
        clock: structuredClone(playheadClockRef),
        workerStarted: workers.some((worker) =>
            worker.messages.some(
                (message) =>
                    typeof message === 'object' && message !== null && 'type' in message && message.type === 'start'
            )
        ),
    };
}

registerDeviceEnginePorts();

describe('section rehearsal after an armed count-in', () => {
    beforeEach(() => {
        io.context = createMockAudioContext();
        io.context.currentTime = 10;
        vi.stubGlobal('Worker', DiagnosticWorker);
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('count-in rehearsal diagnostic');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getTransportHandlers());
        clearUndoHistory();
        notifications.length = 0;
        workers.length = 0;
        const bus = createEventBus<NotificationEvents>();
        bus.on('ui.notify', (message) => {
            notifications.push(message);
        });
        setNotificationEventBus(bus);
        trackStore.set({
            tracks: [
                createTrack({ name: 'Master', kind: 'master' }),
                { ...createTrack({ id: 'armed', name: 'Armed audio', kind: 'audio' }), armed: true },
            ],
            selectedTrackId: 'armed',
        });
        takeLaneStore.set({ lanes: [] });
        automationStore.set({ lanes: [] });
        midiStore.set(structuredClone(defaultMidiStoreState));
        markerStore.set({ markers: [], sections: [] });
        expect(addSection(16, 24, 'Target', 'target')).toBe(true);
        expect(getMarkerState()?.sections[0]).toMatchObject({ id: 'target', startBeat: 16, endBeat: 24 });
        tempoMapStore.set({ changes: [] });
        timeSignatureMapStore.set({ changes: [] });
        transportStore.set({
            ...defaultTransportState,
            tempo: 120,
            playheadPosition: 2,
            countInEnabled: true,
            countInBars: 1,
        });
        playheadPositionRef.current = 2;
        setGestureClockSource({
            getAudioTimeSeconds: () => io.context!.currentTime,
            readNativeCursorBeats: () => null,
        });
        flushAutomergeStorageWrites();
        vi.clearAllMocks();
    });
    afterEach(async () => {
        await stopPlayback();
        await recordingLifecycle.waitUntilRecordingClosed();
        disposePlayheadScheduler();
        expect(recordingLifecycle.hasPendingRecordingStart()).toBe(false);
        expect(workers.every((worker) => worker.terminated)).toBe(true);
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        flushAutomergeStorageWrites();
        clearHandlerRegistry();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it.each([
        { countIn: false, loop: false, label: 'ordinary stopped positive control' },
        { countIn: true, loop: false, label: 'Play Section during armed count-in' },
        { countIn: true, loop: true, label: 'Loop Section during armed count-in' },
    ])('$label', async ({ countIn, loop }) => {
        const seek = vi.spyOn(seekModule, 'executePlayheadSeek');
        const playback = vi.spyOn(playbackModule, 'startPlayback');
        const stopRecording = vi.spyOn(recordingStopModule, 'stopActiveRecording');
        if (countIn) {
            toggleRecording();
            expect(recordingLifecycle.hasPendingRecordingStart()).toBe(true);
            expect(recordingLifecycle.countInTimerId).not.toBeNull();
            expect(io.clicks).toHaveBeenCalledTimes(4);
            expect(io.startRecorder).not.toHaveBeenCalled();
        }
        const initial = snapshot();
        expect(initial).toMatchObject({ position: 2, playing: false, recording: false, pendingStart: countIn });
        expect(trackStore.value?.tracks.find((track) => track.id === 'armed')?.armed).toBe(true);
        const action: AppAction = { type: 'rehearseSection', payload: { sectionId: 'target', loop } };
        const handler = getHandlerMap()[action.type];
        expect(handler).toBeDefined();
        const execution = handler!.execute(action);
        if (!execution || execution instanceof Promise || !execution.afterRuntimeExecution) {
            throw new Error('Expected rehearsal runtime completion');
        }
        expect(seek).toHaveBeenCalledExactlyOnceWith(16);
        if (countIn) {
            expect(stopRecording).toHaveBeenCalledOnce();
            expect(io.stopRecorder).toHaveBeenCalledOnce();
        }
        const seekResult = seek.mock.results[0]?.value;
        expect(seekResult).toBeInstanceOf(Promise);
        await execution.afterRuntimeExecution();
        expect(playback).toHaveBeenCalledOnce();
        const playbackResult = playback.mock.results[0]?.value;
        expect(playbackResult).toBeInstanceOf(Promise);
        await playbackResult;
        const result = snapshot();
        // Admission must be proved before drawing any position conclusion.
        expect(result.workerStarted).toBe(true);
        expect(result.playing).toBe(true);
        expect(notifications).toEqual([]);
        expect(result.pendingStart).toBe(false);
        expect(result.recording).toBe(false);
        expect(activeRecordingRef.current).toEqual([]);
        expect(undoHistoryStore.value?.past).toEqual([]);
        expect(result.loop).toEqual({ enabled: loop, start: 16, end: 24 });
        expect(result.position).toBe(16);
        expect(result.refPosition).toBe(16);
        expect(result.clock.beat).toBe(16);
    });

    it('does not start a stale section after a newer seek while count-in teardown settles', async () => {
        let finishRecorderStop: (() => void) | undefined;
        io.stopRecorder.mockImplementationOnce(
            () =>
                new Promise<void>((resolve) => {
                    finishRecorderStop = resolve;
                })
        );
        toggleRecording();
        expect(recordingLifecycle.hasPendingRecordingStart()).toBe(true);
        expect(recordingLifecycle.countInTimerId).not.toBeNull();

        const action: AppAction = { type: 'rehearseSection', payload: { sectionId: 'target', loop: true } };
        const execution = getHandlerMap()[action.type]!.execute(action);
        if (!execution || execution instanceof Promise || !execution.afterRuntimeExecution) {
            throw new Error('Expected rehearsal runtime completion');
        }
        expect(recordingLifecycle.isClosingRecording()).toBe(true);
        expect(await seekPlayhead(32)).toBe(true);
        expect(playheadPositionRef.current).toBe(32);
        if (!finishRecorderStop) {
            throw new Error('Expected recorder stop to be pending');
        }
        finishRecorderStop();
        await execution.afterRuntimeExecution();
        await recordingLifecycle.waitUntilRecordingClosed();

        expect(transportStore.value?.isPlaying).toBe(false);
        expect(transportStore.value?.playheadPosition).toBe(32);
        expect(playheadPositionRef.current).toBe(32);
        expect(recordingLifecycle.hasPendingRecordingStart()).toBe(false);
        expect(io.startRecorder).not.toHaveBeenCalled();
        expect(
            workers.some((worker) =>
                worker.messages.some(
                    (message) =>
                        typeof message === 'object' && message !== null && 'type' in message && message.type === 'start'
                )
            )
        ).toBe(false);
    });

    it('does not start a stale section after Stop during post-position note panic', async () => {
        let finishPanic: (() => void) | undefined;
        vi.spyOn(notePanicParticipants.read('rehearsal test'), 'settleGeneratedNotes').mockImplementationOnce(
            () =>
                new Promise<void>((resolve) => {
                    finishPanic = resolve;
                })
        );
        toggleRecording();
        expect(recordingLifecycle.hasPendingRecordingStart()).toBe(true);
        const action: AppAction = { type: 'rehearseSection', payload: { sectionId: 'target', loop: true } };
        const execution = getHandlerMap()[action.type]!.execute(action);
        if (!execution || execution instanceof Promise || !execution.afterRuntimeExecution) {
            throw new Error('Expected rehearsal runtime completion');
        }
        await vi.waitFor(() => expect(playheadPositionRef.current).toBe(16));
        expect(transportStore.value?.isPlaying).toBe(false);
        expect(workers).toHaveLength(0);
        const seekGeneration = schedulerSession.generation;

        await stopPlayback();
        expect(schedulerSession.generation).toBeGreaterThan(seekGeneration);
        if (!finishPanic) {
            throw new Error('Expected note panic to be pending');
        }
        finishPanic();
        await execution.afterRuntimeExecution();

        expect(transportStore.value?.isPlaying).toBe(false);
        expect(recordingLifecycle.hasPendingRecordingStart()).toBe(false);
        expect(io.startRecorder).not.toHaveBeenCalled();
        expect(workers).toHaveLength(0);
    });

    it.each([false, true])(
        'preserves the Command failure receipt when count-in teardown rejects (loop: %s)',
        async (loop) => {
            const recordingFailure = new Error('recording flush failed');
            io.stopRecorder.mockRejectedValueOnce(recordingFailure);
            toggleRecording();
            expect(recordingLifecycle.hasPendingRecordingStart()).toBe(true);
            expect(recordingLifecycle.countInTimerId).not.toBeNull();

            await expect(
                executeAppAction({ type: 'rehearseSection', payload: { sectionId: 'target', loop } })
            ).rejects.toMatchObject({
                name: 'AppActionCommittedError',
                message: 'Action committed but post-commit processing failed: rehearseSection',
                cause: recordingFailure,
            });

            expect(io.stopRecorder).toHaveBeenCalledOnce();
            expect(snapshot()).toMatchObject({
                position: 16,
                refPosition: 16,
                playing: false,
                recording: false,
                loop: { enabled: loop, start: 16, end: 24 },
                pendingStart: false,
                countInArmed: false,
                closing: false,
                workerStarted: false,
            });
            expect(io.startRecorder).not.toHaveBeenCalled();
            expect(workers).toHaveLength(0);
            expect(activeRecordingRef.current).toEqual([]);
            expect(undoHistoryStore.value?.past).toEqual([]);
        }
    );
});
