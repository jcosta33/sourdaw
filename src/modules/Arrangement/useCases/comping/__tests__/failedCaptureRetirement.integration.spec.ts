import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { macroStore } from '#/modules/Command/stores';
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

import { TrackDummy } from '../../../__tests__/TrackDummy';
import { takeLaneStore } from '../../../stores/takeLaneStore';
import { trackStore } from '../../../stores/trackStore';
import { addClip } from '../../clip/addClip';
import { removeClip } from '../../clip/removeClip';
import { addTake } from '../addTake';
import { addTakeLane } from '../addTakeLane';

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

function takesInLiveLanes(): string[] {
    return (takeLaneStore.value?.lanes ?? []).flatMap((lane) => lane.takes.map((take) => take.id));
}

describe('failed capture retirement', () => {
    beforeEach(() => {
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('failed capture retirement integration');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        trackStore.set({
            tracks: [TrackDummy.create({ id: 'track-1', clips: [] })],
            selectedTrackId: 'track-1',
            ghostClips: [],
        });
    });

    afterEach(() => {
        clearUndoHistory();
        resetActionReplayAuthority();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        takeLaneStore.set({ lanes: [] });
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it('does not replay a failed capture back after its clip is removed directly', async () => {
        // The recorder places its provisional clip, then provisions the take lane and
        // the take through the ordinary use cases — both of which push history entries.
        addClip({ id: 'clip-take', trackId: 'track-1', startBeat: 0, endBeat: 4, name: 'Take 1', type: 'audio' });
        addTakeLane('track-1');
        addTake('track-1', 'clip-take', 'Take 1', 0, 4);
        flushAutomergeStorageWrites();
        expect(takesInLiveLanes()).toHaveLength(1);

        // The failure path discards the partial take by removing the clip directly, so
        // no entry of its own sits above the take-lane entries.
        removeClip('clip-take');
        flushAutomergeStorageWrites();
        expect(takeLaneStore.value?.lanes).toEqual([]);

        await undo();
        await undo();
        await redo();
        await redo();

        // Nothing of the failed capture comes back. The lane-insertion entry may
        // re-create the lane it provisioned, but it carries no take — in particular
        // none naming the clip that is gone, which is the resurrection #4265 forbids.
        expect(takesInLiveLanes()).toEqual([]);
        expect(takeLaneStore.value?.lanes.every((lane) => lane.takes.length === 0)).toBe(true);
        expect(trackStore.value?.tracks[0]?.clips).toEqual([]);
    });
});
