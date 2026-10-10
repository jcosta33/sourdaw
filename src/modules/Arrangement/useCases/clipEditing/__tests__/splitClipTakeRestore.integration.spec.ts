import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { takeLaneStore, trackStore } from '#/modules/Arrangement/stores';
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
import { createTake, createTakeLane, type TakeLane } from '../../../models/TakeLane';
import { getArrangementHandlers } from '../../../useCases/getArrangementHandlers';
import { splitClipWithUndo } from '../splitClipWithUndo';

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: vi.fn() }));

function rightClipId(): string {
    const clip = trackStore.value?.tracks[0]?.clips.find((candidate) => candidate.id !== 'clip-1');
    if (!clip) {
        throw new Error('expected the split to create a right clip');
    }
    return clip.id;
}

function lane(): TakeLane {
    const current = takeLaneStore.value?.lanes[0];
    if (!current) {
        throw new Error('expected the comp lane');
    }
    return current;
}

/** One comped take spanning the whole clip, so the split crosses its seam. */
function arrangeCompedTake(): TakeLane {
    const take = createTake('clip-1', 'Full take', 0, 8);
    const compedLane: TakeLane = {
        ...createTakeLane('track-1'),
        takes: [take],
        activeCompRegions: [{ startBeat: 0, endBeat: 8, takeId: take.id }],
    };
    takeLaneStore.set({ lanes: [compedLane] });
    flushAutomergeStorageWrites();
    return structuredClone(compedLane);
}

describe('splitClipWithUndo take restore', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('split clip take restore integration');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        const clip = ClipDummy.create({ id: 'clip-1', startBeat: 0, endBeat: 8 });
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

    it('restores a take recorded on the right half when the split is redone', async () => {
        splitClipWithUndo('clip-1', 4);
        const splitRightClipId = rightClipId();

        // A take lands on the right half without a local undo entry.
        const take = createTake(splitRightClipId, 'Right take', 4, 8);
        const lane: TakeLane = { ...createTakeLane('track-1'), takes: [take] };
        takeLaneStore.set({ lanes: [lane] });
        flushAutomergeStorageWrites();

        await undo();
        expect(takeLaneStore.value?.lanes).toEqual([]);

        await redo();

        // The right half's id is generated, so its order against the source's is not
        // a contract: compare both sides sorted rather than pinning one order.
        expect([...(trackStore.value?.tracks[0]?.clips ?? []).map((clip) => clip.id)].sort()).toEqual(
            [splitRightClipId, 'clip-1'].sort()
        );
        expect(takeLaneStore.value?.lanes[0]?.takes.map((candidate) => candidate.id)).toEqual([take.id]);
    });

    it('round-trips a comped take crossing the split through the imperative undo and redo', async () => {
        const originalLane = arrangeCompedTake();

        splitClipWithUndo('clip-1', 4);
        const splitRightClipId = rightClipId();

        // The forward split re-keyed the lane: the left fragment keeps the take
        // id, the right fragment mints its own, and the comp region maps onto
        // both fragment takes instead of ending at the left clip's end.
        const leftTake = lane().takes.find((candidate) => candidate.clipId === 'clip-1');
        if (!leftTake) {
            throw new Error('expected the left fragment to keep its take');
        }
        expect([leftTake.id, leftTake.startBeat, leftTake.endBeat]).toEqual([originalLane.takes[0]!.id, 0, 4]);
        const mintedTake = lane().takes.find((candidate) => candidate.clipId === splitRightClipId);
        if (!mintedTake) {
            throw new Error('expected the right fragment to mint its take');
        }
        expect([mintedTake.startBeat, mintedTake.endBeat]).toEqual([4, 8]);
        expect(lane().activeCompRegions.map((region) => [region.startBeat, region.endBeat, region.takeId])).toEqual([
            [0, 4, originalLane.takes[0]!.id],
            [4, 8, mintedTake.id],
        ]);

        await undo();
        flushAutomergeStorageWrites();

        // The undo's restore leg puts the whole pre-split lane back over the
        // fragmented one — deleting the restoreTakeReKeyTransitions call in
        // splitClipWithUndo leaves the split-shaped facets here and reddens.
        expect(lane()).toEqual(originalLane);

        await redo();
        flushAutomergeStorageWrites();

        // The redo re-splits with stable ids: the same minted take id comes
        // back on the re-created right fragment.
        expect(lane().takes.map((candidate) => candidate.id)).toEqual([originalLane.takes[0]!.id, mintedTake.id]);
        expect(lane().activeCompRegions.map((region) => [region.startBeat, region.endBeat, region.takeId])).toEqual([
            [0, 4, originalLane.takes[0]!.id],
            [4, 8, mintedTake.id],
        ]);
    });

    it('retires a right-half take on split undo and reinstates it on redo, through the command handler (#4521)', async () => {
        // Split through the command path so the restoreClipSplitState payloads are
        // the real producer shape — rightClip null on the undo's replacement.
        await executeAppAction({ type: 'splitClip', payload: { clipId: 'clip-1', beat: 4 } }, { source: 'manual' });
        const splitRightClipId = rightClipId();

        // A take lands on the right half after the split — no local undo entry
        // names it, so only the undo's capture can carry it to the redo.
        const take = createTake(splitRightClipId, 'Right take', 4, 8);
        const lane: TakeLane = { ...createTakeLane('track-1'), takes: [take] };
        takeLaneStore.set({ lanes: [lane] });
        flushAutomergeStorageWrites();

        await undo();
        expect((trackStore.value?.tracks[0]?.clips ?? []).map((clip) => clip.id)).toEqual(['clip-1']);
        // The undo filtered the right clip out; its take lanes retire with it.
        expect(takeLaneStore.value?.lanes).toEqual([]);

        await redo();
        expect([...(trackStore.value?.tracks[0]?.clips ?? []).map((clip) => clip.id)].sort()).toEqual(
            [splitRightClipId, 'clip-1'].sort()
        );
        expect(takeLaneStore.value?.lanes[0]?.takes.map((candidate) => candidate.id)).toEqual([take.id]);
    });
});
