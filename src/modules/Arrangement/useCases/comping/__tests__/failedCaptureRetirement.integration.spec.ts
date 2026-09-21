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
import { createTake, createTakeLane } from '../../../models/TakeLane';
import { takeLaneStore } from '../../../stores/takeLaneStore';
import { trackStore } from '../../../stores/trackStore';
import { addClip } from '../../clip/addClip';
import { removeClip } from '../../clip/removeClip';
import { addTake } from '../addTake';
import { addTakeLane } from '../addTakeLane';
import { flattenComp } from '../flattenComp';

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

function takesInLiveLanes(): string[] {
    return (takeLaneStore.value?.lanes ?? []).flatMap((lane) => lane.takes.map((take) => take.id));
}

describe('take-lane history and retirement', () => {
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
        expect(trackStore.value?.tracks[0]?.clips.map((clip) => clip.id)).toEqual(['clip-take']);
        expect(takeLaneStore.value?.lanes[0]?.takes.map((take) => [take.id, take.clipId])).toHaveLength(1);

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

    it('does not leave a second lane for a track a projection gave one', async () => {
        addClip({ id: 'clip-live', trackId: 'track-1', startBeat: 0, endBeat: 4, name: 'Clip', type: 'audio' });
        addTakeLane('track-1');
        expect(takeLaneStore.value?.lanes).toHaveLength(1);

        // A projection replaces the track's lane with its own, carrying a live take, and
        // records nothing locally.
        const replacementLane = {
            ...createTakeLane('track-1'),
            takes: [createTake('clip-live', 'Projected take', 0, 4)],
        };
        takeLaneStore.set({ lanes: [replacementLane] });
        flushAutomergeStorageWrites();

        await undo();
        await redo();

        // A track owns one lane: readers take the first for the track, so a second one's
        // takes and regions would be dead state.
        expect(takeLaneStore.value?.lanes.map((lane) => lane.id)).toEqual([replacementLane.id]);
    });

    it('merges a replayed lane into the lane a projection gave the track', async () => {
        // The lane's take names a clip the track still holds, so it is material the
        // replay has to bring back.
        addClip({ id: 'clip-taken', trackId: 'track-1', startBeat: 4, endBeat: 8, name: 'Take', type: 'audio' });
        const take = createTake('clip-taken', 'Take', 4, 8);
        takeLaneStore.set({ lanes: [{ ...createTakeLane('track-1'), takes: [take] }] });
        flushAutomergeStorageWrites();

        // Flatten takes the lane-only route on a lane with no comp regions, recording a
        // lane removal for undo.
        expect(flattenComp('track-1')).toBe(true);
        expect(takeLaneStore.value?.lanes).toEqual([]);

        // A projection gives the track a lane of its own while this one is away.
        const projectedTake = createTake('clip-taken', 'Projected take', 4, 8);
        const projectedLane = { ...createTakeLane('track-1'), takes: [projectedTake] };
        takeLaneStore.set({ lanes: [projectedLane] });
        flushAutomergeStorageWrites();

        await undo();

        // The track keeps the one lane it owns, and the recorded take merges into it
        // beside the projected one: declining the replay instead would drop the very take
        // this undo exists to put back.
        const lanes = takeLaneStore.value?.lanes ?? [];
        expect(lanes.map((lane) => lane.id)).toEqual([projectedLane.id]);
        expect(lanes[0]?.takes.map((laneTake) => laneTake.id)).toEqual([take.id, projectedTake.id]);
    });

    it('does not replay a lane whose track the project no longer holds', async () => {
        addClip({ id: 'clip-taken', trackId: 'track-1', startBeat: 0, endBeat: 4, name: 'Take', type: 'audio' });
        takeLaneStore.set({
            lanes: [{ ...createTakeLane('track-1'), takes: [createTake('clip-taken', 'Take', 0, 4)] }],
        });
        flushAutomergeStorageWrites();
        expect(flattenComp('track-1')).toBe(true);
        expect(takeLaneStore.value?.lanes).toEqual([]);

        // The track itself leaves the project — a projection write nothing local
        // recorded — taking the lane's host with it.
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        flushAutomergeStorageWrites();

        await undo();
        expect(takeLaneStore.value?.lanes).toEqual([]);
        await redo();
        // A lane keyed to a track the project no longer holds has no host to resolve
        // against, so neither direction of the replay places it.
        expect(takeLaneStore.value?.lanes).toEqual([]);
    });
});
