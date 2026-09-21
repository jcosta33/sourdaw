import { describe, it, expect, beforeEach, vi } from 'vitest';

import { createTake, createTakeLane, type TakeLane } from '../../../models/TakeLane';
import { type TakeLaneStoreState, takeLaneStore } from '../../../stores/takeLaneStore';
import { captureRetiredTakeLanes } from '../captureRetiredTakeLanes';
import { removeTakesForClips } from '../removeTakesForClips';

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

describe('removeTakesForClips', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.takeLaneStoreValue.value = null;
    });

    it('no-ops when the take-lane store is absent', () => {
        mocks.takeLaneStoreValue.value = null;

        expect(removeTakesForClips(['c1'])).toEqual([]);
        expect(takeLaneStore.set).not.toHaveBeenCalled();
    });

    it('does not rewrite the store when no take references the clip', () => {
        mocks.takeLaneStoreValue.value = {
            lanes: [laneWithTakes('t1', [createTake('c2', 'Take 2', 0, 4)])],
        };

        expect(removeTakesForClips(['c1'])).toEqual([]);
        expect(takeLaneStore.set).not.toHaveBeenCalled();
    });

    it('removes every take referencing the clip across all lanes', () => {
        const kept = createTake('c2', 'Take other', 0, 4);
        mocks.takeLaneStoreValue.value = {
            lanes: [
                laneWithTakes('t1', [createTake('c1', 'Take 1', 0, 4), kept]),
                laneWithTakes('t2', [createTake('c1', 'Take 2', 4, 8)]),
            ],
        };

        removeTakesForClips(['c1']);

        const state = mocks.takeLaneStoreValue.value;
        expect(state?.lanes).toHaveLength(1);
        expect(state?.lanes[0]?.takes.map((take) => take.id)).toEqual([kept.id]);
    });

    it('leaves a take on a different clip untouched (no over-retirement)', () => {
        const kept = createTake('c2', 'Keep me', 0, 4);
        const lane = laneWithTakes('t1', [createTake('c1', 'Retire', 0, 4), kept]);
        mocks.takeLaneStoreValue.value = { lanes: [lane] };

        removeTakesForClips(['c1']);

        const state = mocks.takeLaneStoreValue.value;
        expect(state?.lanes).toHaveLength(1);
        expect(state?.lanes[0]?.takes).toEqual([kept]);
    });

    it('drops comp regions naming a retired take and keeps regions for surviving takes', () => {
        const retired = createTake('c1', 'Retire', 0, 4);
        const kept = createTake('c2', 'Keep', 4, 8);
        const lane: TakeLane = {
            ...createTakeLane('t1'),
            takes: [retired, kept],
            activeCompRegions: [
                { startBeat: 0, endBeat: 4, takeId: retired.id },
                { startBeat: 4, endBeat: 8, takeId: kept.id },
            ],
        };
        mocks.takeLaneStoreValue.value = { lanes: [lane] };

        removeTakesForClips(['c1']);

        const state = mocks.takeLaneStoreValue.value;
        expect(state?.lanes[0]?.activeCompRegions).toEqual([{ startBeat: 4, endBeat: 8, takeId: kept.id }]);
    });

    it('keeps a comp region this removal did not touch, even when it is already dangling', () => {
        const retired = createTake('c1', 'Retire', 0, 4);
        const kept = createTake('c2', 'Keep', 4, 8);
        const lane: TakeLane = {
            ...createTakeLane('t1'),
            takes: [retired, kept],
            activeCompRegions: [
                { startBeat: 0, endBeat: 2, takeId: retired.id },
                { startBeat: 2, endBeat: 4, takeId: 'take-foreign' },
                { startBeat: 4, endBeat: 8, takeId: kept.id },
            ],
        };
        mocks.takeLaneStoreValue.value = { lanes: [lane] };

        removeTakesForClips(['c1']);

        expect(mocks.takeLaneStoreValue.value?.lanes[0]?.activeCompRegions).toEqual([
            { startBeat: 2, endBeat: 4, takeId: 'take-foreign' },
            { startBeat: 4, endBeat: 8, takeId: kept.id },
        ]);
    });

    it('retires the lane when its last take is removed', () => {
        const lonelyLane = laneWithTakes('t1', [createTake('c1', 'Only take', 0, 4)]);
        const otherLane = laneWithTakes('t2', [createTake('c3', 'Unrelated', 0, 4)]);
        mocks.takeLaneStoreValue.value = { lanes: [lonelyLane, otherLane] };

        removeTakesForClips(['c1']);

        const state = mocks.takeLaneStoreValue.value;
        expect(state?.lanes).toHaveLength(1);
        expect(state?.lanes[0]?.trackId).toBe('t2');
    });

    it('removes the takes of every given clip id in one store write', () => {
        const lane = laneWithTakes('t1', [
            createTake('c1', 'One', 0, 2),
            createTake('c2', 'Two', 2, 4),
            createTake('c3', 'Three', 4, 6),
        ]);
        mocks.takeLaneStoreValue.value = { lanes: [lane] };

        removeTakesForClips(['c1', 'c2']);

        expect(takeLaneStore.set).toHaveBeenCalledTimes(1);
        expect(mocks.takeLaneStoreValue.value?.lanes[0]?.takes.map((take) => take.clipId)).toEqual(['c3']);
    });

    it('returns every affected lane exactly as it was, at its original index', () => {
        const thinnedTake = createTake('c1', 'Retire from a shared lane', 0, 4);
        const keptTake = createTake('c2', 'Survivor', 4, 8);
        const thinnedLane = laneWithTakes('t1', [thinnedTake, keptTake]);
        const retiredLane = laneWithTakes('t2', [createTake('c1', 'Lonely take', 0, 4)]);
        mocks.takeLaneStoreValue.value = { lanes: [thinnedLane, retiredLane] };

        const retired = removeTakesForClips(['c1']);

        expect(takeLaneStore.set).toHaveBeenCalledTimes(1);
        expect(retired.map((entry) => entry.laneIndex)).toEqual([0, 1]);
        expect(retired[0]?.lane.takes.map((take) => take.id)).toEqual([thinnedTake.id, keptTake.id]);
        expect(retired[1]?.lane.takes.map((take) => take.id)).toEqual([retiredLane.takes[0]?.id]);
        expect(mocks.takeLaneStoreValue.value?.lanes.map((lane) => lane.id)).toEqual([thinnedLane.id]);
    });

    it('captures what a removal would retire without writing the store', () => {
        const lane = laneWithTakes('t1', [createTake('c1', 'Retire', 0, 4)]);
        mocks.takeLaneStoreValue.value = { lanes: [lane] };

        const captured = captureRetiredTakeLanes(['c1']);

        expect(takeLaneStore.set).not.toHaveBeenCalled();
        expect(captured).toHaveLength(1);
        expect(captured[0]?.lane.id).toBe(lane.id);
        expect(captured[0]?.lane.takes.map((take) => take.id)).toEqual([lane.takes[0]?.id]);
    });
});
