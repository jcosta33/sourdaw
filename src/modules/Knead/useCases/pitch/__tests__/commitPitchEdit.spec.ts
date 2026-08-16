import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { logger } from '#/infra/logger/appLogger';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
    runWithAutomergeStorageTransaction,
} from '#/infra/store/storage/createAutomergeStorage';
import { trackStore, type Clip, type Track, type TrackStoreState } from '#/modules/Arrangement/stores';
import { clearHandlerRegistry, registerHandlerMap, undoStore } from '#/modules/Command/stores';
import { clearUndoHistory, executeAppAction, redo, undo } from '#/modules/Command/useCases';
import { type AppAction } from '#/utils/handlerContract';
import { notifyUser } from '#/utils/Notification/notifyUser';

import {
    defaultKneadState,
    kneadStore,
    type KneadClipState,
    type NoteBlob,
    type PitchContour,
} from '../../../stores/kneadStore';
import { getPitchHandlers } from '../../getPitchHandlers';
import { commitPitchEdit } from '../commitPitchEdit';
import { setPitchEditDependencies } from '../pitchEditDependencies';

vi.mock('#/infra/logger/appLogger', () => ({
    logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const mockNotificationEventBus = {
    emit: vi.fn().mockResolvedValue(undefined),
};

const commitPitchEditMock = vi.fn();

type PitchEditTestClip = Clip & {
    fileId?: string;
};

function createClip(overrides: Partial<PitchEditTestClip>): PitchEditTestClip {
    return {
        id: 'clip-1',
        trackId: 't1',
        name: 'Clip 1',
        startBeat: 0,
        endBeat: 4,
        type: 'audio',
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: '#ff0000',
        locked: false,
        muted: false,
        ...overrides,
    };
}

function createTrack(overrides: Partial<Track>): Track {
    return {
        id: 't1',
        name: 'Track 1',
        kind: 'audio',
        muted: false,
        soloed: false,
        armed: false,
        gain: 0.8,
        pan: 0,
        color: '#ff0000',
        clips: [],
        devices: [],
        sends: [],
        midiFx: [],
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
        ...overrides,
    };
}

function getFirstClipFileId(): string | undefined {
    const clip = trackStore.value?.tracks[0]?.clips[0];
    if (!clip || !('fileId' in clip)) {
        return undefined;
    }

    if (typeof clip.fileId !== 'string') {
        return undefined;
    }

    return clip.fileId;
}

const contour = { points: [], sample_rate: 44100, hop_size: 256, algorithm: 'pyin' };
const segments = [{ start_time_ms: 0, end_time_ms: 100, shift_semitones: 1 }];

const storedContour: PitchContour = {
    points: [{ time_ms: 0, frequency_hz: 220, confidence: 0.9, voiced: true }],
    sample_rate: 48000,
    hop_size: 256,
};

// The clip is seeded with `fileId: 'test.wav'`, so the render writes
// `test_pitch.wav` and caches it under this id.
const RENDERED_BUFFER_ID = 'audio-pitch:test_pitch.wav';

const storedBlob: NoteBlob = {
    id: 'blob-1',
    startTime: 0,
    endTime: 0.5,
    pitchCenterCents: 6300,
    originalPitchCenterCents: 6000,
    pitchCurveCents: [],
    voicedConfidence: 0.9,
    driftPercent: 0,
    vibratoDepthPercent: 0,
    vibratoRateHz: 0,
    formantShiftCents: 0,
    gainDb: 0,
    muted: false,
};

const storedClipState: KneadClipState = {
    clipId: 'c1',
    blobs: [storedBlob],
    retuneSpeedMs: 25,
    toleranceCents: 0,
    toleranceTimeMs: 0,
    humanizePercent: 40,
    formantPreserve: true,
};

function getFirstClipAudioBufferId(): string | undefined {
    return trackStore.value?.tracks[0]?.clips[0]?.audioBufferId;
}

function commitAction(clipId: string): Extract<AppAction, { type: 'commitPitchEdit' }> {
    return { type: 'commitPitchEdit', payload: { clipId, segments, contour } };
}

describe('commitPitchEdit through action dispatch', () => {
    beforeEach(() => {
        injectDependencies(notifyUser, { eventBus: mockNotificationEventBus });
        vi.clearAllMocks();
        configureAutomergeStoragePort(null);
        clearHandlerRegistry();
        registerHandlerMap(getPitchHandlers());
        clearUndoHistory();
        setPitchEditDependencies({ commitPitchEdit: commitPitchEditMock });
        commitPitchEditMock.mockResolvedValue({ renderedAudioBufferId: RENDERED_BUFFER_ID });

        const clipOverrides: Partial<PitchEditTestClip>[] = [
            { id: 'c1', type: 'audio', fileId: 'test.wav', audioBufferId: 'buffer-c1' },
            { id: 'c2', type: 'midi', fileId: undefined },
        ];
        const state = {
            tracks: [
                createTrack({
                    clips: clipOverrides.map((clip) => createClip(clip)),
                }),
            ],
            selectedTrackId: 't1',
            ghostClips: [],
        } satisfies TrackStoreState;
        trackStore.set(state);
        kneadStore.set({ ...defaultKneadState, contours: { c1: storedContour }, clips: { c1: storedClipState } });
    });

    afterEach(() => {
        clearUndoHistory();
        clearHandlerRegistry();
        configureAutomergeStoragePort(null);
    });

    it('describes a restoreClipFileId inverse that captures everything the commit consumes', () => {
        expect(getPitchHandlers().commitPitchEdit.describe(commitAction('c1'))).toEqual({
            label: 'Commit Pitch Edit',
            inverseAction: {
                type: 'restoreClipFileId',
                payload: {
                    clipId: 'c1',
                    fileId: 'test.wav',
                    audioBufferId: 'buffer-c1',
                    blobs: [storedBlob],
                    contour: storedContour,
                },
            },
        });
    });

    it('dispatch renders the edit, swaps the file pointer, and pushes a real undo entry that undo restores', async () => {
        await executeAppAction(commitAction('c1'));

        expect(commitPitchEditMock).toHaveBeenCalledWith({
            inputAudioPath: 'test.wav',
            outputAudioPath: 'test_pitch.wav',
            outputAudioBufferId: RENDERED_BUFFER_ID,
            audioBufferId: 'buffer-c1',
            segments,
            contour,
        });
        expect(getFirstClipFileId()).toBe('test_pitch.wav');

        expect(undoStore.value?.past).toHaveLength(1);
        // Redo re-dispatches the forward action below, proving this is an action-kind
        // entry that flows through executeAppAction (a callback swap would not re-render).
        expect(undoStore.value?.past[0]?.label).toBe('Commit Pitch Edit');
        expect(undoStore.value?.future).toHaveLength(0);

        await undo();

        expect(getFirstClipFileId()).toBe('test.wav');
        expect(undoStore.value?.past).toHaveLength(0);
        expect(undoStore.value?.future).toHaveLength(1);

        await redo();

        expect(getFirstClipFileId()).toBe('test_pitch.wav');
        expect(undoStore.value?.past).toHaveLength(1);
        expect(undoStore.value?.future).toHaveLength(0);
        // Redo re-ran the forward render, confirming action-based (not callback) undo.
        expect(commitPitchEditMock).toHaveBeenCalledTimes(2);
    });

    // Playback, export, `collectProjectAudioBufferIds` and the next pitch analysis all
    // resolve a clip's audio through `audioBufferId`; nothing reads `fileId` at all in
    // the browser realm. A commit that moved only the file pointer was therefore
    // inaudible, and the render it produced was referenced by nothing — not even saved
    // with the project.
    it('repoints the clip at the rendered buffer after a successful commit', async () => {
        expect(getFirstClipAudioBufferId()).toBe('buffer-c1');

        await executeAppAction(commitAction('c1'));

        expect(getFirstClipAudioBufferId()).toBe(RENDERED_BUFFER_ID);
        expect(getFirstClipFileId()).toBe('test_pitch.wav');
    });

    // The native path writes a file and decodes nothing into this realm's cache, so
    // there is no buffer to point at; repointing at an uncached key would silence the
    // clip outright.
    it('leaves the clip audio buffer alone when the render decoded nothing', async () => {
        commitPitchEditMock.mockResolvedValue({ renderedAudioBufferId: null });

        await executeAppAction(commitAction('c1'));

        expect(getFirstClipAudioBufferId()).toBe('buffer-c1');
        expect(getFirstClipFileId()).toBe('test_pitch.wav');
    });

    it('clears the clip pitch contour after a successful commit so the editor gate re-opens', async () => {
        expect(kneadStore.value?.contours.c1).toEqual(storedContour);

        await executeAppAction(commitAction('c1'));

        expect(commitPitchEditMock).toHaveBeenCalled();
        expect(kneadStore.value?.contours.c1).toBeUndefined();
    });

    // The blobs are the live pitch shift the Knead worklet keeps applying. Left
    // standing over freshly baked audio they apply the same shift a second time, and
    // because the editor treats a clip with blobs as already analysed they also hold
    // the analysis gate shut forever — one pitch edit per clip, silently, for good.
    it('clears the clip pitch blobs after a successful commit', async () => {
        expect(kneadStore.value?.clips.c1?.blobs).toEqual([storedBlob]);

        await executeAppAction(commitAction('c1'));

        expect(kneadStore.value?.clips.c1?.blobs).toEqual([]);
        // Mirrored onto the clip too: `kneadState` is what persistence and collaboration
        // read, so a Knead-store-only clear would come straight back on the next load.
        expect(trackStore.value?.tracks[0]?.clips[0]?.kneadState?.blobs).toEqual([]);
    });

    it('undo gives back the buffer, the blobs and the contour, not just the file pointer', async () => {
        await executeAppAction(commitAction('c1'));

        expect(getFirstClipAudioBufferId()).toBe(RENDERED_BUFFER_ID);
        expect(kneadStore.value?.clips.c1?.blobs).toEqual([]);

        await undo();

        expect(getFirstClipFileId()).toBe('test.wav');
        expect(getFirstClipAudioBufferId()).toBe('buffer-c1');
        expect(kneadStore.value?.clips.c1?.blobs).toEqual([storedBlob]);
        expect(kneadStore.value?.contours.c1).toEqual(storedContour);
        expect(trackStore.value?.tracks[0]?.clips[0]?.kneadState?.blobs.map((blob) => blob.id)).toEqual(['blob-1']);

        await redo();

        expect(getFirstClipAudioBufferId()).toBe(RENDERED_BUFFER_ID);
        expect(kneadStore.value?.clips.c1?.blobs).toEqual([]);
        expect(kneadStore.value?.contours.c1).toBeUndefined();
    });

    it('keeps the clip pitch contour when the render fails', async () => {
        commitPitchEditMock.mockRejectedValueOnce(new Error('test error'));

        await expect(executeAppAction(commitAction('c1'))).rejects.toThrow('test error');

        expect(kneadStore.value?.contours.c1).toEqual(storedContour);
    });

    it('notifies the user and records no undo entry when the render fails', async () => {
        commitPitchEditMock.mockRejectedValueOnce(new Error('test error'));

        await expect(executeAppAction(commitAction('c1'))).rejects.toThrow('test error');

        expect(logger.error).toHaveBeenCalledWith(new Error('test error'));
        expect(mockNotificationEventBus.emit).toHaveBeenCalledWith('ui.notify', {
            message: 'Failed to commit pitch edit',
            level: 'error',
        });
        expect(getFirstClipFileId()).toBe('test.wav');
        expect(undoStore.value?.past).toHaveLength(0);
    });

    it('does not render for a non-audio clip', async () => {
        await executeAppAction(commitAction('c2'));
        expect(commitPitchEditMock).not.toHaveBeenCalled();
    });

    it('does not render for a missing clip', async () => {
        await executeAppAction(commitAction('missing'));
        expect(commitPitchEditMock).not.toHaveBeenCalled();
    });

    it('does not render when there are no tracks', async () => {
        trackStore.set(null);
        await executeAppAction(commitAction('c1'));
        expect(commitPitchEditMock).not.toHaveBeenCalled();
    });
});

// Audit CC-10 — `commitPitchEdit` writes the clip's new file pointer and drops
// the stale contour AFTER `await renderPitchEdit`. Those writes used to run
// outside the action's storage transaction: they got their own commit owner and
// their own animation frame, so the action's commit did not carry them and the
// action's abort did not discard them. A render that succeeded left the clip
// pointing at the rendered file even when the action it belonged to was rolled
// back.
describe('commitPitchEdit storage transaction scope (audit CC-10)', () => {
    let doc: Record<string, unknown>;
    let mutations: number;

    beforeEach(() => {
        injectDependencies(notifyUser, { eventBus: mockNotificationEventBus });
        vi.clearAllMocks();
        clearHandlerRegistry();
        registerHandlerMap(getPitchHandlers());
        clearUndoHistory();
        setPitchEditDependencies({ commitPitchEdit: commitPitchEditMock });
        commitPitchEditMock.mockResolvedValue({ renderedAudioBufferId: RENDERED_BUFFER_ID });

        doc = {};
        mutations = 0;
        configureAutomergeStoragePort({
            getDoc: () => doc,
            getSemanticMessage: () => undefined,
            hasDoc: () => true,
            mutateDoc: ({ changeFn }) => {
                changeFn(doc);
                mutations += 1;
            },
        });

        trackStore.set({
            tracks: [
                createTrack({
                    clips: [createClip({ id: 'c1', type: 'audio', fileId: 'test.wav', audioBufferId: 'buffer-c1' })],
                }),
            ],
            selectedTrackId: 't1',
            ghostClips: [],
        } satisfies TrackStoreState);
        kneadStore.set({ ...defaultKneadState, contours: { c1: storedContour }, clips: { c1: storedClipState } });

        // Commit the seed so the transaction below starts from a persisted
        // baseline rather than from pending writes.
        flushAutomergeStorageWrites();
        mutations = 0;
    });

    afterEach(() => {
        clearUndoHistory();
        clearHandlerRegistry();
        configureAutomergeStoragePort(null);
    });

    it('discards the rendered file pointer and the contour drop when the action aborts', async () => {
        const transaction = runWithAutomergeStorageTransaction(undefined, () =>
            commitPitchEdit({ clipId: 'c1', segments, contour })
        );
        if (transaction.status !== 'returned') {
            throw transaction.error;
        }
        await transaction.value;

        transaction.abort();
        flushAutomergeStorageWrites();

        // The render happened, but the action was rolled back — so neither
        // post-render write may survive it.
        expect(commitPitchEditMock).toHaveBeenCalledOnce();
        expect(getFirstClipFileId()).toBe('test.wav');
        expect(kneadStore.value?.contours.c1).toEqual(storedContour);
        expect(mutations).toBe(0);
    });

    it('carries both post-render writes in the action’s own single change', async () => {
        const transaction = runWithAutomergeStorageTransaction(undefined, () =>
            commitPitchEdit({ clipId: 'c1', segments, contour })
        );
        if (transaction.status !== 'returned') {
            throw transaction.error;
        }
        await transaction.value;

        transaction.commit();

        // One change for the whole action: the clip swap and the contour drop
        // share it, rather than landing later on their own frame.
        expect(mutations).toBe(1);
        expect(getFirstClipFileId()).toBe('test_pitch.wav');
        expect(kneadStore.value?.contours.c1).toBeUndefined();
    });
});
