import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { clearHandlerRegistry, macroStore, registerHandlerMap, undoHistoryStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    redo,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
    undo,
} from '#/modules/Command/useCases';
import {
    createCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { transportStore } from '#/modules/Transport/stores';

import { TrackDummy } from '../../../__tests__/TrackDummy';
import { createTake, createTakeLane } from '../../../models/TakeLane';
import { type Clip } from '../../../models/Track';
import { takeLaneStore } from '../../../stores/takeLaneStore';
import { trackStore } from '../../../stores/trackStore';
import { getArrangementHandlers } from '../../../useCases/getArrangementHandlers';
import { commitRecording } from '../../../useCases/recording/commitRecording';
import { stageRecordingTake } from '../../../useCases/recording/stageRecordingTake';
import { startRecording } from '../../../useCases/recording/startRecording';
import { updateTrack } from '../../../useCases/updateTrack';

const TRACK_ID = 'track-audio';

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

function clipIds(): string[] {
    return (trackStore.value?.tracks.find((track) => track.id === TRACK_ID)?.clips ?? []).map((clip) => clip.id);
}

function takeRefs(): { id: string; clipId: string }[] {
    return (takeLaneStore.value?.lanes ?? []).flatMap((lane) =>
        lane.takes.map((take) => ({ id: take.id, clipId: take.clipId }))
    );
}

function laneIds(): string[] {
    return (takeLaneStore.value?.lanes ?? []).map((lane) => lane.id);
}

function findClip(clipId: string): Clip | undefined {
    return trackStore.value?.tracks.flatMap((track) => track.clips).find((clip) => clip.id === clipId);
}

/**
 * Issue #4439 slice 1 end to end: one recording gesture commits the recorded
 * clip, its placement, and its take-lane membership as ONE entry through the
 * owning command path. The real handlers and undo machinery run — the recorder,
 * the commit action, and the replay are all production code, so a history
 * assertion on store state alone would not prove the split is closed.
 */
describe('recording gesture commit (issue #4439)', () => {
    beforeEach(() => {
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('recording gesture commit integration');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        trackStore.set({
            tracks: [TrackDummy.create({ id: TRACK_ID, kind: 'audio', armed: true, clips: [] })],
            selectedTrackId: TRACK_ID,
            ghostClips: [],
        });
        takeLaneStore.set({ lanes: [] });
        transportStore.set({ ...transportStore.value!, playheadPosition: 4 });
    });

    afterEach(() => {
        clearHandlerRegistry();
        clearUndoHistory();
        resetActionReplayAuthority();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        takeLaneStore.set({ lanes: [] });
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it('commits a successful capture as exactly one action entry', async () => {
        const [provisional] = startRecording(4);
        if (!provisional) {
            throw new Error('expected a provisional recording clip');
        }
        flushAutomergeStorageWrites();

        await commitRecording({ ...provisional, audioBufferId: 'rec-buffer-1', startBeat: 4, endBeat: 6 });
        flushAutomergeStorageWrites();

        const past = undoHistoryStore.value?.past ?? [];
        expect(past).toHaveLength(1);
        const entry = past[0];
        if (entry?.kind !== 'action') {
            throw new Error('expected exactly one action history entry');
        }
        expect(entry.action.type).toBe('commitRecording');
        expect(entry.inverseAction?.type).toBe('discardRecording');
        expect(entry.redoAction?.type).toBe('restoreRecording');
    });

    it('removes the clip, its placement, and its take membership on one undo, and restores the same identities on redo', async () => {
        const [provisional] = startRecording(4);
        if (!provisional) {
            throw new Error('expected a provisional recording clip');
        }
        flushAutomergeStorageWrites();
        const recordedTakeId = takeRefs()[0]?.id;
        expect(recordedTakeId).toBeTruthy();

        await commitRecording({ ...provisional, audioBufferId: 'rec-buffer-1', startBeat: 4, endBeat: 6 });
        flushAutomergeStorageWrites();
        expect(clipIds()).toEqual([provisional.id]);
        expect(takeRefs()).toEqual([{ id: recordedTakeId, clipId: provisional.id }]);

        await undo();
        flushAutomergeStorageWrites();
        expect(clipIds()).toEqual([]);
        expect(takeRefs()).toEqual([]);
        expect(laneIds()).toEqual([]);

        await redo();
        flushAutomergeStorageWrites();
        expect(findClip(provisional.id)).toMatchObject({
            id: provisional.id,
            startBeat: 4,
            endBeat: 6,
            audioBufferId: 'rec-buffer-1',
        });
        expect(takeRefs()).toEqual([{ id: recordedTakeId, clipId: provisional.id }]);
    });

    it('keeps a pre-existing take lane and its unrelated take through undo and redo', async () => {
        const unrelatedClip: Clip = {
            id: 'clip-other',
            trackId: TRACK_ID,
            name: 'Other',
            startBeat: 0,
            endBeat: 4,
            type: 'audio',
            fadeInBeats: 0,
            fadeOutBeats: 0,
            gain: 1,
            color: '',
            locked: false,
            muted: false,
        };
        trackStore.set({
            tracks: [TrackDummy.create({ id: TRACK_ID, kind: 'audio', armed: true, clips: [unrelatedClip] })],
            selectedTrackId: TRACK_ID,
            ghostClips: [],
        });
        const unrelatedTake = createTake('clip-other', 'Take 1', 0, 4);
        takeLaneStore.set({ lanes: [{ ...createTakeLane(TRACK_ID), takes: [unrelatedTake] }] });
        flushAutomergeStorageWrites();

        const [provisional] = startRecording(4);
        if (!provisional) {
            throw new Error('expected a provisional recording clip');
        }
        flushAutomergeStorageWrites();
        const recordedTakeId = takeRefs().find((take) => take.clipId === provisional.id)?.id;
        expect(recordedTakeId).toBeTruthy();

        await commitRecording({ ...provisional, audioBufferId: 'rec-buffer-1', startBeat: 4, endBeat: 6 });
        flushAutomergeStorageWrites();
        expect(takeRefs()).toEqual([
            { id: unrelatedTake.id, clipId: 'clip-other' },
            { id: recordedTakeId, clipId: provisional.id },
        ]);

        await undo();
        flushAutomergeStorageWrites();
        expect(clipIds()).toEqual(['clip-other']);
        expect(takeRefs()).toEqual([{ id: unrelatedTake.id, clipId: 'clip-other' }]);
        expect(laneIds()).toHaveLength(1);

        await redo();
        flushAutomergeStorageWrites();
        expect(takeRefs()).toEqual([
            { id: unrelatedTake.id, clipId: 'clip-other' },
            { id: recordedTakeId, clipId: provisional.id },
        ]);
    });

    it('commits nothing for a capture that never completes', async () => {
        const [provisional] = startRecording(4);
        if (!provisional) {
            throw new Error('expected a provisional recording clip');
        }
        flushAutomergeStorageWrites();

        expect(undoHistoryStore.value).not.toBeNull();
        expect(undoHistoryStore.value?.past ?? []).toHaveLength(0);

        // Undo has no entry to replay, so the provisional clip stands exactly as
        // the recorder left it — an incomplete capture never becomes a replayable
        // entry, and the failure path retires it through `removeClip` instead.
        await undo();
        flushAutomergeStorageWrites();
        expect(clipIds()).toEqual([provisional.id]);
    });

    it('removes and restores every take the one gesture captured', async () => {
        const [provisional] = startRecording(4);
        if (!provisional) {
            throw new Error('expected a provisional recording clip');
        }
        // A loop wrap stages another take for the same clip inside the same
        // gesture; the one commit owns both.
        stageRecordingTake({
            trackId: TRACK_ID,
            clipId: provisional.id,
            name: 'Take 2',
            startBeat: 0,
            endBeat: 4,
            sourceOffsetBeats: 0,
        });
        flushAutomergeStorageWrites();
        const recordedTakeIds = takeRefs().map((take) => take.id);
        expect(recordedTakeIds).toHaveLength(2);

        await commitRecording({ ...provisional, audioBufferId: 'rec-buffer-1', startBeat: 4, endBeat: 6 });
        flushAutomergeStorageWrites();
        expect(undoHistoryStore.value?.past ?? []).toHaveLength(1);

        await undo();
        flushAutomergeStorageWrites();
        expect(takeRefs()).toEqual([]);
        expect(laneIds()).toEqual([]);

        await redo();
        flushAutomergeStorageWrites();
        expect(takeRefs().map((take) => take.id)).toEqual(recordedTakeIds);
    });

    it('keeps an unrelated clip added after the undo when the recording is redone', async () => {
        const [provisional] = startRecording(4);
        if (!provisional) {
            throw new Error('expected a provisional recording clip');
        }
        flushAutomergeStorageWrites();
        await commitRecording({ ...provisional, audioBufferId: 'rec-buffer-1', startBeat: 4, endBeat: 6 });
        flushAutomergeStorageWrites();

        await undo();
        flushAutomergeStorageWrites();
        const unrelated: Clip = {
            id: 'clip-later',
            trackId: TRACK_ID,
            name: 'Later',
            startBeat: 8,
            endBeat: 12,
            type: 'audio',
            fadeInBeats: 0,
            fadeOutBeats: 0,
            gain: 1,
            color: '',
            locked: false,
            muted: false,
        };
        updateTrack(TRACK_ID, (track) => ({ ...track, clips: [...track.clips, unrelated] }));
        flushAutomergeStorageWrites();

        await redo();
        flushAutomergeStorageWrites();
        expect(clipIds()).toContain('clip-later');
        expect(clipIds()).toContain(provisional.id);
    });
});
