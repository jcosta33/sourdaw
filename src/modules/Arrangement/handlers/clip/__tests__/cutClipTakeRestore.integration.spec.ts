import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { clipSelectionStore, takeLaneStore, trackStore } from '#/modules/Arrangement/stores';
import { getArrangementHandlers } from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, macroStore, registerHandlerMap, undoHistoryStore } from '#/modules/Command/stores';
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
import { moveClip } from '../../../useCases/clip/moveClip';

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

    it('does not resurrect a take a projection removed before the redo', async () => {
        const { lane, take } = laneForClip('clip-1');
        takeLaneStore.set({ lanes: [lane] });
        flushAutomergeStorageWrites();

        await executeAppAction({ type: 'cutClip' }, { source: 'prompt' });
        await undo();
        expect(takeLaneStore.value?.lanes[0]?.takes.map((candidate) => candidate.id)).toEqual([take.id]);

        // A projection removes the take the undo restored; the lane stays.
        const restored = takeLaneStore.value;
        if (!restored) {
            throw new Error('expected the restored take-lane state');
        }
        takeLaneStore.set({ lanes: restored.lanes.map((candidate) => ({ ...candidate, takes: [] })) });
        flushAutomergeStorageWrites();

        await redo();

        // The redo retires nothing, but it still lands rather than pinning the stack.
        expect(trackStore.value?.tracks[0]?.clips).toHaveLength(0);
        expect(undoHistoryStore.value?.future).toHaveLength(0);

        await undo();

        // The capture names what the redo retired — nothing — so the take the
        // projection deleted stays deleted.
        expect(trackStore.value?.tracks[0]?.clips.map((clip) => clip.id)).toEqual(['clip-1']);
        expect(takeLaneStore.value?.lanes[0]?.takes).toEqual([]);
    });

    it('does not resurrect a lane a projection removed before the redo', async () => {
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
        expect(undoHistoryStore.value?.future).toHaveLength(0);

        await undo();

        expect(trackStore.value?.tracks[0]?.clips.map((clip) => clip.id)).toEqual(['clip-1']);
        expect(takeLaneStore.value?.lanes).toEqual([]);
    });

    it('restores the comp region that replaced the captured one', async () => {
        const { lane, take } = laneForClip('clip-1');
        takeLaneStore.set({ lanes: [lane] });
        flushAutomergeStorageWrites();

        await executeAppAction({ type: 'cutClip' }, { source: 'prompt' });
        await undo();

        // A second take for the cut clip lands, and the comp switches to it.
        const secondTake = createTake('clip-1', 'Second take', 0, 4);
        const restored = takeLaneStore.value?.lanes[0];
        if (!restored) {
            throw new Error('expected the restored take lane');
        }
        takeLaneStore.set({
            lanes: [
                {
                    ...restored,
                    takes: [...restored.takes, secondTake],
                    activeCompRegions: [{ startBeat: 0, endBeat: 4, takeId: secondTake.id }],
                },
            ],
        });
        flushAutomergeStorageWrites();

        await redo();
        expect(takeLaneStore.value?.lanes).toEqual([]);

        await undo();

        // Both takes come back, and the comp is the one live when the redo ran —
        // not the superseded region the first cut captured over the same span.
        const restoredLane = takeLaneStore.value?.lanes[0];
        expect(restoredLane?.takes.map((candidate) => candidate.id)).toEqual([take.id, secondTake.id]);
        expect(restoredLane?.activeCompRegions).toEqual([{ startBeat: 0, endBeat: 4, takeId: secondTake.id }]);
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

    it('restores a take and region that landed on the cut clip after the undo when the redo is undone', async () => {
        // The cut clip holds no take when it leaves, so the capture names nothing.
        const emptyLane: TakeLane = { ...createTakeLane('track-1'), takes: [], activeCompRegions: [] };
        takeLaneStore.set({ lanes: [emptyLane] });
        flushAutomergeStorageWrites();

        await executeAppAction({ type: 'cutClip' }, { source: 'prompt' });
        await undo();

        // The take and its comp region land after the undo; only a capture taken
        // while the redo re-retires the clip can name them.
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
        expect(takeLaneStore.value?.lanes).toEqual([]);

        await undo();

        expect(trackStore.value?.tracks[0]?.clips.map((clip) => clip.id)).toEqual(['clip-1']);
        const restoredLane = takeLaneStore.value?.lanes[0];
        expect(restoredLane?.id).toBe(emptyLane.id);
        expect(restoredLane?.takes.map((candidate) => candidate.id)).toEqual([lateTake.id]);
        expect(restoredLane?.activeCompRegions).toEqual([{ startBeat: 0, endBeat: 4, takeId: lateTake.id }]);
    });

    it('restores the recorded take and the one that landed after the undo, each once', async () => {
        const { lane, take } = laneForClip('clip-1');
        takeLaneStore.set({ lanes: [lane] });
        flushAutomergeStorageWrites();

        await executeAppAction({ type: 'cutClip' }, { source: 'prompt' });
        await undo();

        const lateTake = createTake('clip-1', 'Late take', 4, 8);
        const restored = takeLaneStore.value?.lanes[0];
        if (!restored) {
            throw new Error('expected the restored take lane');
        }
        takeLaneStore.set({
            lanes: [
                {
                    ...restored,
                    takes: [...restored.takes, lateTake],
                    activeCompRegions: [
                        ...restored.activeCompRegions,
                        { startBeat: 4, endBeat: 8, takeId: lateTake.id },
                    ],
                },
            ],
        });
        flushAutomergeStorageWrites();

        await redo();
        expect(takeLaneStore.value?.lanes).toEqual([]);

        await undo();

        const restoredLane = takeLaneStore.value?.lanes[0];
        // The recorded capture already named the first take; the redo's capture
        // names both, and the merge must not list it twice.
        expect(restoredLane?.takes.map((candidate) => candidate.id)).toEqual([take.id, lateTake.id]);
        expect(restoredLane?.activeCompRegions).toEqual([
            { startBeat: 0, endBeat: 4, takeId: take.id },
            { startBeat: 4, endBeat: 8, takeId: lateTake.id },
        ]);
    });

    it('restores a take whose lane still names the track the clip left', async () => {
        // The clip starts on track-2 with a take lane captured there.
        const clip = ClipDummy.create({ id: 'clip-1', startBeat: 0, endBeat: 4 });
        trackStore.set({
            tracks: [
                TrackDummy.create({ id: 'track-1', clips: [] }),
                TrackDummy.create({ id: 'track-2', clips: [clip] }),
            ],
            selectedTrackId: 'track-1',
            ghostClips: [],
        });
        const take = createTake('clip-1', 'Recorded take', 0, 4);
        const lane: TakeLane = {
            ...createTakeLane('track-2'),
            takes: [take],
            activeCompRegions: [{ startBeat: 0, endBeat: 4, takeId: take.id }],
        };
        takeLaneStore.set({ lanes: [lane] });
        flushAutomergeStorageWrites();

        // Moving the clip re-keys the clip, not the lane: the lane still says track-2.
        expect(moveClip('clip-1', 'track-1', 0)).toBe(true);
        clipSelectionStore.set({ selectedClipId: 'clip-1', selectedClipIds: ['clip-1'], marqueeSelection: null });

        await executeAppAction({ type: 'cutClip' }, { source: 'prompt' });
        expect(trackStore.value?.tracks[0]?.clips).toHaveLength(0);
        expect(takeLaneStore.value?.lanes).toEqual([]);

        await undo();
        expect(trackStore.value?.tracks[0]?.clips.map((candidate) => candidate.id)).toEqual(['clip-1']);
        expect(takeLaneStore.value?.lanes[0]?.takes.map((candidate) => candidate.id)).toEqual([take.id]);
        expect(takeLaneStore.value?.lanes[0]?.activeCompRegions).toEqual([
            { startBeat: 0, endBeat: 4, takeId: take.id },
        ]);

        await redo();
        expect(takeLaneStore.value?.lanes).toEqual([]);

        await undo();

        const restoredLane = takeLaneStore.value?.lanes[0];
        expect(trackStore.value?.tracks[0]?.clips.map((candidate) => candidate.id)).toEqual(['clip-1']);
        expect(restoredLane?.takes.map((candidate) => candidate.id)).toEqual([take.id]);
        expect(restoredLane?.activeCompRegions).toEqual([{ startBeat: 0, endBeat: 4, takeId: take.id }]);
        // The take has to name the clip that came back, not the track it was captured on.
        expect(takeLaneStore.value?.lanes[0]?.takes.map((candidate) => candidate.clipId)).toEqual(['clip-1']);
    });

    it('carries a lane once when the cut spans two tracks', async () => {
        // One lane names a take for a clip on each of two tracks, so both pre-removal
        // entries could claim it.
        const takeOnFirst = createTake('clip-1', 'First take', 0, 4);
        const takeOnSecond = createTake('clip-2', 'Second take', 0, 4);
        const lane: TakeLane = {
            ...createTakeLane('track-1'),
            takes: [takeOnFirst, takeOnSecond],
            activeCompRegions: [],
        };
        trackStore.set({
            tracks: [
                TrackDummy.create({
                    id: 'track-1',
                    clips: [ClipDummy.create({ id: 'clip-1', startBeat: 0, endBeat: 4 })],
                }),
                TrackDummy.create({
                    id: 'track-2',
                    clips: [ClipDummy.create({ id: 'clip-2', trackId: 'track-2', startBeat: 0, endBeat: 4 })],
                }),
            ],
            selectedTrackId: 'track-1',
            ghostClips: [],
        });
        takeLaneStore.set({ lanes: [lane] });
        flushAutomergeStorageWrites();
        clipSelectionStore.set({
            selectedClipId: 'clip-1',
            selectedClipIds: ['clip-1', 'clip-2'],
            marqueeSelection: null,
        });

        await executeAppAction({ type: 'cutClip' }, { source: 'prompt' });
        expect(trackStore.value?.tracks[0]?.clips).toHaveLength(0);
        expect(trackStore.value?.tracks[1]?.clips).toHaveLength(0);
        expect(undoHistoryStore.value?.past).toHaveLength(1);

        await undo();
        expect(trackStore.value?.tracks[0]?.clips).toHaveLength(1);
        expect(trackStore.value?.tracks[1]?.clips).toHaveLength(1);
        expect(takeLaneStore.value?.lanes[0]?.takes).toHaveLength(2);

        await redo();
        expect(undoHistoryStore.value?.past).toHaveLength(1);

        const redoEntry = undoHistoryStore.value?.past.at(-1);
        if (!redoEntry || redoEntry.kind !== 'action' || redoEntry.inverseAction?.type !== 'restoreTrackClipStates') {
            throw new Error('expected the cut entry to carry a restoreTrackClipStates inverse');
        }
        // The capture the following undo reads must name the lane once, not once per
        // entry: the restore reconciles every entry's lanes.
        expect(
            redoEntry.inverseAction.payload.replacement.flatMap((entry) =>
                (entry.retiredTakeLanes ?? []).map((capture) => capture.lane.id)
            )
        ).toEqual([lane.id]);

        await undo();

        expect(trackStore.value?.tracks[0]?.clips.map((candidate) => candidate.id)).toEqual(['clip-1']);
        expect(trackStore.value?.tracks[1]?.clips.map((candidate) => candidate.id)).toEqual(['clip-2']);
        expect(takeLaneStore.value?.lanes[0]?.takes.map((candidate) => candidate.id)).toEqual([
            takeOnFirst.id,
            takeOnSecond.id,
        ]);
    });

    it('restores a take whose lane the moveClips route left on the old track', async () => {
        // The clip starts on track-2 with a lane captured there, then the product move
        // route carries the clip to track-1 and leaves the lane pointing at track-2.
        const clip = ClipDummy.create({ id: 'clip-1', trackId: 'track-2', startBeat: 0, endBeat: 4 });
        trackStore.set({
            tracks: [
                TrackDummy.create({ id: 'track-1', clips: [] }),
                TrackDummy.create({ id: 'track-2', clips: [clip] }),
            ],
            selectedTrackId: 'track-1',
            ghostClips: [],
        });
        const take = createTake('clip-1', 'Recorded take', 0, 4);
        const lane: TakeLane = {
            ...createTakeLane('track-2'),
            takes: [take],
            activeCompRegions: [{ startBeat: 0, endBeat: 4, takeId: take.id }],
        };
        takeLaneStore.set({ lanes: [lane] });
        flushAutomergeStorageWrites();

        await executeAppAction(
            {
                type: 'moveClips',
                payload: { moves: [{ clipId: 'clip-1', trackId: 'track-1', startBeat: 0 }], ripple: false },
            },
            { source: 'prompt' }
        );
        expect(trackStore.value?.tracks[0]?.clips.map((candidate) => candidate.id)).toEqual(['clip-1']);
        expect(takeLaneStore.value?.lanes[0]?.trackId).toBe('track-2');

        clipSelectionStore.set({ selectedClipId: 'clip-1', selectedClipIds: ['clip-1'], marqueeSelection: null });
        await executeAppAction({ type: 'cutClip' }, { source: 'prompt' });

        await undo();
        expect(trackStore.value?.tracks[0]?.clips.map((candidate) => candidate.id)).toEqual(['clip-1']);
        expect(takeLaneStore.value?.lanes[0]?.takes.map((candidate) => candidate.id)).toEqual([take.id]);

        await redo();
        expect(takeLaneStore.value?.lanes).toEqual([]);

        await undo();

        const restoredLane = takeLaneStore.value?.lanes[0];
        expect(trackStore.value?.tracks[0]?.clips.map((candidate) => candidate.id)).toEqual(['clip-1']);
        expect(restoredLane?.takes.map((candidate) => candidate.id)).toEqual([take.id]);
        expect(restoredLane?.activeCompRegions).toEqual([{ startBeat: 0, endBeat: 4, takeId: take.id }]);
        expect(restoredLane?.takes.map((candidate) => candidate.clipId)).toEqual(['clip-1']);
    });

    it('restores a same-track take across undo, redo and undo', async () => {
        const { lane, take } = laneForClip('clip-1');
        takeLaneStore.set({ lanes: [lane] });
        flushAutomergeStorageWrites();

        await executeAppAction({ type: 'cutClip' }, { source: 'prompt' });
        await undo();
        await redo();
        expect(takeLaneStore.value?.lanes).toEqual([]);

        await undo();

        const restoredLane = takeLaneStore.value?.lanes[0];
        expect(trackStore.value?.tracks[0]?.clips.map((candidate) => candidate.id)).toEqual(['clip-1']);
        expect(restoredLane?.id).toBe(lane.id);
        expect(restoredLane?.takes.map((candidate) => candidate.id)).toEqual([take.id]);
        expect(restoredLane?.activeCompRegions).toEqual([{ startBeat: 0, endBeat: 4, takeId: take.id }]);
    });
});
