import { describe, it, expect, beforeEach, vi } from 'vitest';

import { createTake, createTakeLane, type TakeLane } from '../../../models/TakeLane';
import { type TakeLaneStoreState, takeLaneStore } from '../../../stores/takeLaneStore';
import { removeTakesForClips } from '../removeTakesForClips';
import { restoreTakesForClip } from '../restoreTakesForClip';

const mocks = vi.hoisted(() => ({
    takeLaneStoreValue: { value: null as TakeLaneStoreState | null },
}));

vi.mock('../../../stores/takeLaneStore', () => ({
    takeLaneStore: {
        get value() {
            return mocks.takeLaneStoreValue.value;
        },
        set: vi.fn((state: TakeLaneStoreState) => {
            mocks.takeLaneStoreValue.value = state;
        }),
    },
}));

function laneWithTakes(trackId: string, takes: TakeLane['takes']): TakeLane {
    return { ...createTakeLane(trackId), takes };
}

describe('restoreTakesForClip', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.takeLaneStoreValue.value = null;
    });

    it('no-ops when the take-lane store is absent', () => {
        mocks.takeLaneStoreValue.value = null;

        restoreTakesForClip([
            {
                laneIndex: 0,
                lane: { id: 'lane-1', trackId: 't1', takes: [], activeCompRegions: [] },
            },
        ]);

        expect(takeLaneStore.set).not.toHaveBeenCalled();
    });

    it('no-ops when nothing was retired', () => {
        mocks.takeLaneStoreValue.value = { lanes: [] };

        restoreTakesForClip([]);

        expect(takeLaneStore.set).not.toHaveBeenCalled();
    });

    it('re-inserts a lane retired whole at the index it held', () => {
        const firstLane = laneWithTakes('t2', [createTake('c9', 'First survivor', 0, 4)]);
        const secondLane = laneWithTakes('t3', [createTake('c8', 'Second survivor', 0, 4)]);
        mocks.takeLaneStoreValue.value = { lanes: [firstLane, secondLane] };
        const retiredTake = createTake('c1', 'Retired', 0, 4);
        const retiredLane = laneWithTakes('t1', [retiredTake]);

        // The retired lane held index 1, between two lanes that outlive it: an
        // insertion anywhere else puts it back in a place it never occupied.
        restoreTakesForClip([{ laneIndex: 1, lane: retiredLane, retiredTakeIds: [retiredTake.id] }]);

        expect(takeLaneStore.set).toHaveBeenCalledTimes(1);
        expect(mocks.takeLaneStoreValue.value?.lanes.map((lane) => lane.id)).toEqual([
            firstLane.id,
            retiredLane.id,
            secondLane.id,
        ]);
        expect(mocks.takeLaneStoreValue.value?.lanes[1]?.takes.map((take) => take.id)).toEqual([retiredTake.id]);
    });

    it('inserts a lane whose captured index is past the surviving lanes at the end', () => {
        const firstLane = laneWithTakes('t2', [createTake('c9', 'First survivor', 0, 4)]);
        const secondLane = laneWithTakes('t3', [createTake('c8', 'Second survivor', 0, 4)]);
        mocks.takeLaneStoreValue.value = { lanes: [firstLane, secondLane] };
        const retiredTake = createTake('c1', 'Retired', 0, 4);
        const retiredLane = laneWithTakes('t1', [retiredTake]);

        // Index 3 no longer exists — the lanes that followed the retired one are
        // gone too — so the capture's index has to clamp to the end, not to the
        // last existing lane.
        restoreTakesForClip([{ laneIndex: 3, lane: retiredLane, retiredTakeIds: [retiredTake.id] }]);

        expect(mocks.takeLaneStoreValue.value?.lanes.map((lane) => lane.id)).toEqual([
            firstLane.id,
            secondLane.id,
            retiredLane.id,
        ]);
    });

    it('re-adds the retired take onto a lane thinned by the removal', () => {
        const take = createTake('c1', 'Retired take', 0, 4);
        const survivorTake = createTake('c2', 'Survivor', 4, 8);
        // The post-removal lane kept a take for another clip; the captured lane
        // is the same lane's pre-removal state with both takes and comp regions.
        const survivingLane: TakeLane = {
            ...createTakeLane('t1'),
            takes: [survivorTake],
        };
        const thinnedLane: TakeLane = {
            ...survivingLane,
            takes: [take, survivorTake],
            activeCompRegions: [{ startBeat: 0, endBeat: 4, takeId: take.id }],
        };
        mocks.takeLaneStoreValue.value = { lanes: [survivingLane] };

        restoreTakesForClip([{ laneIndex: 0, lane: thinnedLane, retiredTakeIds: [take.id] }]);

        expect(takeLaneStore.set).toHaveBeenCalledTimes(1);
        const restored = mocks.takeLaneStoreValue.value?.lanes[0];
        expect(restored?.takes.map((candidate) => candidate.id)).toEqual(
            thinnedLane.takes.map((candidate) => candidate.id)
        );
        expect(restored?.activeCompRegions).toEqual(thinnedLane.activeCompRegions);
    });

    it('leaves lanes the removal never touched untouched', () => {
        const untouchedLane = laneWithTakes('t3', [createTake('c7', 'Untouched', 0, 4)]);
        const retiredLane = laneWithTakes('t1', [createTake('c1', 'Retired', 0, 4)]);
        mocks.takeLaneStoreValue.value = { lanes: [untouchedLane, retiredLane] };

        restoreTakesForClip([{ laneIndex: 1, lane: retiredLane }]);

        const lanes = mocks.takeLaneStoreValue.value?.lanes;
        expect(lanes?.map((lane) => lane.id)).toEqual([untouchedLane.id, retiredLane.id]);
        expect(lanes?.[0]).toBe(untouchedLane);
    });

    it('does not duplicate a lane that is already present', () => {
        const retiredLane = laneWithTakes('t1', [createTake('c1', 'Retired', 0, 4)]);
        mocks.takeLaneStoreValue.value = { lanes: [retiredLane] };

        restoreTakesForClip([{ laneIndex: 0, lane: retiredLane }]);

        expect(mocks.takeLaneStoreValue.value?.lanes).toHaveLength(1);
    });

    it('keeps a take that arrived after the removal was captured', () => {
        const retiredTake = createTake('c1', 'Retired', 0, 4);
        const survivorTake = createTake('c2', 'Survivor', 4, 8);
        const capturedLane: TakeLane = {
            ...createTakeLane('t1'),
            takes: [retiredTake, survivorTake],
            activeCompRegions: [{ startBeat: 0, endBeat: 4, takeId: retiredTake.id }],
        };
        // A collaborator's projection added a take for the surviving clip while the
        // capture was absent; no local undo entry exists for it.
        const projectedTake = createTake('c2', 'Projected', 8, 12);
        const liveLane: TakeLane = {
            ...capturedLane,
            takes: [survivorTake, projectedTake],
            activeCompRegions: [],
        };
        mocks.takeLaneStoreValue.value = { lanes: [liveLane] };

        restoreTakesForClip([{ laneIndex: 0, lane: capturedLane, retiredTakeIds: [retiredTake.id] }]);

        const restored = mocks.takeLaneStoreValue.value?.lanes[0];
        expect(restored?.takes.map((take) => take.id)).toEqual([retiredTake.id, survivorTake.id, projectedTake.id]);
        expect(restored?.activeCompRegions).toEqual([{ startBeat: 0, endBeat: 4, takeId: retiredTake.id }]);
    });

    it('merges a retired lane into the track lane instead of leaving two lanes for one track', () => {
        const retiredTake = createTake('c1', 'Retired', 0, 4);
        const capturedLane: TakeLane = {
            ...createTakeLane('t1'),
            takes: [retiredTake],
            activeCompRegions: [],
        };
        // A lane for the same track appeared while the captured lane was absent.
        const projectedTake = createTake('c3', 'Projected', 0, 4);
        const trackLane: TakeLane = { ...createTakeLane('t1'), takes: [projectedTake], activeCompRegions: [] };
        mocks.takeLaneStoreValue.value = { lanes: [trackLane] };

        restoreTakesForClip([{ laneIndex: 0, lane: capturedLane, retiredTakeIds: [retiredTake.id] }]);

        const lanes = mocks.takeLaneStoreValue.value?.lanes;
        expect(lanes).toHaveLength(1);
        expect(lanes?.[0]?.trackId).toBe('t1');
        expect(lanes?.[0]?.takes.map((take) => take.id)).toEqual([retiredTake.id, projectedTake.id]);
    });

    it('does not resurrect a captured take that left the lane for another reason', () => {
        const retiredTake = createTake('c1', 'Retired', 0, 4);
        const survivorTake = createTake('c2', 'Survivor', 4, 8);
        mocks.takeLaneStoreValue.value = {
            lanes: [{ ...createTakeLane('t1'), takes: [retiredTake, survivorTake], activeCompRegions: [] }],
        };

        const capture = removeTakesForClips(['c1']);
        // A later write with no local undo entry deletes the surviving take too.
        const afterRemoval = mocks.takeLaneStoreValue.value;
        if (!afterRemoval) {
            throw new Error('expected the post-removal take-lane state');
        }
        mocks.takeLaneStoreValue.value = {
            lanes: afterRemoval.lanes.map((lane) => ({ ...lane, takes: [] })),
        };

        restoreTakesForClip(capture);

        // Only the take the removal retired comes back; the survivor left for a
        // reason this removal never recorded, so it stays gone.
        expect(mocks.takeLaneStoreValue.value?.lanes[0]?.takes.map((take) => take.id)).toEqual([retiredTake.id]);
    });

    it('keeps the live copy of a captured take that was edited after the capture', () => {
        const retiredTake = createTake('c1', 'Retired', 0, 4);
        const capturedSurvivor = createTake('c2', 'Survivor', 4, 8);
        const capturedLane: TakeLane = {
            ...createTakeLane('t1'),
            takes: [retiredTake, capturedSurvivor],
            activeCompRegions: [],
        };
        // The live lane holds the same take id edited after the capture — a distinct
        // object, so a restore that used the captured object would lose the edit.
        const liveLane: TakeLane = { ...capturedLane, takes: [{ ...capturedSurvivor, endBeat: 12 }] };
        mocks.takeLaneStoreValue.value = { lanes: [liveLane] };

        restoreTakesForClip([{ laneIndex: 0, lane: capturedLane, retiredTakeIds: [retiredTake.id] }]);

        const restored = mocks.takeLaneStoreValue.value?.lanes[0];
        expect(restored?.takes.map((take) => take.id)).toEqual([retiredTake.id, capturedSurvivor.id]);
        expect(restored?.takes.find((take) => take.id === capturedSurvivor.id)?.endBeat).toBe(12);
    });

    it('does not re-add a captured region for a take this removal did not retire', () => {
        const retiredTake = createTake('c1', 'Retired', 0, 4);
        const survivorTake = createTake('c2', 'Survivor', 4, 8);
        const capturedLane: TakeLane = {
            ...createTakeLane('t1'),
            takes: [retiredTake, survivorTake],
            activeCompRegions: [{ startBeat: 4, endBeat: 8, takeId: survivorTake.id }],
        };
        // The survivor's region was removed later; the removal dropped only the
        // retired take, so its region must not come back.
        const liveLane: TakeLane = { ...capturedLane, takes: [survivorTake], activeCompRegions: [] };
        mocks.takeLaneStoreValue.value = { lanes: [liveLane] };

        restoreTakesForClip([{ laneIndex: 0, lane: capturedLane, retiredTakeIds: [retiredTake.id] }]);

        const restored = mocks.takeLaneStoreValue.value?.lanes[0];
        expect(restored?.takes.map((take) => take.id)).toEqual([retiredTake.id, survivorTake.id]);
        expect(restored?.activeCompRegions).toEqual([]);
    });

    it('does not duplicate a captured region the live lane already holds', () => {
        const retiredTake = createTake('c1', 'Retired', 0, 4);
        const region = { startBeat: 0, endBeat: 4, takeId: retiredTake.id };
        const capturedLane: TakeLane = { ...createTakeLane('t1'), takes: [retiredTake], activeCompRegions: [region] };
        // The retired take left live, but its region was already put back by a later
        // write; the restore must not append a second copy.
        const liveLane: TakeLane = { ...capturedLane, takes: [], activeCompRegions: [region] };
        mocks.takeLaneStoreValue.value = { lanes: [liveLane] };

        restoreTakesForClip([{ laneIndex: 0, lane: capturedLane, retiredTakeIds: [retiredTake.id] }]);

        const restored = mocks.takeLaneStoreValue.value?.lanes[0];
        expect(restored?.takes.map((take) => take.id)).toEqual([retiredTake.id]);
        expect(restored?.activeCompRegions).toEqual([region]);
    });

    it('keeps a restored region that only touches a live one', () => {
        const retiredTake = createTake('c1', 'Retired', 0, 4);
        const survivorTake = createTake('c2', 'Survivor', 4, 8);
        const capturedLane: TakeLane = {
            ...createTakeLane('t1'),
            takes: [retiredTake, survivorTake],
            activeCompRegions: [{ startBeat: 0, endBeat: 4, takeId: retiredTake.id }],
        };
        // The live lane comps the survivor up to beat 4, where the restored region
        // ends. Touching is not overlapping — the same boundary the lane store's
        // own retention keeps — so both regions survive.
        const liveLane: TakeLane = {
            ...capturedLane,
            takes: [survivorTake],
            activeCompRegions: [{ startBeat: 4, endBeat: 8, takeId: survivorTake.id }],
        };
        mocks.takeLaneStoreValue.value = { lanes: [liveLane] };

        restoreTakesForClip([{ laneIndex: 0, lane: capturedLane, retiredTakeIds: [retiredTake.id] }]);

        const restored = mocks.takeLaneStoreValue.value?.lanes[0];
        expect(restored?.takes.map((take) => take.id)).toEqual([retiredTake.id, survivorTake.id]);
        expect(restored?.activeCompRegions).toEqual([
            { startBeat: 0, endBeat: 4, takeId: retiredTake.id },
            { startBeat: 4, endBeat: 8, takeId: survivorTake.id },
        ]);
    });

    it('orders the restored regions by beat with the ones already live', () => {
        const retiredTake = createTake('c1', 'Retired', 0, 4);
        const survivorTake = createTake('c2', 'Survivor', 8, 12);
        const capturedLane: TakeLane = {
            ...createTakeLane('t1'),
            takes: [retiredTake, survivorTake],
            activeCompRegions: [{ startBeat: 0, endBeat: 4, takeId: retiredTake.id }],
        };
        // The live lane keeps a later region; the restored earlier one sorts before it.
        const liveLane: TakeLane = {
            ...capturedLane,
            takes: [survivorTake],
            activeCompRegions: [{ startBeat: 8, endBeat: 12, takeId: survivorTake.id }],
        };
        mocks.takeLaneStoreValue.value = { lanes: [liveLane] };

        restoreTakesForClip([{ laneIndex: 0, lane: capturedLane, retiredTakeIds: [retiredTake.id] }]);

        expect(mocks.takeLaneStoreValue.value?.lanes[0]?.activeCompRegions.map((region) => region.startBeat)).toEqual([
            0, 8,
        ]);
    });

    it('writes nothing when the live lane already holds everything the capture would re-add', () => {
        const retiredTake = createTake('c1', 'Retired', 0, 4);
        const region = { startBeat: 0, endBeat: 4, takeId: retiredTake.id };
        const capturedLane: TakeLane = {
            ...createTakeLane('t1'),
            takes: [retiredTake],
            activeCompRegions: [region],
        };
        // A projection already put the retired take and its region back.
        const liveLane: TakeLane = {
            ...capturedLane,
            takes: [retiredTake],
            activeCompRegions: [region],
        };
        mocks.takeLaneStoreValue.value = { lanes: [liveLane] };

        restoreTakesForClip([{ laneIndex: 0, lane: capturedLane, retiredTakeIds: [retiredTake.id] }]);

        expect(takeLaneStore.set).not.toHaveBeenCalled();
    });

    it('does not resurrect a non-retired take when the captured lane is absent from live', () => {
        const retiredTake = createTake('c1', 'Retired', 0, 4);
        const survivorTake = createTake('c2', 'Survivor', 4, 8);
        mocks.takeLaneStoreValue.value = {
            lanes: [{ ...createTakeLane('t1'), takes: [retiredTake, survivorTake], activeCompRegions: [] }],
        };

        const capture = removeTakesForClips(['c1']);
        // A later projection write removes the whole lane, so the insertion path runs.
        mocks.takeLaneStoreValue.value = { lanes: [] };

        restoreTakesForClip(capture);

        const lanes = mocks.takeLaneStoreValue.value?.lanes;
        expect(lanes).toHaveLength(1);
        expect(lanes?.[0]?.takes.map((take) => take.id)).toEqual([retiredTake.id]);
    });

    it('re-adds nothing when the capture carries no retired take ids', () => {
        const capturedTake = createTake('c1', 'Captured', 0, 4);
        const capturedLane = laneWithTakes('t1', [capturedTake]);
        // The live lane is the track's, but the captured take is not in it, and the
        // capture records no retired ids (an entry persisted before the field existed).
        const liveLane = laneWithTakes('t1', []);
        mocks.takeLaneStoreValue.value = { lanes: [liveLane] };

        restoreTakesForClip([{ laneIndex: 0, lane: capturedLane }]);

        expect(takeLaneStore.set).not.toHaveBeenCalled();
        expect(mocks.takeLaneStoreValue.value?.lanes[0]?.takes).toEqual([]);
    });
});
