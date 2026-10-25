import { clone as cloneAutomergeDoc, getHeads } from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { createControlledLockManager } from '#/infra/testing/createControlledLockManager';
import { sanitizeTrackSnapshot, takeLaneStore, trackStore, type Track } from '#/modules/Arrangement/stores';
import {
    admitRecordingCaptureClock,
    getArrangementHandlers,
    observeRecordingPassEntry,
    stageRecordingTake,
    stopRecording,
} from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, registerHandlerMap, undoHistoryStore } from '#/modules/Command/stores';
import { clearUndoHistory, resetActionReplayAuthority, setActionHistoryMetadataPort } from '#/modules/Command/useCases';
import { branchStore } from '#/modules/CrdtDocument/stores';
import {
    DOC_PREFIX_ROOT,
    captureProjectRootIdentity,
    createCrdtDoc,
    getCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    replaceCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { transportStore } from '#/modules/Transport/stores';

import { createNativeRecordingPassClock } from '../../playheadScheduler/createNativeRecordingPassClock';
import { createRecordingCaptureClocks } from '../createRecordingCaptureClocks';
import { recordingLifecycle } from '../recordingLifecycle';
import { toggleRecording } from '../toggleRecording';

import type { NativeCaptureBoundary } from '../nativeRecordingCaptureHistory';

const TRACK_ID = 'track-recording';

type StartAudioRecordingFn = (typeof import('#/modules/AudioEngine/useCases'))['startAudioRecording'];
type RecordingTerminal = Parameters<StartAudioRecordingFn>[1];
type StartPlaybackFn = (typeof import('../startPlayback'))['startPlayback'];
type CacheAudioBufferFn = (typeof import('#/modules/AudioEngine/useCases'))['cacheAudioBuffer'];

type CommitRecordingFn = (typeof import('#/modules/Arrangement/useCases'))['commitRecording'];

const mocks = vi.hoisted(() => {
    const audioClock = { currentTime: 0, baseLatency: 0, outputLatency: 0 };
    let capturedAudioTerminal: RecordingTerminal | null = null;
    return {
        audioClock,
        getAudioContext: vi.fn(() => audioClock),
        getCompensationDelay: vi.fn(() => 0),
        cacheAudioBuffer: vi.fn<CacheAudioBufferFn>(),
        notifyUser: vi.fn<(message: string, level: string) => void>(),
        startPlayback: vi.fn<StartPlaybackFn>((onRoll) => {
            // This fixture rolls at admission, before the held terminal returns.
            onRoll?.(audioClock.currentTime, 4);
            return Promise.resolve();
        }),
        startAudioRecording: vi.fn<StartAudioRecordingFn>((_trackId, terminal, _inputId, onCaptureClock) => {
            capturedAudioTerminal = terminal;
            const sampleZeroContextSeconds = audioClock.currentTime;
            onCaptureClock?.(() => ({ status: 'captured', contextSeconds: sampleZeroContextSeconds }));
            return Promise.resolve(true);
        }),
        // The real Stop awaits a recorder flush that settles the capture and
        // invokes its terminal. This mock keeps the terminal captive instead, so
        // the test can move the project to another branch while the outgoing
        // flush is pending — the exact window of #5289 — and release it after.
        stopAudioRecording: vi.fn<() => Promise<void>>(() => Promise.resolve()),
        releaseHeldTerminal: (result: Parameters<RecordingTerminal>[0], nowContextSeconds = 2): void => {
            const terminal = capturedAudioTerminal;
            capturedAudioTerminal = null;
            audioClock.currentTime = nowContextSeconds;
            terminal?.(result);
        },
        // Delegates to the real commit by default (the factory installs the
        // delegation); a case arms mockImplementationOnce to fail one commit.
        commitRecording: vi.fn<CommitRecordingFn>(),
    };
});

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    cacheAudioBuffer: mocks.cacheAudioBuffer,
    getAudioContext: mocks.getAudioContext,
    getCompensationDelay: mocks.getCompensationDelay,
    startAudioRecording: mocks.startAudioRecording,
    stopAudioRecording: mocks.stopAudioRecording,
}));
// The commit seam: the real commit runs unless a case arms one failure, so the
// commit-failure cleanup is drivable after a root replacement without inventing
// document state. Everything else the Arrangement barrel exports stays real,
// including the discard the cleanup guards.
vi.mock('#/modules/Arrangement/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Arrangement/useCases')>();
    mocks.commitRecording.mockImplementation((...args) => actual.commitRecording(...args));
    return {
        ...actual,
        commitRecording: (...args: Parameters<CommitRecordingFn>) => mocks.commitRecording(...args),
    };
});
vi.mock('../startPlayback', () => ({ startPlayback: mocks.startPlayback }));
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: mocks.notifyUser }));

/** PCM starts at admission; completion is delivered two seconds later. */
function completedAudioRecording(
    sampleZeroContextSeconds = 0,
    durationSeconds = 2
): Extract<Parameters<RecordingTerminal>[0], { kind: 'completed' }> {
    const sampleRate = 48000;
    const pcm = Float32Array.from({ length: durationSeconds * sampleRate }, (_value, index) => index);
    const buffer: AudioBuffer = {
        duration: pcm.length / sampleRate,
        length: pcm.length,
        sampleRate,
        numberOfChannels: 1,
        getChannelData: () => pcm,
        copyFromChannel: (target, _channel, offset = 0) => target.set(pcm.subarray(offset, offset + target.length)),
        copyToChannel: (source, _channel, offset = 0) => pcm.set(source, offset),
    };
    return { kind: 'completed', buffer, sampleZeroContextFrame: sampleZeroContextSeconds * sampleRate, sampleRate };
}

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

/** Field-identical replica of Arrangement's TrackDummy fixture, as other
 *  modules' specs keep their own copy rather than deep-importing a foreign
 *  `__tests__` helper. */
function recordingTrack(kind: 'audio' | 'midi'): Track {
    return {
        id: TRACK_ID,
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

function storeClipIds(): string[] {
    return (trackStore.value?.tracks.find((track) => track.id === TRACK_ID)?.clips ?? []).map((clip) => clip.id);
}

/** Clip ids on the installed root document, the durable truth a cross-root write lands in. */
function documentClipIds(): string[] {
    const document = getCrdtDoc<{ tracks: unknown }>(DOC_PREFIX_ROOT);
    if (!document) {
        throw new Error('expected the root document to be installed');
    }
    const tracks = sanitizeTrackSnapshot(document.tracks).tracks;
    return tracks.flatMap((track) => (track.id === TRACK_ID ? (track.clips ?? []).map((clip) => clip.id) : []));
}

/**
 * Model the identity-moving project replacement the guards police — a branch
 * fork or switch installing a different document in the root slot — through
 * the barrel's seam for exactly that (see replaceCrdtDoc). The clone carries
 * whatever the snapshot moment's root held, mirroring a fork's fast copy.
 */
function installRootReplacement(snapshot = getCrdtDoc(DOC_PREFIX_ROOT)): void {
    if (!snapshot) {
        throw new Error('expected the root document to be installed');
    }
    replaceCrdtDoc({ id: DOC_PREFIX_ROOT, doc: cloneAutomergeDoc(snapshot) });
}

function committedEntryCount(): number {
    return (undoHistoryStore.value?.past ?? []).filter(
        (entry) => entry.kind === 'action' && entry.action.type === 'commitRecording'
    ).length;
}

function nativeLoopSnapshot(contextSeconds = 10, loopWraps = 0): NativeCaptureBoundary['outgoing'] {
    const geometry = {
        secondsAtBeat: (beat: number) => beat / 2,
        beatAtSeconds: (seconds: number) => seconds * 2,
        isLooping: true,
        loopStart: 4,
        loopEnd: 8,
    };
    return {
        songSeconds: 2,
        contextSeconds,
        audibleContextSeconds: contextSeconds,
        loopWraps,
        admission: { geometry, admittedBatch: 0, serial: 1, located: false },
        geometry,
        clockIdentity: '1:1',
        uncertaintySeconds: 0,
        calibrationAgeSeconds: 0,
        localUncertaintySeconds: 0,
        quality: 'estimated',
    };
}

function recordingSnapshot(): string {
    return JSON.stringify({
        rootIdentity: captureProjectRootIdentity(),
        rawRoot: getCrdtDoc(DOC_PREFIX_ROOT),
        storeTracks: trackStore.value,
        storeTakeLanes: takeLaneStore.value,
        history: undoHistoryStore.value,
        isRecording: transportStore.value?.isRecording,
    });
}

/** Arm an audio track and open a real recording gesture, so a provisional clip is staged. */
async function startAudioRecordingGesture(): Promise<void> {
    trackStore.set({ tracks: [recordingTrack('audio')], selectedTrackId: TRACK_ID, ghostClips: [] });
    takeLaneStore.set({ lanes: [] });
    transportStore.set({
        ...transportStore.value!,
        isPlaying: false,
        isRecording: false,
        countInEnabled: false,
        punchInEnabled: false,
        playheadPosition: 4,
        tempo: 120,
    });
    flushAutomergeStorageWrites();
    toggleRecording();
    await vi.waitFor(() => {
        expect(storeClipIds()).toHaveLength(1);
    });
    flushAutomergeStorageWrites();
}

describe('recording terminal publishes only under its captured root (issue #5289)', () => {
    beforeEach(() => {
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('recording terminal branch witness');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        // The real branch-state authority sequences every durable write on a
        // Web Lock, and jsdom ships no Web Locks API.
        vi.stubGlobal('navigator', { ...navigator, locks: createControlledLockManager().locks });
        const document = getCrdtDoc(DOC_PREFIX_ROOT);
        if (!document) {
            throw new Error('expected the root document to exist after the storage runtime registered');
        }
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
        registerHandlerMap(getArrangementHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        trackStore.set({ tracks: [recordingTrack('midi')], selectedTrackId: TRACK_ID, ghostClips: [] });
        takeLaneStore.set({ lanes: [] });
        transportStore.set({ ...transportStore.value!, isPlaying: false, isRecording: false, playheadPosition: 8 });
        mocks.notifyUser.mockClear();
        mocks.cacheAudioBuffer.mockClear();
        // vitest keeps mock call history between cases (clearMocks is off), so
        // the held-commit case's wait must observe its own commit entry.
        mocks.commitRecording.mockClear();
        mocks.audioClock.currentTime = 0;
    });

    afterEach(() => {
        recordingLifecycle.endRecording();
        clearHandlerRegistry();
        clearUndoHistory();
        resetActionReplayAuthority();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        takeLaneStore.set({ lanes: [] });
        branchStore.set(null);
        try {
            flushAutomergeStorageWrites();
        } catch {
            // The refused scenario leaves the outgoing branch's optimistic
            // take-lane write queued against a replaced root, and the adapter
            // refuses exactly that on flush — its own protection, not this
            // spec's subject. The port reset below discards the storage.
        }
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
        vi.unstubAllGlobals();
    });

    it('refuses the outgoing terminal after a branch switch, leaving the successor untouched', async () => {
        // The successor snapshot is taken before the take opens, so it holds
        // the track and no recorded clips — the branch that must stay clean.
        const successorSnapshot = getCrdtDoc(DOC_PREFIX_ROOT);
        await startAudioRecordingGesture();

        // Stop's flush is held captive; the project moves to the successor
        // while the outgoing terminal is still pending.
        installRootReplacement(successorSnapshot);
        // The successor forked before the take opened, so its snapshot holds no
        // recorded clips — the branch that must stay clean through the release.
        const successorClipIdsBeforeRelease = documentClipIds();
        expect(successorClipIdsBeforeRelease).toEqual([]);

        mocks.releaseHeldTerminal(completedAudioRecording());
        await vi.waitFor(() => {
            expect(mocks.notifyUser).toHaveBeenCalled();
        });

        expect(documentClipIds()).toEqual(successorClipIdsBeforeRelease);
        expect(committedEntryCount()).toBe(0);
        expect(mocks.cacheAudioBuffer).not.toHaveBeenCalled();
    });

    it('keeps a successor copy of the provisional clip through stale failure cleanup', async () => {
        // The successor is forked after the take opened, and forking installs
        // the successor in the root slot, so its snapshot carries the
        // provisional clip: the old owner's failure cleanup must not delete it
        // out of the successor document.
        await startAudioRecordingGesture();
        installRootReplacement();
        const successorClipsWithProvisional = documentClipIds();
        expect(successorClipsWithProvisional).toHaveLength(1);

        mocks.releaseHeldTerminal({ kind: 'failed', reason: 'worker-crash' });

        // The cleanup the guard gates is an optimistic store write: the document
        // only moves on the next flush, so the live store is the decisive read.
        expect(storeClipIds()).toEqual(successorClipsWithProvisional);
        expect(documentClipIds()).toEqual(successorClipsWithProvisional);
        expect(committedEntryCount()).toBe(0);
        // The notice states what actually ran: no discard happened, so it must
        // not claim one.
        expect(mocks.notifyUser).toHaveBeenCalledWith(
            'Recording failed — the partial take was not kept on this branch.',
            'error'
        );
    });

    it('commits the take on the same root the terminal was opened on', async () => {
        await startAudioRecordingGesture();
        const provisionalId = storeClipIds()[0];
        if (!provisionalId) {
            throw new Error('expected a provisional recording clip');
        }

        mocks.releaseHeldTerminal(completedAudioRecording());
        await vi.waitFor(() => {
            expect(committedEntryCount()).toBe(1);
        });

        expect(mocks.cacheAudioBuffer).toHaveBeenCalled();
        expect(storeClipIds()).toEqual([provisionalId]);
        const clip = trackStore.value!.tracks[0]!.clips[0]!;
        expect(clip).toMatchObject({ id: provisionalId, startBeat: 4, endBeat: 8 });
        expect(mocks.commitRecording.mock.calls[0]?.[1]).toEqual({
            provisionalStartBeat: 4,
            mediaOriginSeconds: 2,
            sourceContextOriginSeconds: 0,
            sourceDurationSeconds: 2,
        });
        const buffer = mocks.cacheAudioBuffer.mock.calls[0]?.[0].buffer;
        if (!buffer) {
            throw new Error('expected the completed PCM to be cached');
        }
        expect(buffer.length).toBe(96000);
        expect(buffer.sampleRate).toBe(48000);
        expect(buffer.getChannelData(0)[95999]).toBe(95999);
    });

    it('keeps the successor clip when the commit itself fails after a branch switch', async () => {
        // The third guarded terminal: the commit-failure cleanup runs after the
        // commit's awaits, by which time a fork may have replaced the root, so
        // its discard must not touch the successor's same-id clip (#5289). The
        // rejection is held until the fork lands, the same captivity trick the
        // audio terminal uses, so the switch happens inside the commit window.
        await startAudioRecordingGesture();
        let rejectCommit: ((error: Error) => void) | undefined;
        mocks.commitRecording.mockImplementationOnce(
            () =>
                new Promise<void>((_resolve, reject) => {
                    rejectCommit = reject;
                })
        );

        mocks.releaseHeldTerminal(completedAudioRecording());
        await vi.waitFor(() => {
            expect(mocks.commitRecording).toHaveBeenCalled();
        });
        installRootReplacement();
        const successorClipsWithProvisional = documentClipIds();
        expect(successorClipsWithProvisional).toHaveLength(1);

        rejectCommit?.(new Error('commit refused'));
        await vi.waitFor(() => {
            expect(mocks.notifyUser).toHaveBeenCalled();
        });

        // The catch's guarded discard never ran: the successor keeps its clip in
        // the live store and the durable document, no entry was recorded, and
        // the notice does not claim a discard that was skipped.
        expect(storeClipIds()).toEqual(successorClipsWithProvisional);
        expect(documentClipIds()).toEqual(successorClipsWithProvisional);
        expect(committedEntryCount()).toBe(0);
        expect(mocks.notifyUser).toHaveBeenCalledWith(
            'Recording failed — the take was not kept on this branch.',
            'error'
        );
    });

    it('keeps the successor untouched through a real native wrap producer', async () => {
        mocks.audioClock.currentTime = 10;
        transportStore.set({ ...transportStore.value!, isLooping: true, loopStart: 4, loopEnd: 8 });
        await startAudioRecordingGesture();
        const originalTakeIds = takeLaneStore.value?.lanes[0]?.takes.map((take) => take.id);
        expect(originalTakeIds).toHaveLength(1);
        expect(recordingLifecycle.readNativeCaptureSourceStart()).toBe(10);
        const initial = nativeLoopSnapshot();
        const passClock = createNativeRecordingPassClock();
        const observed = vi.spyOn(recordingLifecycle, 'observeCaptureClock');
        // This spy forwards the actual method; production observe constructs and publishes the boundary.
        expect(
            passClock.observe(transportStore.value!, { carrier: 'native', status: 'available', snapshot: initial })
        ).toBe(true);
        const outgoingIdentity = captureProjectRootIdentity();
        installRootReplacement();
        const successorIdentity = captureProjectRootIdentity();
        expect(successorIdentity).not.toBe(outgoingIdentity);
        flushAutomergeStorageWrites();
        const successorBefore = recordingSnapshot();
        expect(takeLaneStore.value?.lanes[0]?.takes.map((take) => take.id)).toEqual(originalTakeIds);
        mocks.audioClock.currentTime = 12;
        const wrapped = { ...initial, contextSeconds: 12, audibleContextSeconds: 12, loopWraps: 1 };
        expect(
            passClock.observe(transportStore.value!, { carrier: 'native', status: 'available', snapshot: wrapped })
        ).toBe(true);
        const boundaries = observed.mock.calls.flatMap((call) => (call[6] ? [call[6]] : []));
        expect(boundaries).toHaveLength(1);
        const boundary = boundaries[0]!;
        expect(boundary.outgoing).toBe(wrapped);
        expect(boundary.incoming).toBe(boundary.outgoing);
        expect(boundary).toMatchObject({
            key: '1:1:1:wrap:1',
            contextSeconds: 12,
            endBeat: 8,
            nextPassStartBeat: 4,
            planned: false,
        });
        const storeTakes = takeLaneStore.value?.lanes[0]?.takes.map((take) => take.id);
        flushAutomergeStorageWrites();
        const successorAfter = recordingSnapshot();
        const documentTakes = getCrdtDoc<{ takeLanes: { lanes: Array<{ takes: Array<{ id: string }> }> } }>(
            DOC_PREFIX_ROOT
        )?.takeLanes.lanes[0]?.takes.map((take) => take.id);
        observed.mockRestore();
        mocks.releaseHeldTerminal({ kind: 'failed', reason: 'worker-crash' }, 12);
        expect(storeTakes).toEqual(originalTakeIds);
        expect(documentTakes).toEqual(originalTakeIds);
        expect(successorAfter).toBe(successorBefore);
    });

    it('keeps real native wraps and finite capture endings through an edit on the same root', async () => {
        mocks.audioClock.currentTime = 10;
        transportStore.set({ ...transportStore.value!, isLooping: true, loopStart: 4, loopEnd: 8 });
        await startAudioRecordingGesture();
        const clipId = storeClipIds()[0]!;
        const originalTakeId = takeLaneStore.value!.lanes[0]!.takes[0]!.id;
        const initial = nativeLoopSnapshot();
        const passClock = createNativeRecordingPassClock();
        passClock.observe(transportStore.value!, { carrier: 'native', status: 'available', snapshot: initial });
        const rootIdentity = captureProjectRootIdentity();
        const heads = getHeads(getCrdtDoc(DOC_PREFIX_ROOT)!);
        trackStore.set({
            ...trackStore.value!,
            tracks: trackStore.value!.tracks.map((track) => ({ ...track, name: 'Edited during capture' })),
        });
        flushAutomergeStorageWrites();
        expect(getHeads(getCrdtDoc(DOC_PREFIX_ROOT)!)).not.toEqual(heads);
        expect(captureProjectRootIdentity()).toBe(rootIdentity);

        mocks.audioClock.currentTime = 12;
        passClock.observe(transportStore.value!, {
            carrier: 'native',
            status: 'available',
            snapshot: nativeLoopSnapshot(12, 1),
        });
        expect(takeLaneStore.value!.lanes[0]!.takes).toHaveLength(2);
        recordingLifecycle.endRecording();
        await stopRecording(
            4.5,
            { contextSeconds: 12.25, beatAtContextSeconds: (seconds) => 4 + (seconds - 12) * 2 },
            true
        );
        mocks.releaseHeldTerminal(completedAudioRecording(10, 2.5), 12.5);
        await vi.waitFor(() => expect(committedEntryCount()).toBe(1));

        expect(storeClipIds()).toEqual([clipId]);
        const takes = takeLaneStore.value!.lanes[0]!.takes;
        expect(takes.map((take) => take.id)).toContain(originalTakeId);
        expect(takes.find((take) => take.sourceOffsetBeats === 0)).toMatchObject({
            passDepthSeconds: 0,
            passSourceEndSeconds: 2,
        });
        expect(takes.find((take) => take.id === originalTakeId)).toMatchObject({
            passDepthSeconds: 2,
            passSourceEndSeconds: 2.25,
        });
        expect(mocks.commitRecording.mock.calls[0]?.[1]).toMatchObject({
            sourceContextOriginSeconds: 10,
            sourceDurationSeconds: 2.5,
        });
        expect(mocks.cacheAudioBuffer.mock.calls[0]?.[0].buffer.getChannelData(0)[119999]).toBe(119999);
    });

    it('refuses copied audio owners through browser staging, pass entry, ending and Stop', async () => {
        mocks.audioClock.currentTime = 10;
        transportStore.set({ ...transportStore.value!, isLooping: true, loopStart: 4, loopEnd: 8 });
        await startAudioRecordingGesture();
        const clipId = storeClipIds()[0]!;
        stageRecordingTake({
            trackId: TRACK_ID,
            clipId,
            name: 'Planned',
            startBeat: 4,
            endBeat: 8,
            sourceOffsetBeats: 0,
            passEndContextSeconds: 12,
            plannedPassEnd: true,
        });
        flushAutomergeStorageWrites();
        installRootReplacement();
        const successorBefore = recordingSnapshot();
        const ended = vi.fn();
        const successor = createRecordingCaptureClocks(mocks.audioClock, (beat) => beat / 2, ended);
        successor.create(TRACK_ID).setReader(() => ({ status: 'captured', contextSeconds: 33 }));
        successor.register();

        observeRecordingPassEntry(6, 11, true, true);
        expect(admitRecordingCaptureClock(clipId, 6, 11, () => undefined)).toBeNull();
        stageRecordingTake({
            trackId: TRACK_ID,
            clipId,
            name: 'Foreign wrap',
            startBeat: 4,
            endBeat: 8,
            sourceOffsetBeats: 4,
            passEndContextSeconds: 14,
            plannedPassEnd: true,
        });
        recordingLifecycle.observeCaptureClock(6, 11, true);
        expect(recordingLifecycle.readNativeCaptureSourceStart()).toBe(33);
        recordingLifecycle.endRecording();
        expect(ended).toHaveBeenCalledOnce();
        await stopRecording(7, { contextSeconds: 11.5, beatAtContextSeconds: () => 7 }, true);
        flushAutomergeStorageWrites();
        expect(recordingSnapshot()).toBe(successorBefore);
        mocks.releaseHeldTerminal({ kind: 'failed', reason: 'worker-crash' }, 11.5);
        expect(recordingSnapshot()).toBe(successorBefore);
        expect(mocks.cacheAudioBuffer).not.toHaveBeenCalled();
        expect(mocks.commitRecording).not.toHaveBeenCalled();
    });

    it('refuses to stage the take when the project forks while admission is pending', async () => {
        // The open's own window: the admission await parks on input hardware,
        // and a fork in that window must not receive the provisional clip the
        // staging would write (#5289) — no ghost on the successor, a notice
        // that names the branch move, and no recording engaged.
        trackStore.set({ tracks: [recordingTrack('audio')], selectedTrackId: TRACK_ID, ghostClips: [] });
        takeLaneStore.set({ lanes: [] });
        transportStore.set({
            ...transportStore.value!,
            isPlaying: false,
            isRecording: false,
            countInEnabled: false,
            punchInEnabled: false,
            playheadPosition: 4,
        });
        flushAutomergeStorageWrites();
        let resolveAdmission: ((didStart: boolean) => void) | undefined;
        mocks.startAudioRecording.mockImplementationOnce(
            () =>
                new Promise<boolean>((resolve) => {
                    resolveAdmission = resolve;
                })
        );
        toggleRecording();

        installRootReplacement();

        resolveAdmission?.(true);
        await vi.waitFor(() => {
            expect(mocks.notifyUser).toHaveBeenCalled();
        });

        expect(storeClipIds()).toEqual([]);
        expect(documentClipIds()).toEqual([]);
        expect(committedEntryCount()).toBe(0);
        expect(transportStore.value?.isRecording).toBe(false);
    });
});
