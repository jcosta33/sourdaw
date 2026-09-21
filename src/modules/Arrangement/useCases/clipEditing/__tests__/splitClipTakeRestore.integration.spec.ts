import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { takeLaneStore, trackStore } from '#/modules/Arrangement/stores';
import { clearHandlerRegistry, macroStore, registerHandlerMap } from '#/modules/Command/stores';
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
});
