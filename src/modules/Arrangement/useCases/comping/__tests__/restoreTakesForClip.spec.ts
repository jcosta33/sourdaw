import { describe, it, expect, beforeEach, vi } from 'vitest';

import { createTake, createTakeLane, type TakeLane } from '../../../models/TakeLane';
import { type TakeLaneStoreState, takeLaneStore } from '../../../stores/takeLaneStore';
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
        const survivingLane = laneWithTakes('t2', [createTake('c9', 'Survivor', 0, 4)]);
        mocks.takeLaneStoreValue.value = { lanes: [survivingLane] };
        const retiredLane = laneWithTakes('t1', [createTake('c1', 'Retired', 0, 4)]);

        restoreTakesForClip([{ laneIndex: 0, lane: retiredLane }]);

        expect(takeLaneStore.set).toHaveBeenCalledTimes(1);
        expect(mocks.takeLaneStoreValue.value?.lanes.map((lane) => lane.id)).toEqual([
            retiredLane.id,
            survivingLane.id,
        ]);
    });

    it('rewrites a lane thinned by the removal from its captured state', () => {
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

        restoreTakesForClip([{ laneIndex: 0, lane: thinnedLane }]);

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
});
