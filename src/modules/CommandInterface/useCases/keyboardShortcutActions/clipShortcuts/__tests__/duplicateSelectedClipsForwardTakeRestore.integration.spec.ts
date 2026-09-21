import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { defaultTrackState, takeLaneStore, trackStore } from '#/modules/Arrangement/stores';
import { addClip, createTrack, setTrackStoreState } from '#/modules/Arrangement/useCases';
import { automationStore } from '#/modules/Automation/stores';
import { macroStore, undoHistoryStore } from '#/modules/Command/stores';
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

import { duplicateSelectedClipsForward } from '../duplicateSelectedClipsForward';

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

function clipIds(): string[] {
    return (trackStore.value?.tracks[0]?.clips ?? []).map((clip) => clip.id);
}

function takeIdsInLiveLanes(): string[] {
    return (takeLaneStore.value?.lanes ?? []).flatMap((lane) => lane.takes.map((take) => take.id));
}

function clipIdsNamedByLiveTakes(): string[] {
    return (takeLaneStore.value?.lanes ?? []).flatMap((lane) => lane.takes.map((take) => take.clipId));
}

describe('duplicateSelectedClipsForward take restore', () => {
    beforeEach(() => {
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('duplicate forward take restore integration');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        automationStore.set({ lanes: [] });
        setTrackStoreState({
            ...defaultTrackState,
            tracks: [createTrack({ id: 'track-1', name: 'Track 1', kind: 'audio' })],
            selectedTrackId: 'track-1',
        });
        addClip({ id: 'clip-1', trackId: 'track-1', startBeat: 0, endBeat: 4, name: 'Clip A', type: 'audio' });
    });

    afterEach(() => {
        clearUndoHistory();
        resetActionReplayAuthority();
        setTrackStoreState(structuredClone(defaultTrackState));
        takeLaneStore.set({ lanes: [] });
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it('keeps a take on the copy across undo, redo and undo, named by a live clip', async () => {
        duplicateSelectedClipsForward(['clip-1']);
        const copyId = clipIds().find((id) => id !== 'clip-1');
        if (!copyId) {
            throw new Error('expected the duplicated copy');
        }

        // A take naming the copy, written with no local undo entry.
        const take = {
            id: 'take-on-copy',
            clipId: copyId,
            name: 'Take on copy',
            startBeat: 4,
            endBeat: 8,
            selected: false,
        };
        takeLaneStore.set({ lanes: [{ id: 'lane-1', trackId: 'track-1', takes: [take], activeCompRegions: [] }] });
        flushAutomergeStorageWrites();

        await undo();
        expect(clipIds()).toEqual(['clip-1']);
        expect(takeIdsInLiveLanes()).toEqual([]);

        await redo();
        expect(takeIdsInLiveLanes()).toEqual([take.id]);
        // Restoring the take is not enough: it has to name the copy that came back.
        expect(clipIdsNamedByLiveTakes()).toEqual([copyId]);
        expect(clipIds()).toEqual(expect.arrayContaining(clipIdsNamedByLiveTakes()));

        await undo();
        expect(clipIds()).toEqual(['clip-1']);
        expect(takeIdsInLiveLanes()).toEqual([]);
    });

    it('refuses the redo when it cannot re-create its copy', async () => {
        duplicateSelectedClipsForward(['clip-1']);
        const copyId = clipIds().find((id) => id !== 'clip-1');
        if (!copyId) {
            throw new Error('expected the duplicated copy');
        }
        const take = {
            id: 'take-on-copy',
            clipId: copyId,
            name: 'Take on copy',
            startBeat: 4,
            endBeat: 8,
            selected: false,
        };
        takeLaneStore.set({ lanes: [{ id: 'lane-1', trackId: 'track-1', takes: [take], activeCompRegions: [] }] });
        flushAutomergeStorageWrites();

        await undo();

        // A projection removes the copy's whole track, and its take lane with it.
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        takeLaneStore.set({ lanes: [] });
        flushAutomergeStorageWrites();

        await redo();

        // The redo refused: a not-applied redo drops its entry rather than moving it to
        // `past`, which is what tells this refusal apart from a redo that ran and merely
        // restored nothing.
        expect(undoHistoryStore.value?.past).toHaveLength(0);
        expect(undoHistoryStore.value?.future).toHaveLength(0);
        // Nothing was re-created, so no lane may come back for a track that is gone.
        expect(clipIds()).toEqual([]);
        expect(takeIdsInLiveLanes()).toEqual([]);
        expect(takeLaneStore.value?.lanes).toEqual([]);
    });

    it('leaves no lane for the copy whose destination track was gone', async () => {
        setTrackStoreState({
            ...defaultTrackState,
            tracks: [
                createTrack({ id: 'track-1', name: 'Track 1', kind: 'audio' }),
                createTrack({ id: 'track-2', name: 'Track 2', kind: 'audio' }),
            ],
            selectedTrackId: 'track-1',
        });
        addClip({ id: 'clip-1', trackId: 'track-1', startBeat: 0, endBeat: 4, name: 'Clip A', type: 'audio' });
        addClip({ id: 'clip-2', trackId: 'track-2', startBeat: 0, endBeat: 4, name: 'Clip B', type: 'audio' });

        duplicateSelectedClipsForward(['clip-1', 'clip-2']);
        const firstCopy = trackStore.value?.tracks[0]?.clips.find((clip) => clip.id !== 'clip-1');
        const secondCopy = trackStore.value?.tracks[1]?.clips.find((clip) => clip.id !== 'clip-2');
        if (!firstCopy || !secondCopy) {
            throw new Error('expected both copies');
        }

        // A take on each copy, in the lane its own track owns.
        const firstTake = {
            id: 'take-on-first-copy',
            clipId: firstCopy.id,
            name: 'First copy take',
            startBeat: 4,
            endBeat: 8,
            selected: false,
        };
        const secondTake = {
            id: 'take-on-second-copy',
            clipId: secondCopy.id,
            name: 'Second copy take',
            startBeat: 4,
            endBeat: 8,
            selected: false,
        };
        takeLaneStore.set({
            lanes: [
                { id: 'lane-1', trackId: 'track-1', takes: [firstTake], activeCompRegions: [] },
                { id: 'lane-2', trackId: 'track-2', takes: [secondTake], activeCompRegions: [] },
            ],
        });
        flushAutomergeStorageWrites();

        await undo();
        expect(takeIdsInLiveLanes()).toEqual([]);

        // A projection removes the second copy's destination track before the redo.
        const remainingTrack = trackStore.value?.tracks[0];
        if (!remainingTrack) {
            throw new Error('expected the first track');
        }
        trackStore.set({ tracks: [remainingTrack], selectedTrackId: 'track-1', ghostClips: [] });
        flushAutomergeStorageWrites();

        await redo();

        // Only the copy that came back may carry a lane, and it must name a live clip.
        // The closure's own per-copy filter is observed by the unit case in
        // `duplicateSelectedClipsForward.spec.ts`; here the shared restore guard refuses
        // the missing track as well, so this case pins the end-to-end outcome.
        expect(clipIds()).toEqual(['clip-1', firstCopy.id]);
        expect(takeIdsInLiveLanes()).toEqual([firstTake.id]);
        expect(clipIdsNamedByLiveTakes()).toEqual([firstCopy.id]);
    });
});
