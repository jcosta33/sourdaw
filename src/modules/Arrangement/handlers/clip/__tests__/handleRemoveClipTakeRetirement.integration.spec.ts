import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { takeLaneStore, trackStore } from '#/modules/Arrangement/stores';
import { getArrangementHandlers } from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, macroStore, registerHandlerMap } from '#/modules/Command/stores';
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
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { TrackDummy } from '../../../__tests__/TrackDummy';
import { createTake, createTakeLane, type Take, type TakeLane } from '../../../models/TakeLane';

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

// `undo()` reports a refused inverse through `notifyUser`; the desktop
// notification bus does not exist in this environment.
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: vi.fn() }));

function laneForClip(clipId: string): { lane: TakeLane; take: Take } {
    const take = createTake(clipId, 'Recorded take', 0, 4);
    const lane: TakeLane = {
        ...createTakeLane('track-1'),
        takes: [take],
        activeCompRegions: [{ startBeat: 0, endBeat: 4, takeId: take.id }],
    };
    return { lane, take };
}

async function removeClipThroughHandler(clipId: string): Promise<void> {
    await executeAppAction({ type: 'removeClip', payload: { clipId } }, { source: 'prompt' });
}

describe('removeClip take retirement (ripple route)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('remove clip take retirement integration');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        const clip = ClipDummy.create({ id: 'clip-1', startBeat: 0, endBeat: 4 });
        const track = TrackDummy.create({ id: 'track-1', clips: [clip] });
        trackStore.set({ tracks: [track], selectedTrackId: track.id, ghostClips: [] });
    });

    afterEach(() => {
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        takeLaneStore.set({ lanes: [] });
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it('retires the removed clip take on the ripple delete route', async () => {
        const { lane } = laneForClip('clip-1');
        takeLaneStore.set({ lanes: [lane] });
        flushAutomergeStorageWrites();

        await removeClipThroughHandler('clip-1');

        expect(trackStore.value?.tracks[0]?.clips).toHaveLength(0);
        expect(takeLaneStore.value?.lanes).toEqual([]);
    });

    it('restores the clip and its retired take when the ripple delete is undone', async () => {
        const { lane, take } = laneForClip('clip-1');
        takeLaneStore.set({ lanes: [lane] });
        flushAutomergeStorageWrites();

        await removeClipThroughHandler('clip-1');
        await undo();

        expect(trackStore.value?.tracks[0]?.clips.map((clip) => clip.id)).toEqual(['clip-1']);
        const restoredLane = takeLaneStore.value?.lanes[0];
        expect(restoredLane?.id).toBe(lane.id);
        expect(restoredLane?.takes.map((candidate) => candidate.id)).toEqual([take.id]);
        expect(restoredLane?.activeCompRegions).toEqual([{ startBeat: 0, endBeat: 4, takeId: take.id }]);
    });

    it('re-retires the take when the ripple delete is redone', async () => {
        const { lane } = laneForClip('clip-1');
        takeLaneStore.set({ lanes: [lane] });
        flushAutomergeStorageWrites();

        await removeClipThroughHandler('clip-1');
        await undo();
        await redo();

        expect(trackStore.value?.tracks[0]?.clips).toHaveLength(0);
        expect(takeLaneStore.value?.lanes).toEqual([]);
    });

    it('retires only the deleted clip take and keeps an unrelated lane take', async () => {
        const { lane } = laneForClip('clip-1');
        const keptTake = createTake('clip-2', 'Survivor', 0, 4);
        const keptLane: TakeLane = { ...createTakeLane('track-1'), takes: [keptTake] };
        takeLaneStore.set({ lanes: [lane, keptLane] });
        flushAutomergeStorageWrites();

        await removeClipThroughHandler('clip-1');

        const lanes = takeLaneStore.value?.lanes;
        expect(lanes).toHaveLength(1);
        expect(lanes?.[0]?.takes.map((candidate) => candidate.id)).toEqual([keptTake.id]);
    });

    it('keeps a take projected into the lane after the removal when the removal is undone', async () => {
        const retiredTake = createTake('clip-1', 'Retired', 0, 4);
        const survivorTake = createTake('clip-2', 'Survivor', 4, 8);
        const lane: TakeLane = {
            ...createTakeLane('track-1'),
            takes: [retiredTake, survivorTake],
            activeCompRegions: [],
        };
        takeLaneStore.set({ lanes: [lane] });
        flushAutomergeStorageWrites();

        await removeClipThroughHandler('clip-1');

        // A collaborator's take-add projects in while the removal's capture is
        // absent; there is no local undo entry for it.
        const projectedTake = createTake('clip-2', 'Projected', 8, 12);
        const afterRemoval = takeLaneStore.value;
        if (!afterRemoval) {
            throw new Error('expected the take-lane store to hold the post-removal lane');
        }
        takeLaneStore.set({
            lanes: afterRemoval.lanes.map((candidate) =>
                candidate.id === lane.id ? { ...candidate, takes: [...candidate.takes, projectedTake] } : candidate
            ),
        });
        flushAutomergeStorageWrites();

        await undo();

        const restoredLane = takeLaneStore.value?.lanes[0];
        expect(restoredLane?.takes.map((candidate) => candidate.id)).toEqual([
            retiredTake.id,
            survivorTake.id,
            projectedTake.id,
        ]);
    });

    it('keeps a comp region authored after the removal when it overlaps a restored region', async () => {
        const retiredTake = createTake('clip-1', 'Retired', 0, 4);
        const survivorTake = createTake('clip-2', 'Survivor', 0, 8);
        const lane: TakeLane = {
            ...createTakeLane('track-1'),
            takes: [retiredTake, survivorTake],
            activeCompRegions: [{ startBeat: 0, endBeat: 4, takeId: retiredTake.id }],
        };
        takeLaneStore.set({ lanes: [lane] });
        flushAutomergeStorageWrites();

        await removeClipThroughHandler('clip-1');

        // After the removal, a comp region is authored for the surviving take over a
        // span that overlaps the retired one the undo is about to put back.
        const liveRegion = { startBeat: 2, endBeat: 6, takeId: survivorTake.id };
        const afterRemoval = takeLaneStore.value;
        if (!afterRemoval) {
            throw new Error('expected the take-lane store to hold the post-removal lane');
        }
        takeLaneStore.set({
            lanes: afterRemoval.lanes.map((candidate) =>
                candidate.id === lane.id ? { ...candidate, activeCompRegions: [liveRegion] } : candidate
            ),
        });
        flushAutomergeStorageWrites();

        await undo();
        flushAutomergeStorageWrites();

        const restoredLane = takeLaneStore.value?.lanes[0];
        expect(restoredLane?.takes.map((candidate) => candidate.id)).toEqual([retiredTake.id, survivorTake.id]);
        // Live wins: the restored region overlapped one authored after the removal,
        // so the later one is the only one left and the store did not have to drop it.
        expect(restoredLane?.activeCompRegions).toEqual([liveRegion]);
    });
});
