import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getProductionCommandHandlerMaps } from '#/app/getProductionCommandHandlerMaps';
import { MockAudioBuffer } from '#/helpers/__tests__/audioContext.mock';
import { withProjectAudioStorageLock } from '#/infra/storage/withProjectAudioStorageLock';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { createControlledLockManager } from '#/infra/testing/createControlledLockManager';
import { activeRecordingRef, takeLaneStore, trackStore, type Clip, type Track } from '#/modules/Arrangement/stores';
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
} from '#/modules/Command/useCases';
import { actionHistoryStore, branchStore } from '#/modules/CrdtDocument/stores';
import {
    DOC_PREFIX_ROOT,
    clearActionHistory,
    createCrdtDoc,
    markActionHistoryEntryReverted,
    recordActionHistoryEntry,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { defaultMidiStoreState, midiStore, type MidiNote } from '#/modules/MIDI/stores';
import {
    defaultTransportState,
    tempoMapStore,
    timeSignatureMapStore,
    transportStore,
} from '#/modules/Transport/stores';

import { disposePlayheadScheduler } from '../../playheadScheduler/disposePlayheadScheduler';
import { schedulerSession } from '../../playheadScheduler/schedulerSession';
import { scheduleAudioClips } from '../../scheduling/scheduleAudioClips';
import { executePlayheadSeek } from '../../transportControls/executePlayheadSeek';
import { pausePlayback } from '../../transportControls/pausePlayback';
import { recordingLifecycle } from '../../transportControls/recordingLifecycle';
import { startPlayback } from '../../transportControls/startPlayback';

/**
 * Play's initial-playback witness refuses only when an input the prepared
 * programme read has changed (#6012). The Yeast preparation is the long wait:
 * one Worker round trip per Yeast track, held pending here, while the real
 * recorder commit and the real stores move around it.
 */

const AUDIO_TRACK_ID = 'track-audio';
const YEAST_TRACK_ID = 'track-yeast';
const YEAST_CLIP_ID = 'clip-yeast';
const SESSION_KEY = 'sourdaw-undo-session';
const PREPARATION_REFUSAL = 'Playback changed while preparing. Press Play again.';
const testAudioDatabase = new IDBFactory();
type RecordingTerminal = Parameters<typeof import('#/modules/AudioEngine/useCases').startAudioRecording>[1];
type ProcessYeastMidi = typeof import('#/modules/Yeast/useCases').processYeastMidi;
const mocks = vi.hoisted(() => {
    const audioClock = { currentTime: 0, baseLatency: 0, outputLatency: 0, sampleRate: 48_000 };
    type RecorderSession = {
        trackId: string;
        callback: RecordingTerminal;
        status: 'recording' | 'stopping';
        flushed: Promise<void>;
        settle: () => void;
    };
    // One session per track; a stop flushes only sessions still recording and
    // holds the flush until the spec releases it.
    const recorder = {
        sessions: new Map<string, RecorderSession>(),
        heldFlushes: [] as RecorderSession[],
    };
    function admitStart(trackId: string, callback: RecordingTerminal): Promise<boolean> {
        if (recorder.sessions.has(trackId)) {
            return Promise.resolve(false);
        }
        const flush = Promise.withResolvers<void>();
        recorder.sessions.set(trackId, {
            trackId,
            callback,
            status: 'recording',
            flushed: flush.promise,
            settle: flush.resolve,
        });
        return Promise.resolve(true);
    }
    function stopSessions(): Promise<void> {
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
        notifyUser: vi.fn<(message: string, level: string) => void>(),
        processYeastMidi: vi.fn<ProcessYeastMidi>(async (input) => [...input.events]),
        startAudioRecording: vi.fn<(trackId: string, callback: RecordingTerminal) => Promise<boolean>>(admitStart),
        stopAudioRecording: vi.fn<() => Promise<void>>(stopSessions),
        reset(): void {
            recorder.sessions = new Map();
            recorder.heldFlushes = [];
        },
        pendingCount(): number {
            return recorder.heldFlushes.length;
        },
        release(buffer: AudioBuffer): void {
            const session = recorder.heldFlushes.shift();
            if (!session) {
                throw new Error('Expected a held recorder flush');
            }
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
    getCompensationDelay: vi.fn(() => 0),
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
// The Worker round trip `prepareYeastTrackNotes` awaits; everything above it
// (the window resolution, the witness, the scheduler) runs for real.
vi.mock('#/modules/Yeast/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Yeast/useCases')>()),
    processYeastMidi: mocks.processYeastMidi,
    yeastPanic: vi.fn(() => Promise.resolve()),
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

function track(id: string, kind: 'audio' | 'midi', fields: Partial<Track>): Track {
    return {
        id,
        name: kind === 'audio' ? 'Audio' : 'Yeast',
        kind,
        muted: false,
        soloed: false,
        armed: false,
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
        ...fields,
    };
}

function yeastClip(): Clip {
    return {
        id: YEAST_CLIP_ID,
        trackId: YEAST_TRACK_ID,
        name: 'Arpeggio',
        type: 'midi',
        startBeat: 0,
        endBeat: 4,
        midiOffsetBeats: 0,
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: '#00ff00',
        locked: false,
        muted: false,
    };
}

function yeastNote(pitch: number): MidiNote {
    return { id: `note-${pitch}`, pitch, startBeat: 0, duration: 0.5, velocity: 100 };
}

/** An armed audio track beside a Yeast MIDI track whose clip sounds from beat 0. */
function seedProject(): void {
    trackStore.set({
        tracks: [
            track(AUDIO_TRACK_ID, 'audio', { armed: true }),
            track(YEAST_TRACK_ID, 'midi', {
                devices: [{ id: 'yeast-rack', name: 'Yeast', type: 'yeast', bypassed: false, parameterValues: {} }],
                clips: [yeastClip()],
            }),
        ],
        selectedTrackId: AUDIO_TRACK_ID,
        ghostClips: [],
    });
    takeLaneStore.set({ lanes: [] });
    midiStore.set({ ...defaultMidiStoreState, notesByClipId: { [YEAST_CLIP_ID]: [yeastNote(60)] } });
    tempoMapStore.set({ changes: [] });
    timeSignatureMapStore.set({ changes: [] });
    flushAutomergeStorageWrites();
}

async function tick(): Promise<void> {
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
                sequence: 1,
                scheduledAtMs: now - 2,
                sentAtMs: now - 1,
            },
        })
    );
    await vi.waitFor(() => {
        expect(mocks.startAudioRecording).toHaveBeenCalledTimes(1);
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

function audioClip(clipId: string | undefined) {
    return trackStore.value?.tracks
        .find((candidate) => candidate.id === AUDIO_TRACK_ID)
        ?.clips.find((clip) => clip.id === clipId);
}

/** Punch-record over beats 4–8, then Pause with the take's flush held. */
async function pauseHeldPunch(): Promise<string | undefined> {
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
    flushAutomergeStorageWrites();
    await startPlayback();
    await tick();
    expect(schedulerSession.punchRecordingActive).toBe(true);
    const old = activeRecordingRef.current[0];
    expect(old).toBeTruthy();
    pausePlayback();
    expect(mocks.pendingCount()).toBe(1);
    return old;
}

/** Hold the next Yeast Worker round trip until the returned release runs. */
function holdYeastPreparation(): { started: () => boolean; release: () => void } {
    const ready = Promise.withResolvers<void>();
    let started = false;
    mocks.processYeastMidi.mockImplementationOnce(async (input) => {
        started = true;
        await ready.promise;
        return [...input.events];
    });
    return { started: () => started, release: () => ready.resolve() };
}

/** Play from beat 0, outside the punch region, with the Yeast preparation held pending. */
async function playOutsideRegionWhileYeastPrepares() {
    await executePlayheadSeek(0);
    const yeast = holdYeastPreparation();
    const playing = startPlayback();
    await vi.waitFor(() => expect(yeast.started()).toBe(true));
    return { yeast, playing };
}

describe('initial playback witness reads only the prepared inputs (#6012)', () => {
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
        resetCrdtProjectAuthority('initial playback witness inputs');
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
        seedProject();
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
        }
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
        midiStore.set(defaultMidiStoreState);
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('keeps Play rolling and the take when the earlier punch commits while Yeast prepares', async () => {
        const buffer = pcm(0.25);
        const old = await pauseHeldPunch();
        const { yeast, playing } = await playOutsideRegionWhileYeastPrepares();

        mocks.release(buffer);
        await vi.waitFor(() => expect(commits()).toBe(1));
        expect(audioClip(old)?.audioBufferId, 'the take committed inside the preparation').toMatch(/^rec-/);
        yeast.release();
        await playing;

        expect(mocks.notifyUser).not.toHaveBeenCalledWith(PREPARATION_REFUSAL, 'warning');
        expect(transportStore.value?.isPlaying, 'Play keeps rolling').toBe(true);
        expect(schedulerSession.worker, 'the roll started its scheduler').not.toBeNull();
        expect(schedulerSession.punchRecordingActive).toBe(false);
        expect(actionHistoryStore.value?.entries).toHaveLength(1);
        const committed = audioClip(old);
        expect(committed?.startBeat).toBe(4);
        expect(getCachedAudioBuffer({ bufferId: committed?.audioBufferId ?? '' }) === buffer).toBe(true);
        expect(takeLaneStore.value?.lanes.flatMap((lane) => lane.takes.map((take) => take.clipId))).toEqual([old]);
    });

    it.each([
        [
            'its clip notes',
            () => {
                const midi = midiStore.value;
                if (!midi) {
                    throw new Error('Expected MIDI state');
                }
                midiStore.set({ ...midi, notesByClipId: { ...midi.notesByClipId, [YEAST_CLIP_ID]: [yeastNote(64)] } });
            },
        ],
        [
            'its clip placement',
            () => {
                const tracks = trackStore.value;
                if (!tracks) {
                    throw new Error('Expected track state');
                }
                trackStore.set({
                    ...tracks,
                    tracks: tracks.tracks.map((candidate) => ({
                        ...candidate,
                        clips: candidate.clips.map((clip) =>
                            clip.id === YEAST_CLIP_ID ? { ...clip, startBeat: 0.25 } : clip
                        ),
                    })),
                });
            },
        ],
    ])('still refuses Play when the Yeast track changes %s while it prepares', async (_, edit) => {
        await pauseHeldPunch();
        const { yeast, playing } = await playOutsideRegionWhileYeastPrepares();
        mocks.release(pcm(0.25));
        await vi.waitFor(() => expect(commits()).toBe(1));

        edit();
        yeast.release();
        await playing;

        expect(mocks.notifyUser).toHaveBeenCalledWith(PREPARATION_REFUSAL, 'warning');
        expect(transportStore.value?.isPlaying).toBe(false);
        expect(schedulerSession.worker).toBeNull();
        expect(commits(), 'the earlier take is still kept').toBe(1);
    });

    // Audio clips are not prepared: the initial emission reads them from the
    // live store in the same turn it emits the prepared MIDI, so an audio edit
    // made while Yeast prepares is what the roll plays, and refusing it would
    // protect nothing.
    it('keeps Play rolling and emits the edit when another track’s audio clip changes while Yeast prepares, because audio is read live', async () => {
        const old = await pauseHeldPunch();
        const { yeast, playing } = await playOutsideRegionWhileYeastPrepares();
        mocks.release(pcm(0.25));
        await vi.waitFor(() => expect(commits()).toBe(1));
        const tracks = trackStore.value;
        if (!tracks) {
            throw new Error('Expected track state');
        }
        trackStore.set({
            ...tracks,
            tracks: tracks.tracks.map((candidate) => ({
                ...candidate,
                clips: candidate.clips.map((clip) => (clip.id === old ? { ...clip, gain: 0.5 } : clip)),
            })),
        });
        const emittedGains: Array<number | undefined> = [];
        vi.mocked(scheduleAudioClips).mockImplementation(() => {
            emittedGains.push(audioClip(old)?.gain);
        });

        yeast.release();
        await playing;

        expect(mocks.notifyUser).not.toHaveBeenCalledWith(PREPARATION_REFUSAL, 'warning');
        expect(transportStore.value?.isPlaying).toBe(true);
        expect(emittedGains, 'the initial emission read the edited clip').toEqual([0.5]);
    });

    // Tempo is pinned by 'retires a refused first-window start when the initial
    // emission goes stale' (punchPausePlayCommand.integration.spec.ts); the
    // meter is read only by the Yeast preparation and has no other pin.
    it('still refuses Play when the meter changes while Yeast prepares', async () => {
        transportStore.set({ ...defaultTransportState, tempo: 120, isPlaying: false, playheadPosition: 0 });
        flushAutomergeStorageWrites();
        const yeast = holdYeastPreparation();
        const playing = startPlayback();
        await vi.waitFor(() => expect(yeast.started()).toBe(true));

        timeSignatureMapStore.set({ changes: [{ id: 'meter', beat: 0, numerator: 3, denominator: 4 }] });
        yeast.release();
        await playing;

        expect(mocks.notifyUser).toHaveBeenCalledWith(PREPARATION_REFUSAL, 'warning');
        expect(transportStore.value?.isPlaying).toBe(false);
    });
});
