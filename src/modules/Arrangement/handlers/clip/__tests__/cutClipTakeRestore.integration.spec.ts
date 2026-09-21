import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { clipSelectionStore, takeLaneStore, trackStore } from '#/modules/Arrangement/stores';
import { getArrangementHandlers } from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, macroStore, registerHandlerMap, undoStore } from '#/modules/Command/stores';
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

describe('cutClip take retirement and restore', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('cut clip take restore integration');
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
        clipSelectionStore.set({ selectedClipId: 'clip-1', selectedClipIds: ['clip-1'], marqueeSelection: null });
    });

    afterEach(() => {
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        takeLaneStore.set({ lanes: [] });
        clipSelectionStore.set({ selectedClipId: null, selectedClipIds: [], marqueeSelection: null });
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it('retires the cut clip take on the forward cut', async () => {
        const { lane } = laneForClip('clip-1');
        takeLaneStore.set({ lanes: [lane] });
        flushAutomergeStorageWrites();

        await executeAppAction({ type: 'cutClip' }, { source: 'prompt' });

        expect(trackStore.value?.tracks[0]?.clips).toHaveLength(0);
        expect(takeLaneStore.value?.lanes).toEqual([]);
    });

    it('restores the clip and its retired take when the cut is undone', async () => {
        const { lane, take } = laneForClip('clip-1');
        takeLaneStore.set({ lanes: [lane] });
        flushAutomergeStorageWrites();

        await executeAppAction({ type: 'cutClip' }, { source: 'prompt' });
        await undo();

        expect(trackStore.value?.tracks[0]?.clips.map((clip) => clip.id)).toEqual(['clip-1']);
        const restoredLane = takeLaneStore.value?.lanes[0];
        expect(restoredLane?.id).toBe(lane.id);
        expect(restoredLane?.takes.map((candidate) => candidate.id)).toEqual([take.id]);
        expect(restoredLane?.activeCompRegions).toEqual([{ startBeat: 0, endBeat: 4, takeId: take.id }]);
    });

    it('re-retires the take when the cut is redone', async () => {
        const { lane } = laneForClip('clip-1');
        takeLaneStore.set({ lanes: [lane] });
        flushAutomergeStorageWrites();

        await executeAppAction({ type: 'cutClip' }, { source: 'prompt' });
        await undo();
        await redo();

        expect(trackStore.value?.tracks[0]?.clips).toHaveLength(0);
        expect(takeLaneStore.value?.lanes).toEqual([]);
    });

    it('redoes a cut whose lane gained a take for a surviving clip', async () => {
        const cutTake = createTake('clip-1', 'Cut take', 0, 4);
        const survivorTake = createTake('clip-2', 'Survivor', 4, 8);
        const lane: TakeLane = { ...createTakeLane('track-1'), takes: [cutTake, survivorTake], activeCompRegions: [] };
        takeLaneStore.set({ lanes: [lane] });
        flushAutomergeStorageWrites();

        await executeAppAction({ type: 'cutClip' }, { source: 'prompt' });

        // A take for the surviving clip projects into the lane after the cut.
        const projectedTake = createTake('clip-2', 'Projected', 8, 12);
        const afterCut = takeLaneStore.value;
        if (!afterCut) {
            throw new Error('expected the post-cut take-lane state');
        }
        takeLaneStore.set({
            lanes: afterCut.lanes.map((candidate) =>
                candidate.id === lane.id ? { ...candidate, takes: [...candidate.takes, projectedTake] } : candidate
            ),
        });
        flushAutomergeStorageWrites();

        await undo();
        await redo();

        expect(trackStore.value?.tracks[0]?.clips).toHaveLength(0);
        const lanes = takeLaneStore.value?.lanes;
        expect(lanes).toHaveLength(1);
        expect(lanes?.[0]?.takes.map((candidate) => candidate.id)).toEqual([survivorTake.id, projectedTake.id]);
    });

    it('redoes a cut whose retired lane was replaced by a new lane for the track', async () => {
        const { lane, take } = laneForClip('clip-1');
        takeLaneStore.set({ lanes: [lane] });
        flushAutomergeStorageWrites();

        await executeAppAction({ type: 'cutClip' }, { source: 'prompt' });

        // The lane was retired whole; a fresh lane for the same track appears.
        const projectedTake = createTake('clip-3', 'Projected', 0, 4);
        const projectedLane: TakeLane = { ...createTakeLane('track-1'), takes: [projectedTake] };
        takeLaneStore.set({ lanes: [projectedLane] });
        flushAutomergeStorageWrites();

        await undo();
        await redo();

        expect(trackStore.value?.tracks[0]?.clips).toHaveLength(0);
        const lanes = takeLaneStore.value?.lanes;
        expect(lanes).toHaveLength(1);
        expect(lanes?.[0]?.takes.map((candidate) => candidate.id)).toEqual([projectedTake.id]);
        expect(lanes?.[0]?.id).toBe(projectedLane.id);
        expect(lanes?.[0]?.takes.some((candidate) => candidate.id === take.id)).toBe(false);
    });

    it('lands a redo whose restored take a projection removed', async () => {
        const { lane } = laneForClip('clip-1');
        takeLaneStore.set({ lanes: [lane] });
        flushAutomergeStorageWrites();

        await executeAppAction({ type: 'cutClip' }, { source: 'prompt' });
        await undo();

        // A projection removes the take the undo restored; the lane stays.
        const restored = takeLaneStore.value;
        if (!restored) {
            throw new Error('expected the restored take-lane state');
        }
        takeLaneStore.set({ lanes: restored.lanes.map((candidate) => ({ ...candidate, takes: [] })) });
        flushAutomergeStorageWrites();

        await redo();

        expect(trackStore.value?.tracks[0]?.clips).toHaveLength(0);
        expect(undoStore.value?.future).toHaveLength(0);
    });

    it('lands a redo whose restored lane a projection removed', async () => {
        const { lane } = laneForClip('clip-1');
        takeLaneStore.set({ lanes: [lane] });
        flushAutomergeStorageWrites();

        await executeAppAction({ type: 'cutClip' }, { source: 'prompt' });
        await undo();

        // A projection removes the whole lane the undo restored.
        takeLaneStore.set({ lanes: [] });
        flushAutomergeStorageWrites();

        await redo();

        expect(trackStore.value?.tracks[0]?.clips).toHaveLength(0);
        expect(undoStore.value?.future).toHaveLength(0);
    });

    it('retires a take that landed on the cut clip after the undo when the cut is redone', async () => {
        // The cut clip holds no take when it leaves, so the capture is empty.
        const emptyLane: TakeLane = { ...createTakeLane('track-1'), takes: [], activeCompRegions: [] };
        takeLaneStore.set({ lanes: [emptyLane] });
        flushAutomergeStorageWrites();

        await executeAppAction({ type: 'cutClip' }, { source: 'prompt' });
        await undo();
        expect(trackStore.value?.tracks[0]?.clips.map((clip) => clip.id)).toEqual(['clip-1']);

        // A take and its comp region land for the cut clip after the undo.
        const lateTake = createTake('clip-1', 'Late take', 0, 4);
        takeLaneStore.set({
            lanes: [
                {
                    ...emptyLane,
                    takes: [lateTake],
                    activeCompRegions: [{ startBeat: 0, endBeat: 4, takeId: lateTake.id }],
                },
            ],
        });
        flushAutomergeStorageWrites();

        await redo();

        // The redo removes the clip again, so the late take must not survive it.
        expect(trackStore.value?.tracks[0]?.clips).toHaveLength(0);
        expect(takeLaneStore.value?.lanes).toEqual([]);
    });
});
