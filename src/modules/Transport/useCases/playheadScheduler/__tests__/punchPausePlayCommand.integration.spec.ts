import { clone as cloneAutomergeDoc, toJS } from '@automerge/automerge';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getProductionCommandHandlerMaps } from '#/app/getProductionCommandHandlerMaps';
import { MockAudioBuffer } from '#/helpers/__tests__/audioContext.mock';
import { logger } from '#/infra/logger/appLogger';
import { withProjectAudioStorageLock } from '#/infra/storage/withProjectAudioStorageLock';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { createControlledLockManager } from '#/infra/testing/createControlledLockManager';
import { activeRecordingRef, takeLaneStore, trackStore, type Track } from '#/modules/Arrangement/stores';
import { audioBufferCache } from '#/modules/AudioEngine/stores';
import {
    configureDurableAudioBufferOwnership,
    getCachedAudioBuffer,
    releasePreviewAudioBuffer,
} from '#/modules/AudioEngine/useCases';
import { clearHandlerRegistry, undoHistoryStore, undoTreeStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    registerProductionCommandHandlers,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
    undo,
    redo,
} from '#/modules/Command/useCases';
import { actionHistoryStore, branchStore } from '#/modules/CrdtDocument/stores';
import {
    DOC_PREFIX_ROOT,
    clearActionHistory,
    createCrdtDoc,
    getCrdtDoc,
    projectCrdtToStores,
    replaceCrdtDoc,
    markActionHistoryEntryReverted,
    recordActionHistoryEntry,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { defaultTransportState, tempoMapStore, transportStore } from '#/modules/Transport/stores';

import * as transportStateReader from '../../../repositories/transport/getTransportState';
import { disposePlayheadScheduler } from '../../playheadScheduler/disposePlayheadScheduler';
import { schedulerSession } from '../../playheadScheduler/schedulerSession';
import { scheduleMidiNotes } from '../../scheduling/scheduleMidiNotes';
import { executePlayheadSeek } from '../../transportControls/executePlayheadSeek';
import { pausePlayback } from '../../transportControls/pausePlayback';
import { recordingLifecycle } from '../../transportControls/recordingLifecycle';
import { startPlayback } from '../../transportControls/startPlayback';
import { stopPlayback } from '../../transportControls/stopPlayback';

const TRACK_ID = 'track-recording';
const INPUT_START_FAILURE = 'Punch-in recording failed to start — the take was discarded.';
const SESSION_KEY = 'sourdaw-undo-session';
const testAudioDatabase = new IDBFactory();
type RecordingTerminal = Parameters<typeof import('#/modules/AudioEngine/useCases').startAudioRecording>[1];
const mocks = vi.hoisted(() => {
    const audioClock = { currentTime: 0, baseLatency: 0, outputLatency: 0 };
    type RecorderSession = {
        trackId: string;
        callback: RecordingTerminal;
        status: 'recording' | 'stopping';
        flushed: Promise<void>;
        settle: () => void;
    };
    // Mirrors the audio recorder repository's per-track admission
    // (`startAudioRecording`/`stopAudioRecording`): one session per track; a
    // start behind a stopping session waits for its flush and is refused when
    // any stop ran meanwhile; a stop flushes only sessions still recording.
    const recorder = {
        startGeneration: 0,
        sessions: new Map<string, RecorderSession>(),
        heldFlushes: [] as RecorderSession[],
        refusedStarts: 0,
    };
    function openSession(trackId: string, callback: RecordingTerminal): void {
        const flush = Promise.withResolvers<void>();
        recorder.sessions.set(trackId, {
            trackId,
            callback,
            status: 'recording',
            flushed: flush.promise,
            settle: flush.resolve,
        });
    }
    async function admitStart(trackId: string, callback: RecordingTerminal): Promise<boolean> {
        const startGeneration = recorder.startGeneration;
        const current = recorder.sessions.get(trackId);
        if (current?.status === 'stopping') {
            await current.flushed;
            if (startGeneration !== recorder.startGeneration) {
                recorder.refusedStarts++;
                return false;
            }
        }
        if (recorder.sessions.has(trackId)) {
            recorder.refusedStarts++;
            return false;
        }
        openSession(trackId, callback);
        return true;
    }
    function stopSessions(): Promise<void> {
        recorder.startGeneration++;
        const sessions = [...recorder.sessions.values()];
        for (const session of sessions) {
            if (session.status === 'recording') {
                session.status = 'stopping';
                recorder.heldFlushes.push(session);
            }
        }
        return Promise.all(sessions.map((session) => session.flushed)).then(() => undefined);
    }
    return {
        audioClock,
        getAudioContext: vi.fn(() => audioClock),
        getCompensationDelay: vi.fn(() => 0),
        notifyUser: vi.fn<(message: string, level: string) => void>(),
        startAudioRecording: vi.fn<(trackId: string, callback: RecordingTerminal) => Promise<boolean>>(admitStart),
        stopAudioRecording: vi.fn<() => Promise<void>>(stopSessions),
        reset(): void {
            recorder.startGeneration = 0;
            recorder.sessions = new Map();
            recorder.heldFlushes = [];
            recorder.refusedStarts = 0;
        },
        pendingCount(): number {
            return recorder.heldFlushes.length;
        },
        recordingSessions(): number {
            return Array.from(recorder.sessions.values()).filter((session) => session.status === 'recording').length;
        },
        refusedStarts(): number {
            return recorder.refusedStarts;
        },
        release(buffer: AudioBuffer): void {
            const session = recorder.heldFlushes.shift();
            if (!session) {
                throw new Error('Expected a held recorder flush');
            }
            // The repository runs the terminal, then retires the session, then wakes its waiters.
            session.callback({ kind: 'completed', buffer, sampleZeroContextFrame: 0, sampleRate: buffer.sampleRate });
            recorder.sessions.delete(session.trackId);
            session.settle();
        },
    };
});
vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    getAudioContext: mocks.getAudioContext,
    resumeEngine: vi.fn(() => Promise.resolve()),
    nativeLiveGraphSessionOffered: () => false,
    getCompensationDelay: mocks.getCompensationDelay,
    startAudioRecording: mocks.startAudioRecording,
    stopAudioRecording: mocks.stopAudioRecording,
    readNativeEnginePlayheadSeconds: () => null,
    audioEngine: {
        beginAudioPreviewIntent: () => ({
            signal: new AbortController().signal,
            isCurrent: () => true,
            release: vi.fn(),
        }),
        setTransportInfo: vi.fn(),
    },
    refreshSidechainAlignment: vi.fn(),
    scheduleAdjustmentLayers: vi.fn(),
    stopAllScheduled: vi.fn(),
}));
vi.mock('../../scheduling/scheduleAudioClips', () => ({ scheduleAudioClips: vi.fn() }));
vi.mock('../../scheduling/scheduleMidiNotes', () => ({ scheduleMidiNotes: vi.fn(async () => undefined) }));
vi.mock('../../scheduling/scheduleMetronome', () => ({ scheduleMetronome: vi.fn() }));
vi.mock('../../scheduling/applyAutomation/applyAutomation', () => ({
    applyAutomation: vi.fn(() => new Set<string>()),
}));
vi.mock('../../scheduling/applyAutomation/applyVcaGains', () => ({ applyVcaGains: vi.fn() }));
vi.mock('#/modules/Automation/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Automation/useCases')>()),
    startAutomationRecording: vi.fn(),
    applyModulation: vi.fn(),
    applyModulationToEngine: vi.fn(),
}));
vi.mock('../../evaluateFollowActions', () => ({
    evaluateFollowActions: () => ({ jumpToPosition: null, shouldStop: false }),
}));
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: mocks.notifyUser }));

function recordingTrack(kind: 'audio' | 'midi', id = TRACK_ID): Track {
    return {
        id,
        name: kind === 'audio' ? 'Audio' : 'Midi',
        kind,
        muted: false,
        soloed: false,
        armed: true,
        gain: 0.8,
        pan: 0,
        color: '#ff0000',
        clips: [],
        devices: [],
        sends: [],
        frozen: false,
        freezeState: { status: 'unfrozen' },
        parentId: null,
        collapsed: false,
        inputMonitoring: 'auto',
        hidden: false,
        disabled: false,
        height: 80,
        outputId: 'master',
        automationMode: 'read',
        groupId: null,
        soloSafe: false,
        notes: '',
        inputId: null,
        activeAlternativeId: 'alt-1',
        alternatives: [{ id: 'alt-1', name: 'Alternative 1', clips: [] }],
        vcaGroupId: null,
        midiOutputTrackId: null,
        followChordTrack: false,
        midiFx: [],
    };
}

async function tick(expectedCaptures: number): Promise<void> {
    const worker = schedulerSession.worker;
    if (!worker) {
        throw new Error('Expected a scheduler worker from Play');
    }
    mocks.audioClock.currentTime += 0.07;
    const now = performance.timeOrigin + performance.now();
    worker.onmessage?.(
        new MessageEvent('message', {
            data: {
                type: 'tick',
                generation: schedulerSession.generation,
                sequence: expectedCaptures,
                scheduledAtMs: now - 2,
                sentAtMs: now - 1,
            },
        })
    );
    await vi.waitFor(() => {
        expect(mocks.startAudioRecording).toHaveBeenCalledTimes(expectedCaptures);
        expect(schedulerSession.tickInFlight).toBe(false);
    });
}
function commits(): number {
    return (undoHistoryStore.value?.past ?? []).filter(
        (entry) => entry.kind === 'action' && entry.action.type === 'commitRecording'
    ).length;
}
function pcm(value: number): AudioBuffer {
    const buffer = MockAudioBuffer.create(2, 96_000, 48_000);
    buffer.getChannelData(0).set([value, -value]);
    buffer.getChannelData(1).set([-value, value]);
    return buffer;
}

function expectPcm(clipId: string | undefined, expected: AudioBuffer, value: number): void {
    const clip = trackStore.value?.tracks[0]?.clips.find((item) => item.id === clipId);
    if (!clip?.audioBufferId) {
        throw new Error('Expected committed capture buffer reference');
    }
    const cached = getCachedAudioBuffer({ bufferId: clip.audioBufferId });
    expect(cached === expected, 'committed capture resolves to its original PCM buffer').toBe(true);
    if (!cached) {
        throw new Error('Expected captured PCM in the audio buffer cache');
    }
    expect({ channels: cached.numberOfChannels, rate: cached.sampleRate, length: cached.length }).toEqual({
        channels: 2,
        rate: 48_000,
        length: 96_000,
    });
    expect(Array.from(cached.getChannelData(0).slice(0, 2))).toEqual([value, -value]);
    expect(Array.from(cached.getChannelData(1).slice(0, 2))).toEqual([-value, value]);
}

function captured() {
    return structuredClone({ tracks: trackStore.value, takes: takeLaneStore.value });
}
async function openFirst() {
    trackStore.set({ tracks: [recordingTrack('audio')], selectedTrackId: TRACK_ID, ghostClips: [] });
    takeLaneStore.set({ lanes: [] });
    transportStore.set({
        ...defaultTransportState,
        tempo: 120,
        isPlaying: false,
        isRecording: false,
        countInEnabled: false,
        punchInEnabled: true,
        punchInBeat: 4,
        punchOutBeat: 8,
        playheadPosition: 4,
    });
    tempoMapStore.set({ changes: [] });
    flushAutomergeStorageWrites();
    await startPlayback();
    await tick(1);
    expect(schedulerSession.punchRecordingActive).toBe(true);
    const old = activeRecordingRef.current[0];
    expect(old).toBeTruthy();
    return old;
}

describe('automatic punch Pause and Play with real recording commits', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.reset();
        vi.spyOn(audioBufferCache, 'set');
        vi.stubGlobal('indexedDB', testAudioDatabase);
        configureDurableAudioBufferOwnership(() => Promise.resolve([]));
        disposePlayheadScheduler();
        vi.stubGlobal(
            'Worker',
            class {
                onmessage: ((event: MessageEvent) => void) | null = null;
                postMessage = vi.fn();
                terminate = vi.fn();
                addEventListener = vi.fn();
                removeEventListener = vi.fn();
            }
        );
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('punch pause play');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        vi.stubGlobal('navigator', { ...navigator, locks: createControlledLockManager().locks });
        branchStore.set({
            branches: [
                {
                    branchId: 'main',
                    name: 'Main',
                    rootDocId: DOC_PREFIX_ROOT,
                    sourceBranchId: null,
                    createdAt: 1,
                    createdFromHeads: [],
                    note: '',
                },
            ],
            activeBranchId: 'main',
        });
        clearHandlerRegistry();
        sessionStorage.removeItem(SESSION_KEY);
        registerProductionCommandHandlers(getProductionCommandHandlerMaps({ canMutateBranchMetadata: () => true }));
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort({
            record: recordActionHistoryEntry,
            markReverted: markActionHistoryEntryReverted,
            clear: clearActionHistory,
        });
        actionHistoryStore.set({ entries: [] });
        const tree = undoTreeStore.value;
        if (!tree) {
            throw new Error('Expected undo tree');
        }
        undoTreeStore.set({ ...tree, enabled: true });
        activeRecordingRef.current = [];
        activeRecordingRef.capturedRootIdentity = null;
        mocks.audioClock.currentTime = 0;
    });
    afterEach(async () => {
        await recordingLifecycle.waitForCommits();
        await recordingLifecycle.waitForClosing();
        const bufferIds = vi.mocked(audioBufferCache.set).mock.calls.map(([bufferId]) => bufferId);
        const receipt = await audioBufferCache.ensureDurable(bufferIds);
        expect(receipt.status).toBe('durable');
        if (receipt.status === 'durable') {
            receipt.release();
        }
        for (const bufferId of bufferIds) {
            releasePreviewAudioBuffer(bufferId);
            expect(getCachedAudioBuffer({ bufferId })).toBeNull();
        }
        // Removal runs under the same exclusive lock as the durability writes.
        await withProjectAudioStorageLock(() => Promise.resolve());
        configureDurableAudioBufferOwnership(null);
        disposePlayheadScheduler();
        clearHandlerRegistry();
        clearUndoHistory();
        resetActionReplayAuthority();
        activeRecordingRef.current = [];
        activeRecordingRef.capturedRootIdentity = null;
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        takeLaneStore.set({ lanes: [] });
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });
    async function expectBothCapturesRetained(capture: {
        old: string | undefined;
        oldBuffer: AudioBuffer;
        successor: string | undefined;
        successorBuffer: AudioBuffer;
    }): Promise<void> {
        const { old, oldBuffer, successor, successorBuffer } = capture;
        pausePlayback();
        expect(mocks.pendingCount()).toBe(1);
        mocks.release(successorBuffer);
        await vi.waitFor(() => expect(commits()).toBe(2));
        await recordingLifecycle.waitForCommits();
        flushAutomergeStorageWrites();
        const full = captured();
        const clips = full.tracks?.tracks[0]?.clips ?? [];
        expect(clips.map((clip) => clip.id)).toEqual([old, successor]);
        expect(clips.every((clip) => clip.audioBufferId?.startsWith('rec-'))).toBe(true);
        expect(new Set(clips.map((clip) => clip.audioBufferId)).size).toBe(2);
        expect(full.takes?.lanes.flatMap((lane) => lane.takes.map((take) => take.clipId))).toEqual([old, successor]);
        expect(actionHistoryStore.value?.entries).toHaveLength(2);
        expectPcm(old, oldBuffer, 0.25);
        expectPcm(successor, successorBuffer, 0.5);
        const root = getCrdtDoc(DOC_PREFIX_ROOT);
        if (!root) {
            throw new Error('Expected committed project root');
        }
        const raw = toJS(root);
        expect(raw.tracks).toEqual({ tracks: full.tracks?.tracks });
        expect(raw.takeLanes).toEqual(full.takes);
        await undo();
        expectPcm(old, oldBuffer, 0.25);
        expect(trackStore.value?.tracks[0]?.clips.map((clip) => clip.id)).toEqual([old]);
        expect(takeLaneStore.value?.lanes.flatMap((lane) => lane.takes.map((take) => take.clipId))).toEqual([old]);
        await undo();
        expect(trackStore.value?.tracks[0]?.clips).toEqual([]);
        expect(takeLaneStore.value?.lanes.flatMap((lane) => lane.takes)).toEqual([]);
        await redo();
        expectPcm(old, oldBuffer, 0.25);
        expect(trackStore.value?.tracks[0]?.clips.map((clip) => clip.id)).toEqual([old]);
        expect(takeLaneStore.value?.lanes.flatMap((lane) => lane.takes.map((take) => take.clipId))).toEqual([old]);
        await redo();
        expect(captured()).toEqual(full);
        expectPcm(old, oldBuffer, 0.25);
        expectPcm(successor, successorBuffer, 0.5);
    }

    it('retains both captures when the old flush settles before the successor punches in', async () => {
        const oldBuffer = pcm(0.25);
        const successorBuffer = pcm(0.5);
        const old = await openFirst();
        const oldGeneration = schedulerSession.generation;
        pausePlayback();
        expect(mocks.pendingCount()).toBe(1);
        // Resume just before the punch-in point, so the successor rolls while the
        // old flush is held and punches in only when a later tick crosses it.
        await executePlayheadSeek(3.95);
        await startPlayback();
        const successorGeneration = schedulerSession.generation;
        expect(successorGeneration).toBeGreaterThan(oldGeneration);
        expect(schedulerSession.punchRecordingActive).toBe(false);
        expect(mocks.startAudioRecording).toHaveBeenCalledTimes(1);
        // The roll's first window already covers the scheduler's look-ahead;
        // move the audio clock past it so the next tick advances the playhead.
        mocks.audioClock.currentTime += 0.1;
        // Nothing else reads the transport through this repository until the
        // old Pause's late continuation does.
        const continuationReads = vi.spyOn(transportStateReader, 'getTransportState');

        mocks.release(oldBuffer);
        await tick(2);
        const successor = activeRecordingRef.current[0];
        expect(successor).toBeTruthy();
        expect(successor).not.toBe(old);
        expect(mocks.recordingSessions()).toBe(1);
        expect(mocks.refusedStarts()).toBe(0);

        await vi.waitFor(() => expect(commits()).toBe(1));
        await vi.waitFor(() => expect(continuationReads).toHaveBeenCalledTimes(1));
        continuationReads.mockRestore();
        // The old continuation found the successor rolling and left it its scheduler and punch.
        expect(schedulerSession.worker).not.toBeNull();
        expect(schedulerSession.generation).toBe(successorGeneration);
        expect(schedulerSession.punchRecordingActive).toBe(true);
        expect(activeRecordingRef.current).toEqual([successor]);
        expectPcm(old, oldBuffer, 0.25);
        await expectBothCapturesRetained({ old, oldBuffer, successor, successorBuffer });
    });

    it('retains both captures when the successor punches in on a later tick behind the held old flush', async () => {
        const oldBuffer = pcm(0.25);
        const successorBuffer = pcm(0.5);
        const old = await openFirst();
        pausePlayback();
        expect(mocks.pendingCount()).toBe(1);
        await executePlayheadSeek(3.95);
        await startPlayback();
        const successorGeneration = schedulerSession.generation;
        expect(schedulerSession.punchRecordingActive).toBe(false);
        mocks.audioClock.currentTime += 0.1;

        // A later tick's punch-in does not hold the roll; its start waits behind the old flush.
        await tick(2);
        const successor = activeRecordingRef.current[0];
        expect(successor).toBeTruthy();
        expect(successor).not.toBe(old);
        expect(schedulerSession.punchRecordingActive).toBe(true);
        expect(mocks.recordingSessions()).toBe(0);
        const successorRow = structuredClone(trackStore.value?.tracks[0]?.clips.find((clip) => clip.id === successor));
        expect(successorRow).toBeDefined();
        const continuationReads = vi.spyOn(transportStateReader, 'getTransportState');

        // No stop ran while the successor waited, so the settled flush admits it.
        mocks.release(oldBuffer);
        await vi.waitFor(() => expect(mocks.recordingSessions()).toBe(1));
        await vi.waitFor(() => expect(commits()).toBe(1));
        await vi.waitFor(() => expect(continuationReads).toHaveBeenCalledTimes(1));
        continuationReads.mockRestore();
        expect(mocks.refusedStarts()).toBe(0);
        expect(mocks.notifyUser).not.toHaveBeenCalled();
        expect(schedulerSession.worker).not.toBeNull();
        expect(schedulerSession.generation).toBe(successorGeneration);
        expect(schedulerSession.punchRecordingActive).toBe(true);
        expect(activeRecordingRef.current).toEqual([successor]);
        expect(trackStore.value?.tracks[0]?.clips.find((clip) => clip.id === successor)).toEqual(successorRow);
        expectPcm(old, oldBuffer, 0.25);
        await expectBothCapturesRetained({ old, oldBuffer, successor, successorBuffer });
    });
    it('discards the successor provisional clip when a pause refuses its start behind the held old flush', async () => {
        const oldBuffer = pcm(0.25);
        const old = await openFirst();
        pausePlayback();
        expect(mocks.pendingCount()).toBe(1);
        await executePlayheadSeek(3.95);
        await startPlayback();
        mocks.audioClock.currentTime += 0.1;
        await tick(2);
        const successor = activeRecordingRef.current[0];
        expect(successor).toBeTruthy();
        expect(successor).not.toBe(old);
        expect(trackStore.value?.tracks[0]?.clips.some((clip) => clip.id === successor)).toBe(true);

        // A second Pause while the successor waits moves the recorder's start generation.
        pausePlayback();
        mocks.release(oldBuffer);
        await vi.waitFor(() => expect(mocks.refusedStarts()).toBe(1));
        await vi.waitFor(() => expect(commits()).toBe(1));
        await vi.waitFor(() =>
            expect(trackStore.value?.tracks[0]?.clips.some((clip) => clip.id === successor)).toBe(false)
        );
        await recordingLifecycle.waitForCommits();
        await recordingLifecycle.waitForClosing();
        flushAutomergeStorageWrites();
        const clips = trackStore.value?.tracks[0]?.clips ?? [];
        expect(clips.map((clip) => clip.id)).toEqual([old]);
        expect(clips.filter((clip) => clip.audioBufferId === undefined)).toEqual([]);
        const takeClipIds = takeLaneStore.value?.lanes.flatMap((lane) => lane.takes.map((take) => take.clipId));
        expect(takeClipIds).not.toContain(successor);
        expect(takeClipIds).toEqual([old]);
        expect(actionHistoryStore.value?.entries).toHaveLength(1);
        expect(activeRecordingRef.current).toEqual([]);
        expect(mocks.notifyUser).not.toHaveBeenCalled();
        expectPcm(old, oldBuffer, 0.25);
    });

    it('discards the provisional clip and says so when a punch-in start throws', async () => {
        mocks.startAudioRecording.mockImplementationOnce(() => Promise.reject(new Error('recorder unavailable')));
        trackStore.set({ tracks: [recordingTrack('audio')], selectedTrackId: TRACK_ID, ghostClips: [] });
        takeLaneStore.set({ lanes: [] });
        transportStore.set({
            ...defaultTransportState,
            tempo: 120,
            isPlaying: false,
            isRecording: false,
            countInEnabled: false,
            punchInEnabled: true,
            punchInBeat: 4,
            punchOutBeat: 8,
            playheadPosition: 3.95,
        });
        tempoMapStore.set({ changes: [] });
        flushAutomergeStorageWrites();
        await startPlayback();
        expect(schedulerSession.punchRecordingActive).toBe(false);
        mocks.audioClock.currentTime += 0.1;
        // The rolling transport crosses the punch-in point on a later tick.
        await tick(1);
        expect(schedulerSession.punchRecordingActive).toBe(true);
        await vi.waitFor(() => expect(trackStore.value?.tracks[0]?.clips).toEqual([]));
        expect(takeLaneStore.value?.lanes.flatMap((lane) => lane.takes)).toEqual([]);
        expect(activeRecordingRef.current).toEqual([]);
        expect(mocks.notifyUser).toHaveBeenCalledTimes(1);
        expect(mocks.notifyUser).toHaveBeenCalledWith(INPUT_START_FAILURE, 'error');
        expect(transportStore.value?.isPlaying).toBe(true);
        expect(schedulerSession.worker).not.toBeNull();
        pausePlayback();
        await recordingLifecycle.waitForClosing();
        expect(actionHistoryStore.value?.entries).toEqual([]);
        expect(commits()).toBe(0);
    });

    /** Roll from just before the region and cross the punch-in point on a later tick. */
    async function punchInOnLaterTick(tracks: Track[], punchOutBeat = 8): Promise<void> {
        trackStore.set({ tracks, selectedTrackId: TRACK_ID, ghostClips: [] });
        takeLaneStore.set({ lanes: [] });
        transportStore.set({
            ...defaultTransportState,
            tempo: 120,
            isPlaying: false,
            isRecording: false,
            countInEnabled: false,
            punchInEnabled: true,
            punchInBeat: 4,
            punchOutBeat,
            playheadPosition: 3.95,
        });
        tempoMapStore.set({ changes: [] });
        flushAutomergeStorageWrites();
        await startPlayback();
        expect(schedulerSession.punchRecordingActive).toBe(false);
        mocks.audioClock.currentTime += 0.1;
        await tick(tracks.length);
        expect(schedulerSession.punchRecordingActive).toBe(true);
    }

    function startFailureLogs(errors: { mock: { calls: unknown[][] } }): unknown[] {
        return errors.mock.calls
            .map(([error]) => error)
            .filter((error) => error instanceof Error && error.message === 'Punch-in audio recording failed to start');
    }

    it('stays quiet and discards the clip when the input fails after a Pause during its start', async () => {
        const start = Promise.withResolvers<boolean>();
        mocks.startAudioRecording.mockImplementationOnce(() => start.promise);
        const errors = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
        await punchInOnLaterTick([recordingTrack('audio')]);
        expect(trackStore.value?.tracks[0]?.clips).toHaveLength(1);

        pausePlayback();
        start.reject(new Error('microphone permission denied'));

        await vi.waitFor(() => expect(startFailureLogs(errors)).toHaveLength(1));
        await vi.waitFor(() => expect(trackStore.value?.tracks[0]?.clips).toEqual([]));
        await recordingLifecycle.waitForClosing();
        expect(takeLaneStore.value?.lanes.flatMap((lane) => lane.takes)).toEqual([]);
        expect(mocks.notifyUser).not.toHaveBeenCalled();
        expect(commits()).toBe(0);
    });

    it('says the input failed when it fails after the punch-out passed during its start', async () => {
        const start = Promise.withResolvers<boolean>();
        mocks.startAudioRecording.mockImplementationOnce(() => start.promise);
        const errors = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
        // A short region, so a few ticks carry the roll past its punch-out.
        await punchInOnLaterTick([recordingTrack('audio')], 4.5);

        // The roll passes the punch-out point while the input is still opening.
        for (let ticks = 0; ticks < 8 && schedulerSession.punchRecordingActive; ticks++) {
            mocks.audioClock.currentTime += 0.03;
            await tick(1);
        }
        expect(schedulerSession.punchRecordingActive).toBe(false);
        expect(transportStore.value?.isPlaying).toBe(true);
        start.reject(new Error('microphone permission denied'));

        await vi.waitFor(() => expect(mocks.notifyUser).toHaveBeenCalledWith(INPUT_START_FAILURE, 'error'));
        expect(mocks.notifyUser).toHaveBeenCalledTimes(1);
        expect(startFailureLogs(errors)).toHaveLength(1);
        expect(trackStore.value?.tracks[0]?.clips).toEqual([]);
        pausePlayback();
        await recordingLifecycle.waitForClosing();
        expect(commits()).toBe(0);
    });

    function armFirstWindowPunch(loop: { loopStart: number; loopEnd: number } | null): void {
        trackStore.set({ tracks: [recordingTrack('audio')], selectedTrackId: TRACK_ID, ghostClips: [] });
        takeLaneStore.set({ lanes: [] });
        const transport = {
            ...defaultTransportState,
            tempo: 120,
            isPlaying: false,
            isRecording: false,
            countInEnabled: false,
            punchInEnabled: true,
            punchInBeat: 4,
            punchOutBeat: 8,
            playheadPosition: loop ? 7.9 : 4,
        };
        if (loop) {
            transport.isLooping = true;
            transport.loopStart = loop.loopStart;
            transport.loopEnd = loop.loopEnd;
        }
        transportStore.set(transport);
        tempoMapStore.set({ changes: [] });
        flushAutomergeStorageWrites();
    }

    function expectRefusedPunchRetired(): void {
        expect(trackStore.value?.tracks[0]?.clips).toEqual([]);
        expect(takeLaneStore.value?.lanes.flatMap((lane) => lane.takes)).toEqual([]);
        expect(actionHistoryStore.value?.entries).toEqual([]);
        expect(commits()).toBe(0);
    }

    async function playIntoRefusedFirstWindowPunch(loop: { loopStart: number; loopEnd: number } | null) {
        mocks.startAudioRecording.mockResolvedValueOnce(false);
        armFirstWindowPunch(loop);
        await startPlayback();
        // The punch opened on Play's own first window.
        expect(mocks.startAudioRecording).toHaveBeenCalledTimes(1);
        expect(transportStore.value?.isPlaying).toBe(true);
        expect(schedulerSession.worker).not.toBeNull();
        expect(schedulerSession.pendingSeam?.destinationBeat).toBe(loop?.loopStart);
        expect(trackStore.value?.tracks[0]?.clips).toEqual([]);
        expect(takeLaneStore.value?.lanes.flatMap((lane) => lane.takes)).toEqual([]);
        expect(mocks.notifyUser).not.toHaveBeenCalled();
        expect(actionHistoryStore.value?.entries).toEqual([]);
        pausePlayback();
        await recordingLifecycle.waitForClosing();
        expect(commits()).toBe(0);
    }

    it('keeps Play rolling and discards the clip when a first-window punch-in start is refused', async () => {
        await playIntoRefusedFirstWindowPunch(null);
    });

    it('keeps Play rolling when a refused first-window punch-in start shares the window with a loop seam', async () => {
        await playIntoRefusedFirstWindowPunch({ loopStart: 0, loopEnd: 8 });
    });

    it('keeps Play rolling and says the input failed when a held first-window punch-in start rejects', async () => {
        const start = Promise.withResolvers<boolean>();
        mocks.startAudioRecording.mockImplementationOnce(() => start.promise);
        armFirstWindowPunch(null);
        const playing = startPlayback();
        await vi.waitFor(() => expect(mocks.startAudioRecording).toHaveBeenCalledTimes(1));
        expect(trackStore.value?.tracks[0]?.clips).toHaveLength(1);
        // The input fails while Play's own first window still prepares, so the
        // discard is held until the initial emission settles.
        start.reject(new Error('microphone permission denied'));
        await playing;
        expect(transportStore.value?.isPlaying).toBe(true);
        expect(schedulerSession.worker).not.toBeNull();
        await vi.waitFor(() => expect(trackStore.value?.tracks[0]?.clips).toEqual([]));
        expect(takeLaneStore.value?.lanes.flatMap((lane) => lane.takes)).toEqual([]);
        expect(mocks.notifyUser).toHaveBeenCalledTimes(1);
        expect(mocks.notifyUser).toHaveBeenCalledWith(INPUT_START_FAILURE, 'error');
        pausePlayback();
        await recordingLifecycle.waitForClosing();
        expectRefusedPunchRetired();
    });

    it('retires a refused first-window start when the initial emission goes stale', async () => {
        const start = Promise.withResolvers<boolean>();
        mocks.startAudioRecording.mockImplementationOnce(() => start.promise);
        armFirstWindowPunch(null);
        const playing = startPlayback();
        await vi.waitFor(() => expect(mocks.startAudioRecording).toHaveBeenCalledTimes(1));
        expect(trackStore.value?.tracks[0]?.clips).toHaveLength(1);
        // A tempo-map edit while the start waits stales the prepared programme
        // without moving capture ownership.
        tempoMapStore.set({ changes: [] });
        start.resolve(false);
        await playing;
        expect(mocks.notifyUser).toHaveBeenCalledWith('Playback changed while preparing. Press Play again.', 'warning');
        expect(transportStore.value?.isPlaying).toBe(false);
        expect(schedulerSession.worker).toBeNull();
        await recordingLifecycle.waitForClosing();
        expectRefusedPunchRetired();
    });

    it('retires a refused first-window start when the initial emission fails', async () => {
        mocks.startAudioRecording.mockResolvedValueOnce(false);
        vi.mocked(scheduleMidiNotes).mockRejectedValueOnce(new Error('initial MIDI window failed'));
        armFirstWindowPunch(null);
        await startPlayback();
        expect(mocks.startAudioRecording).toHaveBeenCalledTimes(1);
        expect(scheduleMidiNotes).toHaveBeenCalled();
        expect(mocks.notifyUser).toHaveBeenCalledWith('Playback changed while preparing. Press Play again.', 'warning');
        expect(transportStore.value?.isPlaying).toBe(false);
        expect(schedulerSession.worker).toBeNull();
        await recordingLifecycle.waitForClosing();
        expectRefusedPunchRetired();
    });

    it('commits an ordinary pause before resuming without a held predecessor', async () => {
        const old = await openFirst();
        pausePlayback();
        mocks.release(pcm(0.125));
        await vi.waitFor(() => expect(commits()).toBe(1));
        await vi.waitFor(() => expect(schedulerSession.worker).toBeNull());
        await startPlayback();
        await tick(2);
        expect(activeRecordingRef.current[0]).not.toBe(old);
        pausePlayback();
        mocks.release(pcm(0.125));
        await vi.waitFor(() => expect(commits()).toBe(2));
    });

    it('leaves the new owner arrangement alone when a refused punch-in start arrives after root replacement', async () => {
        const old = await openFirst();
        pausePlayback();
        expect(mocks.pendingCount()).toBe(1);
        await executePlayheadSeek(3.95);
        await startPlayback();
        mocks.audioClock.currentTime += 0.1;
        await tick(2);
        const successor = activeRecordingRef.current[0];
        expect(successor).toBeTruthy();
        expect(successor).not.toBe(old);
        pausePlayback();
        flushAutomergeStorageWrites();
        const root = getCrdtDoc(DOC_PREFIX_ROOT);
        if (!root) {
            throw new Error('Expected outgoing project root');
        }
        replaceCrdtDoc({ id: DOC_PREFIX_ROOT, doc: cloneAutomergeDoc(root) });
        projectCrdtToStores({ resetProjections: true });
        flushAutomergeStorageWrites();
        const successorRoot = getCrdtDoc(DOC_PREFIX_ROOT);
        if (!successorRoot) {
            throw new Error('Expected successor project root');
        }
        const before = structuredClone(toJS(successorRoot));
        const beforeProjection = captured();
        // The new owner holds a clip with the refused start's id.
        expect(beforeProjection.tracks?.tracks[0]?.clips.some((clip) => clip.id === successor)).toBe(true);

        mocks.release(pcm(0.125));
        await vi.waitFor(() => expect(mocks.refusedStarts()).toBe(1));
        await recordingLifecycle.waitForCommits();
        await recordingLifecycle.waitForClosing();
        flushAutomergeStorageWrites();
        const after = getCrdtDoc(DOC_PREFIX_ROOT);
        if (!after) {
            throw new Error('Expected successor project root after the refusal');
        }
        expect(captured()).toEqual(beforeProjection);
        expect(toJS(after)).toEqual(before);
        expect(commits()).toBe(0);
    });

    it('refuses an old terminal after root replacement without changing its successor', async () => {
        await openFirst();
        pausePlayback();
        flushAutomergeStorageWrites();
        const root = getCrdtDoc(DOC_PREFIX_ROOT);
        if (!root) {
            throw new Error('Expected outgoing project root');
        }
        replaceCrdtDoc({ id: DOC_PREFIX_ROOT, doc: cloneAutomergeDoc(root) });
        projectCrdtToStores({ resetProjections: true });
        flushAutomergeStorageWrites();
        const successorRoot = getCrdtDoc(DOC_PREFIX_ROOT);
        if (!successorRoot) {
            throw new Error('Expected successor project root');
        }
        const before = structuredClone(toJS(successorRoot));
        const beforeProjection = captured();
        mocks.release(pcm(0.125));
        await vi.waitFor(() =>
            expect(mocks.notifyUser).toHaveBeenCalledWith(expect.stringContaining('not kept'), 'warning')
        );
        flushAutomergeStorageWrites();
        const after = getCrdtDoc(DOC_PREFIX_ROOT);
        if (!after) {
            throw new Error('Expected successor project root after terminal');
        }
        expect(toJS(after)).toEqual(before);
        expect(captured()).toEqual(beforeProjection);
        expect(commits()).toBe(0);
    });

    describe('a Play pressed inside the region while the paused punch is still closing (#5998)', () => {
        const PREPARATION_REFUSAL = 'Playback changed while preparing. Press Play again.';

        /** Pause the open punch with its flush held, seek inside the region, and press Play. */
        async function playInsideRegionBehindHeldFlush() {
            const old = await openFirst();
            pausePlayback();
            expect(mocks.pendingCount()).toBe(1);
            await executePlayheadSeek(6);
            const closingChecks = vi.spyOn(recordingLifecycle, 'isClosingRecording');
            const playing = startPlayback();
            // Play is now waiting on the held flush: either through its punch's
            // recorder start, or on the earlier punch's closing itself.
            await vi.waitFor(() =>
                expect(mocks.startAudioRecording.mock.calls.length === 2 || closingChecks.mock.calls.length > 0).toBe(
                    true
                )
            );
            return { old, playing };
        }

        /** Resolve once Play has settled, or once a stop is flushing the punch Play admitted. */
        async function untilPlaySettlesOrStops(playing: Promise<void>): Promise<void> {
            let settled = false;
            void playing.then(() => {
                settled = true;
            });
            await vi.waitFor(() => expect(settled || mocks.pendingCount() > 0).toBe(true));
        }

        function replaceProjectRoot(): void {
            flushAutomergeStorageWrites();
            const root = getCrdtDoc(DOC_PREFIX_ROOT);
            if (!root) {
                throw new Error('Expected outgoing project root');
            }
            replaceCrdtDoc({ id: DOC_PREFIX_ROOT, doc: cloneAutomergeDoc(root) });
            projectCrdtToStores({ resetProjections: true });
            flushAutomergeStorageWrites();
        }

        it('keeps Play rolling and both captures when the earlier punch commits while Play prepares', async () => {
            const oldBuffer = pcm(0.25);
            const successorBuffer = pcm(0.5);
            const { old, playing } = await playInsideRegionBehindHeldFlush();

            mocks.release(oldBuffer);
            await untilPlaySettlesOrStops(playing);
            expect(transportStore.value?.isPlaying, 'Play keeps rolling').toBe(true);
            expect(mocks.pendingCount(), 'no stop is flushing the successor punch').toBe(0);
            await playing;
            await vi.waitFor(() => expect(commits()).toBe(1));

            expect(mocks.notifyUser).not.toHaveBeenCalledWith(PREPARATION_REFUSAL, 'warning');
            expect(schedulerSession.punchRecordingActive).toBe(true);
            expect(mocks.recordingSessions()).toBe(1);
            expect(mocks.refusedStarts()).toBe(0);
            const successor = activeRecordingRef.current[0];
            expect(successor).toBeTruthy();
            expect(successor).not.toBe(old);
            const clips = trackStore.value?.tracks[0]?.clips ?? [];
            expect(clips.find((clip) => clip.id === old)?.startBeat).toBe(4);
            expect(clips.find((clip) => clip.id === successor)?.startBeat).toBe(6);
            expectPcm(old, oldBuffer, 0.25);
            await expectBothCapturesRetained({ old, oldBuffer, successor, successorBuffer });
        });

        it('keeps the next Play rolling when a paused session retires its refused start during preparation', async () => {
            const admitStart = mocks.startAudioRecording.getMockImplementation();
            if (!admitStart) {
                throw new Error('Expected the recorder fake admission');
            }
            const pausedStart = Promise.withResolvers<boolean>();
            const successorAdmission = Promise.withResolvers<void>();
            mocks.startAudioRecording
                .mockImplementationOnce(() => pausedStart.promise)
                .mockImplementationOnce(async (trackId, callback) => {
                    await successorAdmission.promise;
                    return admitStart(trackId, callback);
                });
            armFirstWindowPunch(null);
            const pausedPlay = startPlayback();
            await vi.waitFor(() => expect(mocks.startAudioRecording).toHaveBeenCalledTimes(1));
            const refused = activeRecordingRef.current[0];
            expect(refused).toBeTruthy();
            pausePlayback();
            await recordingLifecycle.waitForClosing();

            const successorPlay = startPlayback();
            // The successor has taken its programme witness and waits on its own start.
            await vi.waitFor(() => expect(mocks.startAudioRecording).toHaveBeenCalledTimes(2));
            pausedStart.resolve(false);
            await pausedPlay;
            successorAdmission.resolve();
            await untilPlaySettlesOrStops(successorPlay);
            expect(transportStore.value?.isPlaying, 'Play keeps rolling').toBe(true);
            expect(mocks.pendingCount(), 'no stop is flushing the successor punch').toBe(0);
            await successorPlay;

            expect(mocks.notifyUser).not.toHaveBeenCalledWith(PREPARATION_REFUSAL, 'warning');
            expect(schedulerSession.punchRecordingActive).toBe(true);
            expect(mocks.recordingSessions()).toBe(1);
            const successor = activeRecordingRef.current[0];
            expect(successor).toBeTruthy();
            expect(successor).not.toBe(refused);
            // The refused start's provisional clip is still retired, once the successor settled.
            expect(trackStore.value?.tracks[0]?.clips.map((clip) => clip.id)).toEqual([successor]);
            expect(takeLaneStore.value?.lanes.flatMap((lane) => lane.takes.map((take) => take.clipId))).toEqual([
                successor,
            ]);

            pausePlayback();
            mocks.release(pcm(0.5));
            await vi.waitFor(() => expect(commits()).toBe(1));
            await recordingLifecycle.waitForClosing();
            expect(trackStore.value?.tracks[0]?.clips.map((clip) => clip.id)).toEqual([successor]);
        });

        it('retires a held refused start when the scheduler is disposed while the next Play prepares', async () => {
            const admitStart = mocks.startAudioRecording.getMockImplementation();
            if (!admitStart) {
                throw new Error('Expected the recorder fake admission');
            }
            const pausedStart = Promise.withResolvers<boolean>();
            const successorAdmission = Promise.withResolvers<void>();
            mocks.startAudioRecording
                .mockImplementationOnce(() => pausedStart.promise)
                .mockImplementationOnce(async (trackId, callback) => {
                    await successorAdmission.promise;
                    return admitStart(trackId, callback);
                });
            armFirstWindowPunch(null);
            const pausedPlay = startPlayback();
            await vi.waitFor(() => expect(mocks.startAudioRecording).toHaveBeenCalledTimes(1));
            const refused = activeRecordingRef.current[0];
            expect(refused).toBeTruthy();
            pausePlayback();
            await recordingLifecycle.waitForClosing();
            const successorPlay = startPlayback();
            await vi.waitFor(() => expect(mocks.startAudioRecording).toHaveBeenCalledTimes(2));
            pausedStart.resolve(false);
            await pausedPlay;
            // The successor is still preparing, so the refused start's retirement is held.
            expect(trackStore.value?.tracks[0]?.clips.some((clip) => clip.id === refused)).toBe(true);

            disposePlayheadScheduler();

            expect(trackStore.value?.tracks[0]?.clips.some((clip) => clip.id === refused)).toBe(false);
            expect(takeLaneStore.value?.lanes.flatMap((lane) => lane.takes.map((take) => take.clipId))).not.toContain(
                refused
            );

            successorAdmission.resolve();
            await successorPlay;
            pausePlayback();
            mocks.release(pcm(0.5));
            await recordingLifecycle.waitForClosing();
        });

        it.each([
            [
                'a transport field',
                () => {
                    const transport = transportStore.value;
                    if (!transport) {
                        throw new Error('Expected transport state');
                    }
                    transportStore.set({ ...transport, metronomeVolume: transport.metronomeVolume / 2 });
                },
            ],
            [
                'another clip',
                (old: string | undefined) => {
                    const tracks = trackStore.value;
                    if (!tracks) {
                        throw new Error('Expected track state');
                    }
                    trackStore.set({
                        ...tracks,
                        tracks: tracks.tracks.map((track) => ({
                            ...track,
                            clips: track.clips.map((clip) => (clip.id === old ? { ...clip, name: 'Edited' } : clip)),
                        })),
                    });
                },
            ],
        ])('still refuses Play when %s changes before its punch is admitted', async (_, edit) => {
            const admitStart = mocks.startAudioRecording.getMockImplementation();
            if (!admitStart) {
                throw new Error('Expected the recorder fake admission');
            }
            const successorAdmission = Promise.withResolvers<void>();
            mocks.startAudioRecording
                .mockImplementationOnce(admitStart)
                .mockImplementationOnce(async (trackId, callback) => {
                    await successorAdmission.promise;
                    return admitStart(trackId, callback);
                });
            const { old, playing } = await playInsideRegionBehindHeldFlush();
            mocks.release(pcm(0.25));
            await vi.waitFor(() => expect(mocks.startAudioRecording).toHaveBeenCalledTimes(2));
            await vi.waitFor(() => expect(commits()).toBe(1));

            edit(old);
            successorAdmission.resolve();
            // The refusal stops the transport, which flushes the punch it admitted.
            await vi.waitFor(() => expect(mocks.pendingCount()).toBe(1));
            mocks.release(pcm(0.5));
            await playing;

            expect(mocks.notifyUser).toHaveBeenCalledWith(PREPARATION_REFUSAL, 'warning');
            expect(transportStore.value?.isPlaying).toBe(false);
            expect(schedulerSession.punchRecordingActive).toBe(false);
            await recordingLifecycle.waitForClosing();
        });

        it('stops Play quietly without arming a punch when the project root is replaced while it waits', async () => {
            const { playing } = await playInsideRegionBehindHeldFlush();
            const epoch = schedulerSession.discontinuityEpoch;
            replaceProjectRoot();

            mocks.release(pcm(0.25));
            await playing;
            await recordingLifecycle.waitForClosing();

            expect(mocks.notifyUser).not.toHaveBeenCalledWith(PREPARATION_REFUSAL, 'warning');
            expect(mocks.startAudioRecording).toHaveBeenCalledTimes(1);
            expect(schedulerSession.discontinuityEpoch).toBe(epoch);
            expect(schedulerSession.punchRecordingActive).toBe(false);
            expect(activeRecordingRef.current).toEqual([]);
        });

        it('leaves nothing rolling when Stop is pressed while Play waits', async () => {
            const { playing } = await playInsideRegionBehindHeldFlush();
            const epoch = schedulerSession.discontinuityEpoch;
            const stopping = stopPlayback();

            mocks.release(pcm(0.25));
            await Promise.all([playing, stopping]);
            await vi.waitFor(() => expect(commits()).toBe(1));

            expect(mocks.notifyUser).not.toHaveBeenCalledWith(PREPARATION_REFUSAL, 'warning');
            expect(transportStore.value?.isPlaying).toBe(false);
            expect(mocks.startAudioRecording).toHaveBeenCalledTimes(1);
            expect(schedulerSession.discontinuityEpoch).toBe(epoch);
            expect(schedulerSession.punchRecordingActive).toBe(false);
            expect(schedulerSession.worker).toBeNull();
        });
    });
});
